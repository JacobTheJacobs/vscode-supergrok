import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AcpClient, EffortLevel, ExitPlanRequest, PermissionRequest, QuestionRequest, killGrokTree } from "../acp/client";
import { isCliAuthRequiredOutput } from "./auth-state";
import { Session, SessionStatus } from "../sessions/session-state";
import { selectReapable, computeDot, Dot } from "../sessions/pool";
import { MediaRef, isIncompatibleAgentError } from "../acp/dispatch";
import { locateGrokCli, extensionWasUpgraded } from "../cli/locator";
import { TerminalManager } from "../terminal/manager";
import {
  FileChip,
  clearImplicitChips,
  makeExplicitChip,
  makeImplicitChip,
  removeChip,
  toggleChip,
} from "../context/chips";
import { buildPrompt } from "../context/prompt-builder";
import { parseFileRef, shouldReadFileInline } from "../context/file-ref";
import { pickRejectOption, shouldRejectPermission } from "../plan/gate";
import { appendPlanEntry, decideRestoreState } from "../plan/restore";
import { planReviewFileBaseName, sanitizePlanReviewFilePart } from "../plan/review";
import { GROK_PRIMER, isPrimerText } from "../plan/primer";
import {
  SessionListEntry,
  SessionMetaOverrides,
  defaultFs,
  deleteSessionDir,
  listSessions,
  resolveGrokHome,
  sessionsDirFor,
} from "../sessions/store";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

function isImagePath(p: string): boolean {
  return IMAGE_EXT_RE.test(p);
}

function getImageMime(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

const MAX_IMAGE_INLINE_BYTES = 2 * 1024 * 1024;
const SESSION_OPEN_TIMEOUT_MS = 20_000;

function withSessionOpenTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(SESSION_OPEN_TIMEOUT_MS / 1000)}s`));
    }, SESSION_OPEN_TIMEOUT_MS);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type WebviewMsg =
  | { type: "ready" }
  | { type: "send"; text: string; chips: FileChip[] }
  | { type: "newSession" }
  | { type: "cancel" }
  | { type: "pickModel" }
  | { type: "setMode"; modeId: "agent" | "plan" | "yolo" }
  | { type: "removeChip"; id: string }
  | { type: "toggleChip"; id: string }
  | { type: "openFile"; path: string }
  | { type: "openUrl"; url: string }
  | { type: "openDiff"; path: string; oldText: string; newText: string }
  | { type: "exportExpr"; action: string; kind: string; current?: string; svg?: string; png?: string; svgDark?: string; svgLight?: string }
  | { type: "setEffort"; level: string }
  | { type: "updateConfig"; key: "useCtrlEnterToSend" | "includeActiveFileByDefault"; value: boolean }
  | { type: "openGlobalConfig" }
  | { type: "openProjectConfig" }
  | { type: "runMcpList" }
  | { type: "showLogs" }
  | { type: "dropFile"; path: string; shift: boolean }
  | { type: "pasteImage"; data: string; name?: string }
  | { type: "permissionAnswer"; requestId: number | string; optionId: string }
  | { type: "exitPlanAnswer"; requestId: number | string; verdict: "approved" | "abandoned" | "rejected"; comment?: string }
  | { type: "questionAnswer"; requestId: number | string; answers?: Record<string, string>; annotations?: Record<string, { notes?: string; preview?: string }> }
  | { type: "questionCancel"; requestId: number | string }
  | { type: "setModel"; modelId: string }
  | { type: "runInstallCmd" }
  | { type: "runGrokLogin" }
  | { type: "logout" }
  | { type: "checkGrokUpdate" }
  | { type: "updateGrok" }
  | { type: "recheckConnection" }
  | { type: "listSessions" }
  | { type: "resumeSession"; id: string }
  | { type: "renameSession"; id: string; name: string }
  | { type: "deleteSession"; id: string; name?: string }
  | { type: "pickFile" }
  | { type: "listContext"; dir?: string }
  | { type: "addContextPath"; path: string };

const SESSION_META_KEY = "grok.sessionMeta";

const CLI_UPDATE_VERSION_KEY = "grok.cliUpdateExtVersion";

const LIVE_PIDS_KEY = "grok.liveGrokPids";

const execFileAsync = promisify(execFile);

const ACT_MODE_ID = "default";

function guessMediaMime(p: string): string {
  const ext = p.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "svg": return "image/svg+xml";
    case "mp4":
    case "m4v": return "video/mp4";
    case "mov": return "video/quicktime";
    case "webm": return "video/webm";
    default: return "image/png";
  }
}

export class GrokSidebar implements vscode.WebviewViewProvider {
  public static readonly viewId = "superGrok.chat";
  private view?: vscode.WebviewView;
  private focused = new Session();
  private pool = new Set<Session>();
  private static readonly MAX_LIVE_SESSIONS = 8;
  private static readonly IDLE_TTL_MS = 60 * 60 * 1000;
  private static readonly REAP_INTERVAL_MS = 5 * 60 * 1000;
  private reaper?: ReturnType<typeof setInterval>;
  private output: vscode.OutputChannel;
  private chips: FileChip[] = [];
  private editorWatcher?: vscode.Disposable;
  private terminalManager = new TerminalManager();
  private configWatcher?: vscode.Disposable;
  private cliPath?: string;
  private cliUpdateChecked = false;
  constructor(
    private context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
  ) {
    this.output = output;
    void this.sweepOrphanGrokProcesses();
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        vscode.Uri.joinPath(this.context.extensionUri, "resources"),
        vscode.Uri.file(resolveGrokHome()),
      ],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewMsg) => this.onMessage(m));
    this.watchActiveEditor();
    if (!this.reaper) {
      this.reaper = setInterval(() => this.reapPool(), GrokSidebar.REAP_INTERVAL_MS);
    }
    this.configWatcher?.dispose();
    this.configWatcher = undefined;
  }
  insertActiveMention(opts?: { selection?: boolean; uri?: vscode.Uri }): void {
    const editor = vscode.window.activeTextEditor;
    const uri = opts?.uri ?? editor?.document.uri;
    if (!uri) return;
    const abs = uri.fsPath;
    const relPath = vscode.workspace.asRelativePath(uri);
    if (isImagePath(abs) && fs.existsSync(abs)) {
      try {
        const buf = fs.readFileSync(abs);
        if (buf.length <= MAX_IMAGE_INLINE_BYTES) {
          const imageData = buf.toString("base64");
          const imageMime = getImageMime(abs);
          const chip = makeExplicitChip(abs, abs);
          chip.imageData = imageData;
          chip.imageMime = imageMime;
          chip.dataUrl = `data:${imageMime};base64,${imageData}`;
          this.chips.push(chip);
          this.postChips();
          this.reveal();
          return;
        }
      } catch {}
    }
    let selStart: number | undefined;
    let selEnd: number | undefined;
    if (opts?.selection && editor && !editor.selection.isEmpty) {
      selStart = editor.selection.start.line + 1;
      selEnd = editor.selection.end.line + 1;
    }
    this.chips.push(makeExplicitChip(abs, relPath, selStart, selEnd));
    this.postChips();
    this.reveal();
  }
  newSession(): void {
    void this.newFocusedSession();
  }
  async pickModel(): Promise<void> {
    if (!this.focused.client || !this.focused.client.availableModels.length) {
      vscode.window.showInformationMessage("Start a session first.");
      return;
    }
    const items = this.focused.client.availableModels.map((m) => ({
      label: m.name ?? m.modelId,
      description: m.modelId === this.focused.client!.currentModelId ? "$(check) current" : "",
      detail: m.description,
      modelId: m.modelId,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Pick a Grok model",
    });
    if (picked) await this.switchModel(picked.modelId);
  }
  async switchModel(modelId: string): Promise<void> {
    const client = this.focused.client;
    if (!client || this.focused.priming || modelId === client.currentModelId) return;
    const cfg = vscode.workspace.getConfiguration("grok");
    try {
      await client.setModel(modelId);
      await cfg.update("defaultModel", modelId, vscode.ConfigurationTarget.Global);
    } catch (e) {
      if (!isIncompatibleAgentError(e)) {
        vscode.window.showErrorMessage(`Failed to set model: ${(e as Error).message}`);
        return;
      }
      if (!this.focused.hasHistory) {
        await cfg.update("defaultModel", modelId, vscode.ConfigurationTarget.Global);
        await this.startSession();
        return;
      }
      const mode = await this.pickRestartMode("Switching to this model requires a new session.");
      if (!mode) return;
      await cfg.update("defaultModel", modelId, vscode.ConfigurationTarget.Global);
      await this.restartSession(mode);
    }
  }
  openModePopover(): void {
    this.post({ type: "openModePopover" });
  }
  debugShowDummyPlan(): void {
    const dummyPlan = `# Refactor authentication helper

## Summary
Introduce a small \`auth.ts\` module and migrate the two call sites in the API layer. No behavior change for end users.

## Detailed steps
1. Create \`src/lib/auth.ts\` exporting \`getSessionToken()\` and \`isTokenExpired()\`.
2. Update \`src/api/client.ts\` (two call sites) to delegate to the new helper.
3. Add unit tests in \`tests/auth.test.ts\` covering expiry + refresh paths.
4. Run the integration suite to confirm nothing regressed.

## Risk / notes
- Token format is unchanged.
- One new (already-transitive) dependency on \`jsonwebtoken\`.

\`\`\`ts
// proposed addition to src/lib/auth.ts
export async function getSessionToken(): Promise<string> {
  const cached = getFromCache();
  if (cached && !isTokenExpired(cached)) return cached;
  return refresh();
}
\`\`\`

See design doc for the full state machine diagram.`;
    this.post({
      type: "exitPlanRequest",
      req: {
        id: "dummy-plan-" + Date.now(),
        sessionId: this.focused.activeSessionId || "dummy-session",
        plan: dummyPlan,
      },
    });
    this.post({ type: "modeChanged", modeId: "plan" });
  }
  private displayMode(): "agent" | "plan" | "yolo" {
    if (this.focused.planActive) return "plan";
    if (this.focused.autoApprove) return "yolo";
    return "agent";
  }
  private postMode(): void {
    this.post({ type: "modeChanged", modeId: this.displayMode() });
  }
  private setPlanActive(session: Session, v: boolean): void {
    session.planActive = v;
    if (session.client) session.client.planActive = v;
    if (session === this.focused) this.postMode();
  }
  async setMode(modeId: "agent" | "plan" | "yolo"): Promise<void> {
    const session = this.focused;
    if (modeId === "yolo") {
      session.autoApprove = true;
      this.setPlanActive(session, false);
      if (session.client) {
        try { await session.client.setMode(ACT_MODE_ID); } catch {  }
      }
      return;
    }
    session.autoApprove = false;
    if (modeId === "plan") {
      this.setPlanActive(session, true);
      if (session.client) {
        try { await session.client.setMode("plan"); }
        catch (e) { vscode.window.showErrorMessage(`Couldn't switch mode: ${(e as Error).message}`); }
      }
      return;
    }
    this.setPlanActive(session, false);
    if (session.client) {
      try { await session.client.setMode(ACT_MODE_ID); }
      catch (e) { vscode.window.showErrorMessage(`Couldn't switch mode: ${(e as Error).message}`); }
    }
  }
  private handleExitPlan(
    requestId: number | string,
    verdict: "approved" | "abandoned" | "rejected",
    comment?: string,
  ): void {
    const session = this.focused;
    const client = session.client;
    if (!client) return;
    const gen = session.gen;
    client.respondExitPlan(requestId, verdict);
    this.persistPlanVerdict(session, verdict);
    this.setStatus(session, "working");
    const feedback = comment?.trim();
    if (verdict === "approved") {
      this.setPlanActive(session, false);
      if (feedback) {
        session.userMessageCount += 1;
        this.emit(session, { type: "userMessage", text: feedback, chips: [] });
      }
      this.emit(session, { type: "planProcessing" });
      const promptToGrok = feedback ? `[Plan approved] ${feedback}` : "[Plan approved]";
      session.afterTurn = async () => {
        try { await client.setMode(ACT_MODE_ID); } catch {  }
        this.emit(session, { type: "agentStart" });
        this.setStatus(session, "working");
        try {
          await this.ensurePrimed(client, session, gen);
          if (gen !== session.gen) return;
          const meta = await client.prompt(promptToGrok);
          if (gen !== session.gen) return;
          this.emit(session, { type: "agentEnd", meta });
          this.setStatus(session, "done");
        } catch (err) {
          if (gen !== session.gen) return;
          const e = err as any;
          this.emit(session, { type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
          this.setStatus(session, "error");
        }
      };
      return;
    }
    void client.cancel();
    this.emit(session, { type: "agentReset" });
    session.suppressPlanReject = true;
    if (feedback) {
      session.userMessageCount += 1;
      this.emit(session, { type: "userMessage", text: feedback, chips: [] });
      this.emit(session, { type: "planProcessing" });
    }
    if (verdict === "rejected") {
      this.setPlanActive(session, true);
      if (!feedback) {
        this.emit(session, {
          type: "planNotice",
          text: "Plan rejected — staying in Plan mode. Grok is processing the rejection…",
        });
        this.emit(session, { type: "planProcessing" });
      }
      const promptToGrok = feedback ? `[Plan rejected] ${feedback}` : "[Plan rejected]";
      session.afterTurn = async () => {
        session.suppressPlanReject = false;
        try { await client.setMode("plan"); } catch {  }
        this.emit(session, { type: "agentStart" });
        this.setStatus(session, "working");
        try {
          await this.ensurePrimed(client, session, gen);
          if (gen !== session.gen) return;
          const meta = await client.prompt(promptToGrok);
          if (gen !== session.gen) return;
          this.emit(session, { type: "agentEnd", meta });
          this.setStatus(session, "done");
        } catch (err) {
          if (gen !== session.gen) return;
          const e = err as any;
          this.emit(session, { type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
          this.setStatus(session, "error");
        }
      };
      return;
    }
    this.setPlanActive(session, false);
    if (!feedback) {
      this.emit(session, {
        type: "planNotice",
        text: "Plan abandoned — switched to Agent mode. Grok is processing the cancellation…",
      });
      this.emit(session, { type: "planProcessing" });
    }
    const promptToGrok = feedback ? `[Plan cancelled] ${feedback}` : "[Plan cancelled]";
    session.afterTurn = async () => {
      session.suppressPlanReject = false;
      try { await client.setMode(ACT_MODE_ID); } catch {  }
      this.emit(session, { type: "agentStart" });
      this.setStatus(session, "working");
      try {
        const meta = await client.prompt(promptToGrok);
        if (gen !== session.gen) return;
        this.emit(session, { type: "agentEnd", meta });
        this.setStatus(session, "done");
      } catch (err) {
        if (gen !== session.gen) return;
        const e = err as any;
        this.emit(session, { type: "agentError", text: e?.data?.message ?? e?.message ?? String(err) });
        this.setStatus(session, "error");
      }
    };
  }
  private ensurePrimed(client: AcpClient, session: Session, gen: number): Promise<void> {
    if (session.primed) return Promise.resolve();
    if (session.primingPromise) return session.primingPromise;
    const promise = (async () => {
      session.suppressContent = true;
      try {
        await client.prompt(GROK_PRIMER);
        if (gen === session.gen) session.primed = true;
      } catch (e) {
        this.output.appendLine(`[primer] failed: ${(e as Error).message}`);
      } finally {
        if (gen === session.gen) session.suppressContent = false;
        if (!session.primed) session.primingPromise = undefined;
      }
    })();
    session.primingPromise = promise;
    return promise;
  }
  private persistPlanVerdict(session: Session, verdict: "approved" | "abandoned" | "rejected"): void {
    const sid = session.activeSessionId ?? session.client?.sessionId;
    if (!sid) return;
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const cur = overrides[sid] ?? {};
    const planText = session.pendingPlanText || "";
    session.pendingPlanText = "";
    const plans = appendPlanEntry(cur.plans, {
      text: planText,
      verdict,
      afterUserMessage: session.userMessageCount,
    });
    const next: SessionMetaOverrides = {
      ...overrides,
      [sid]: { ...cur, lastPlanVerdict: verdict, plans },
    };
    void this.context.globalState.update(SESSION_META_KEY, next);
  }
  private async runAfterTurn(session: Session): Promise<void> {
    const fn = session.afterTurn;
    if (!fn) return;
    session.afterTurn = undefined;
    await fn();
  }
  private async postGeneratedMedia(m: MediaRef, session: Session, gen: number): Promise<void> {
    try {
      if (m.kind === "data") {
        this.emit(session, { type: "media", media: m.media, src: `data:${m.mimeType};base64,${m.data}` });
        return;
      }
      if (m.kind === "uri") {
        this.emit(session, { type: "media", media: m.media, url: m.uri });
        return;
      }
      const mime = m.mimeType || guessMediaMime(m.path);
      const webview = this.view?.webview;
      if (webview && this.isServableFromDisk(m.path)) {
        const src = webview.asWebviewUri(vscode.Uri.file(m.path)).toString();
        this.emit(session, { type: "media", media: m.media, src, mimeType: mime, path: m.path });
        return;
      }
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(m.path));
      if (gen !== session.gen) return;
      const b64 = Buffer.from(bytes).toString("base64");
      this.emit(session, { type: "media", media: m.media, src: `data:${mime};base64,${b64}`, path: m.path });
    } catch (e) {
      this.output.appendLine(`[media] failed to forward generated media: ${(e as Error).message}`);
    }
  }
  private isServableFromDisk(p: string): boolean {
    try {
      const root = path.resolve(resolveGrokHome());
      const rel = path.relative(root, path.resolve(p));
      return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
      return false;
    }
  }
  private async exportExpr(msg: {
    action: string;
    kind: string;
    current?: string;
    svg?: string;
    png?: string;
    svgDark?: string;
    svgLight?: string;
  }): Promise<void> {
    try {
      const base = msg.kind === "mermaid" ? "diagram" : "equation";
      const toBytes = (png?: string) =>
        png ? Buffer.from(png.split(",")[1] ?? "", "base64") : null;
      if (msg.action === "open") {
        const pngBytes = toBytes(msg.png);
        const dir = path.join(this.context.globalStorageUri.fsPath, "exports");
        fs.mkdirSync(dir, { recursive: true });
        const stamp = Date.now();
        const file = path.join(dir, `${base}-${stamp}.${pngBytes ? "png" : "svg"}`);
        fs.writeFileSync(file, pngBytes ?? (msg.svg ?? ""), pngBytes ? undefined : "utf8");
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
        return;
      }
      const mark = (which: string) => (msg.current === which ? "  (current theme)" : "");
      const items = [
        { label: "PNG", description: "raster, VS Code theme background", fmt: "png" },
        { label: `SVG — for dark background${mark("dark")}`, description: "transparent, light ink", fmt: "svgDark" },
        { label: `SVG — for light background${mark("light")}`, description: "transparent, dark ink", fmt: "svgLight" },
      ];
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Export ${base} as…`,
      });
      if (!pick) return;
      const ext = pick.fmt === "png" ? "png" : "svg";
      const defaultName = `${base}.${ext}`;
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = folder
        ? vscode.Uri.joinPath(folder, defaultName)
        : vscode.Uri.file(defaultName);
      const filters: Record<string, string[]> =
        ext === "png" ? { "PNG image": ["png"] } : { "SVG image": ["svg"] };
      const target = await vscode.window.showSaveDialog({ defaultUri, filters });
      if (!target) return;
      if (pick.fmt === "png") {
        const pngBytes = toBytes(msg.png);
        fs.writeFileSync(target.fsPath, pngBytes ?? Buffer.from(msg.svgDark ?? "", "utf8"));
      } else {
        const svg = pick.fmt === "svgDark" ? msg.svgDark : msg.svgLight;
        fs.writeFileSync(target.fsPath, svg ?? "", "utf8");
      }
    } catch (e) {
      this.output.appendLine(`[export] failed: ${(e as Error).message}`);
      void vscode.window.showErrorMessage(`Export failed: ${(e as Error).message}`);
    }
  }
  async logout(): Promise<void> {
    const cliPath = this.cliPath || locateGrokCli(
      vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
    );
    if (!cliPath) {
      this.post({ type: "onboarding", state: "missing-cli", platform: process.platform });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Sign out of Grok? This clears the CLI's cached credentials.",
      { modal: true },
      "Sign Out",
    );
    if (choice !== "Sign Out") return;
    this.disposePool();
    this.focused = new Session();
    const term = vscode.window.createTerminal("Grok Logout");
    term.sendText(`"${cliPath}" logout`);
    this.post({ type: "clearMessages" });
    this.post({ type: "onboarding", state: "auth-required" });
  }
  dispose(): void {
    if (this.reaper) { clearInterval(this.reaper); this.reaper = undefined; }
    this.disposePool();
    this.editorWatcher?.dispose();
    this.configWatcher?.dispose();
    this.terminalManager.disposeAll();
  }
  private async ensureClient(): Promise<AcpClient | undefined> {
    if (this.focused.client) return this.focused.client;
    return this.startSession();
  }
  private async maybeUpdateCliOnUpgrade(cliPath: string): Promise<void> {
    if (this.cliUpdateChecked) return;
    this.cliUpdateChecked = true;
    const current = (this.context.extension.packageJSON as { version?: string })?.version ?? "";
    const lastSeen = this.context.globalState.get<string>(CLI_UPDATE_VERSION_KEY);
    try {
      if (extensionWasUpgraded(lastSeen, current)) {
        this.output.appendLine(`Extension upgraded ${lastSeen} → ${current}; updating grok CLI (silent).`);
        this.post({ type: "cliUpdating" });
        try {
          const { stdout, stderr } = await execFileAsync(cliPath, ["update"], { timeout: 180_000 });
          if (stdout?.trim()) this.output.appendLine(stdout.trim());
          if (stderr?.trim()) this.output.appendLine(stderr.trim());
        } catch (e) {
          this.output.appendLine(`grok update failed (continuing with current binary): ${(e as Error).message}`);
        }
      }
    } finally {
      void this.context.globalState.update(CLI_UPDATE_VERSION_KEY, current);
    }
  }
  private async probeCliAuthentication(cliPath: string, env: NodeJS.ProcessEnv): Promise<"ok" | "auth-required" | "unknown"> {
    try {
      const { stdout, stderr } = await execFileAsync(cliPath, ["models"], {
        env,
        timeout: 8_000,
        windowsHide: true,
      });
      // grok 0.2.60 exits 0 even when signed out (it just prints "You are not
      // authenticated"), so inspect the output instead of trusting the exit code.
      if (isCliAuthRequiredOutput(`${stdout ?? ""}\n${stderr ?? ""}`)) return "auth-required";
      return "ok";
    } catch (e: any) {
      const combined = `${e?.stdout ?? ""}\n${e?.stderr ?? ""}\n${e?.message ?? ""}`;
      if (isCliAuthRequiredOutput(combined)) return "auth-required";
      this.output.appendLine(`[auth-probe] ${combined.trim() || "models probe failed"}`);
      return "unknown";
    }
  }
  private async checkGrokUpdate(): Promise<void> {
    const cliPath = this.cliPath || locateGrokCli(
      vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
    );
    if (!cliPath) {
      this.post({ type: "grokUpdateStatus", error: "grok CLI not found" });
      return;
    }
    try {
      const { stdout } = await execFileAsync(cliPath, ["update", "--check", "--json"], { timeout: 30_000 });
      const info = JSON.parse(stdout) as { currentVersion?: string; latestVersion?: string; updateAvailable?: boolean };
      this.post({
        type: "grokUpdateStatus",
        current: info.currentVersion ?? null,
        latest: info.latestVersion ?? null,
        updateAvailable: !!info.updateAvailable,
      });
    } catch (e) {
      this.output.appendLine(`grok update --check failed: ${(e as Error).message}`);
      this.post({ type: "grokUpdateStatus", error: (e as Error).message });
    }
  }
  private async updateGrokCliOnDemand(): Promise<void> {
    const cliPath = this.cliPath || locateGrokCli(
      vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
    );
    if (!cliPath) {
      this.post({ type: "onboarding", state: "missing-cli", platform: process.platform });
      return;
    }
    const busy = [...this.pool].filter(
      (s) => s.status === "working" || s.status === "needs-you",
    ).length;
    if (busy > 0) {
      const choice = await vscode.window.showWarningMessage(
        `Updating the Grok CLI Copilot will stop ${busy} session${busy === 1 ? "" : "s"} currently in progress. Continue?`,
        { modal: true },
        "Update Anyway",
      );
      if (choice !== "Update Anyway") return;
    }
    const resumeId = this.focused.activeSessionId;
    this.disposePool();
    this.focused = new Session();
    this.post({ type: "clearMessages" });
    this.post({ type: "cliUpdating" });
    try {
      const { stdout, stderr } = await execFileAsync(cliPath, ["update"], { timeout: 180_000 });
      if (stdout?.trim()) this.output.appendLine(stdout.trim());
      if (stderr?.trim()) this.output.appendLine(stderr.trim());
    } catch (e) {
      this.output.appendLine(`grok update failed: ${(e as Error).message}`);
      void vscode.window.showWarningMessage(`Grok CLI Copilot update failed: ${(e as Error).message}`);
    }
    await this.startSession(resumeId);
  }
  private async pickRestartMode(message: string): Promise<"clear" | "summarize" | undefined> {
    const choice = await vscode.window.showInformationMessage(
      message,
      "Summarize & Restart",
      "Just Restart",
    );
    if (!choice) return undefined;
    return choice === "Just Restart" ? "clear" : "summarize";
  }
  private async restartSession(mode: "clear" | "summarize"): Promise<void> {
    if (mode === "clear") {
      this.emit(this.focused, { type: "clearMessages" });
      await this.startSession();
      return;
    }
    const currentClient = this.focused.client;
    this.emit(this.focused, { type: "summarizing" });
    const chunks: string[] = [];
    const captureChunk = (t: string) => chunks.push(t);
    currentClient?.on("messageChunk", captureChunk);
    this.focused.suppressContent = true;
    try {
      await currentClient?.prompt(
        "Summarize our conversation so far in a concise paragraph. Be brief.",
      );
    } catch {  } finally {
      currentClient?.off("messageChunk", captureChunk);
      this.focused.suppressContent = false;
    }
    const summary = chunks.join("").trim();
    await this.startSession();
    if (summary && this.focused.client) {
      await this.ensurePrimed(this.focused.client, this.focused, this.focused.gen);
      this.emit(this.focused, { type: "sessionContext" });
      this.focused.suppressContent = true;
      try {
        await this.focused.client.prompt(`[Context from previous session]\n${summary}`);
      } catch {  } finally {
        this.focused.suppressContent = false;
      }
    }
  }
  private async startSession(resumeId?: string): Promise<AcpClient | undefined> {
    const session = this.focused;
    const gen = ++session.gen;
    session.buffer = [];
    session.status = "idle";
    session.client?.dispose();
    session.client = undefined;
    session.autoApprove = false;
    session.planActive = false;
    session.afterTurn = undefined;
    session.hasHistory = false;
    session.primed = false;
    session.primingPromise = undefined;
    session.suppressContent = false;
    session.suppressPlanReject = false;
    session.lastPlanText = "";
    session.pendingPlanText = "";
    session.userMessageCount = 0;
    session.inUserMessage = false;
    session.activeSessionId = undefined;
    session.titleGenerated = false;
    session.firstUserMessageForTitle = undefined;
    session.priming = true;
    this.emit(session, { type: "modeChanged", modeId: "agent" });
    if (resumeId) this.emit(session, { type: "clearMessages" });
    this.emit(session, { type: "setBusy", value: true, locked: true });
    this.emit(session, { type: "startupStatus", text: "Starting Grok CLI Copilot" });
    const cfg = vscode.workspace.getConfiguration("grok");
    const cliPath = locateGrokCli(cfg.get<string>("cliPath", ""));
    this.cliPath = cliPath || undefined;
    if (!cliPath) {
      if (gen !== session.gen) return undefined;
      this.pool.delete(session);
      session.priming = false;
      this.emit(session, { type: "setBusy", value: false });
      this.emit(session, { type: "onboarding", state: "missing-cli", platform: process.platform });
      return undefined;
    }
    await this.maybeUpdateCliOnUpgrade(cliPath);
    if (gen !== session.gen) return undefined;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const env = this.buildEnv(cwd);
    const authState = await this.probeCliAuthentication(cliPath, env);
    if (authState === "auth-required") {
      if (gen !== session.gen) return undefined;
      this.pool.delete(session);
      session.priming = false;
      this.emit(session, { type: "setBusy", value: false });
      this.emit(session, { type: "onboarding", state: "auth-required" });
      return undefined;
    }
    const effortStr = cfg.get<string>("defaultEffort", "");
    const effort = effortStr ? (effortStr as EffortLevel) : undefined;
    const client = new AcpClient({
      cliPath,
      cwd,
      env,
      effort,
      log: (msg) => this.output.appendLine(msg),
    });
    session.client = client;
    client.fsRead = async (p: string) => {
      try {
        const uri = vscode.Uri.file(p);
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString("utf8");
      } catch {
        return fs.readFileSync(p, "utf8");
      }
    };
    client.fsWrite = async (p: string, content: string) => {
      try {
        const uri = vscode.Uri.file(p);
        const dir = vscode.Uri.file(path.dirname(p));
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      } catch {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content, "utf8");
      }
    };
    client.terminal = this.terminalManager;
    client.on("initialized", (init) => {
      if (gen !== session.gen) return;
      this.emit(session, {
        type: "initialized",
        info: {
          cliPath,
          cwd,
          version: init?.serverInfo?.version ?? init?.version ?? null,
          init: { protocolVersion: init?.protocolVersion },
        },
      });
      this.emit(session, { type: "startupStatus", text: "Opening Grok session" });
    });
    client.on("session", (res) => {
      if (gen !== session.gen) return;
      if (res?.sessionId) session.activeSessionId = res.sessionId;
      this.emit(session, {
        type: "session",
        sessionId: res.sessionId,
        models: client.availableModels,
        currentModelId: client.currentModelId,
      });
    });
    client.on("modelChanged", (id) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "modelChanged", modelId: id });
    });
    client.on("modeChanged", (id) => {
      if (gen !== session.gen) return;
      if (id === "plan") {
        session.autoApprove = false;
        this.setPlanActive(session, true);
      } else if (session === this.focused) {
        this.postMode();
      }
    });
    client.on("commandsUpdate", (cmds) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "commandsUpdate", commands: cmds });
    });
    client.on("messageChunk", (text: string) => {
      if (gen !== session.gen) return;
      session.inUserMessage = false;
      this.emit(session, { type: "messageChunk", text });
    });
    client.on("userMessageChunk", (text: string) => {
      if (gen !== session.gen) return;
      if (!session.replaying) return;
      if (!session.inUserMessage && isPrimerText(text)) {
        session.inUserMessage = true;
        this.emit(session, { type: "userMessageChunk", text });
        return;
      }
      if (!session.inUserMessage) {
        session.userMessageCount += 1;
        session.inUserMessage = true;
      }
      this.emit(session, { type: "userMessageChunk", text });
    });
    client.on("thoughtChunk", (text: string) => {
      if (gen !== session.gen) return;
      session.inUserMessage = false;
      this.emit(session, { type: "thoughtChunk", text });
    });
    client.on("mediaContent", (m: MediaRef) => {
      if (gen !== session.gen) return;
      void this.postGeneratedMedia(m, session, gen);
    });
    client.on("toolCall", (u) => {
      if (gen !== session.gen) return;
      session.inUserMessage = false;
      this.emit(session, { type: "toolCall", call: u });
    });
    client.on("toolCallUpdate", (u) => {
      if (gen !== session.gen) return;
      session.inUserMessage = false;
      this.emit(session, { type: "toolCallUpdate", call: u });
    });
    client.on("hostActivity", (activity) => {
      if (gen !== session.gen) return;
      session.inUserMessage = false;
      this.emit(session, { type: "hostActivity", activity });
    });
    client.on("plan", (u) => {
      if (gen !== session.gen) return;
      session.lastPlanText =
        (typeof u?.plan === "string" ? u.plan : "") ||
        (typeof u?.planText === "string" ? u.planText : "") ||
        (typeof u?.content === "string" ? u.content : "") ||
        (typeof u?.content?.text === "string" ? u.content.text : "");
      this.output.appendLine(`[plan] event payload keys: ${Object.keys(u ?? {}).join(", ")}`);
    });
    client.on("promptComplete", (meta) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "promptComplete", meta });
    });
    client.on("providerNotification", (u) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "providerNotification", update: u });
    });
    client.on("permissionRequest", (req: PermissionRequest) => {
      if (gen !== session.gen) return;
      if (session.planActive && shouldRejectPermission(req.toolCall?.kind, {
        active: true,
        workspaceRoot: cwd,
      })) {
        const rejectId = pickRejectOption(req.options);
        if (rejectId) {
          client.respondPermission(req.id, rejectId);
          this.emit(session, {
            type: "planNotice",
            text: `Plan mode declined a ${req.toolCall?.kind ?? "tool"} request — approve the plan first.`,
          });
          return;
        }
      }
      if (session.autoApprove) {
        const opt = req.options.find((o) => o.kind === "allow_always") ??
                    req.options.find((o) => o.kind === "allow_once");
        if (opt) { client.respondPermission(req.id, opt.optionId); return; }
      }
      this.emit(session, { type: "permissionRequest", req });
      this.setStatus(session, "needs-you");
    });
    client.on("mutationBlocked", (info: { kind: string; target: string }) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "planBlocked", kind: info.kind, target: info.target });
    });
    client.on("planFileContent", (content: string) => {
      if (gen !== session.gen) return;
      if (typeof content === "string" && content.trim()) session.lastPlanText = content;
    });
    client.on("exitPlanRequest", (req: ExitPlanRequest) => {
      if (gen !== session.gen) return;
      void this.postExitPlanRequest(req, session, gen);
    });
    client.on("questionRequest", (req: QuestionRequest) => {
      if (gen !== session.gen) return;
      this.emit(session, { type: "questionRequest", req });
      this.setStatus(session, "needs-you");
    });
    client.on("exit", (code) => {
      this.untrackPid(client.pid);
      if (gen !== session.gen) return;
      this.emit(session, { type: "exit", code });
      this.setStatus(session, "error");
      this.pool.delete(session);
    });
    client.on("stderr", (text: string) => this.output.append(text));
    try {
      const authTimer = setTimeout(() => {
        if (gen === session.gen) this.emit(session, { type: "startupStatus", text: "Authenticating Grok CLI" });
      }, 2500);
      const slowTimer = setTimeout(() => {
        if (gen === session.gen) this.emit(session, { type: "startupStatus", text: "Loading models and skills" });
      }, 7000);
      try {
        await client.start();
      } finally {
        clearTimeout(authTimer);
        clearTimeout(slowTimer);
      }
      this.trackPid(client.pid);
      if (gen !== session.gen) { client.dispose(); return undefined; }
      const defaultModel = cfg.get<string>("defaultModel", "");
      if (resumeId) {
        const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
        const saved = overrides[resumeId]?.plans ?? [];
        if (saved.length > 0) {
          this.emit(session, { type: "planHistoryQueue", plans: await this.withPlanReviewPaths(saved, resumeId) });
          session.lastPlanText = saved[saved.length - 1].text;
        } else {
          const planPath = path.join(sessionsDirFor(resolveGrokHome(process.env), cwd), resumeId, "plan.md");
          if (fs.existsSync(planPath)) {
            try {
              const planText = fs.readFileSync(planPath, "utf8");
              let snapshot: { path: string; name: string } | undefined;
              try {
                snapshot = await this.createPlanReviewSnapshot(planText, resumeId);
              } catch (e) {
                this.output.appendLine(`[plan-review] ${(e as Error).message}`);
              }
              this.emit(session, {
                type: "planHistoryQueue",
                plans: [{
                  text: planText,
                  verdict: undefined as any,
                  planPath: snapshot?.path,
                  planName: snapshot?.name,
                }],
              });
              session.lastPlanText = planText;
            } catch (e) {
              this.output.appendLine(`[plan-restore] ${(e as Error).message}`);
            }
          }
        }
        this.emit(session, { type: "historyReplay", active: true });
        session.replaying = true;
        try {
          await withSessionOpenTimeout(
            "Opening Grok session",
            client.loadSession(resumeId, defaultModel || undefined),
          );
        } catch (e) {
          if (!isIncompatibleAgentError(e)) throw e;
          this.output.appendLine(
            `[resume] kept the session's own model; default '${defaultModel}' needs a different agent`,
          );
        } finally {
          session.replaying = false;
          this.emit(session, { type: "historyReplay", active: false });
        }
        session.activeSessionId = resumeId;
        session.titleGenerated = true;
        session.hasHistory = true;
        const decision = decideRestoreState(saved);
        this.setPlanActive(session, decision.planActive);
        const targetMode = decision.cliMode === "plan" ? "plan" : ACT_MODE_ID;
        try { await client.setMode(targetMode); } catch {  }
      } else {
        await withSessionOpenTimeout(
          "Opening Grok session",
          client.newSession(defaultModel || undefined),
        );
        session.activeSessionId = client.sessionId;
      }
      if (gen !== session.gen) { client.dispose(); session.client = undefined; return undefined; }
      session.priming = false;
      this.pool.add(session);
      this.touch(session);
      this.reapPool();
      this.emit(session, { type: "setBusy", value: false });
      void this.ensurePrimed(client, session, gen);
    } catch (err) {
      if (gen !== session.gen) { client.dispose(); return undefined; }
      const msg = (err as any).message ?? String(err);
      const authState = await this.probeCliAuthentication(cliPath, env);
      session.gen += 1;
      client.dispose();
      session.client = undefined;
      this.pool.delete(session);
      session.priming = false;
      this.emit(session, { type: "setBusy", value: false });
      if (authState === "auth-required" || /auth|unauthor|forbidden|401|403|api[_\s-]?key|credential|sign.?in/i.test(msg)) {
        this.emit(session, { type: "onboarding", state: "auth-required" });
      } else {
        this.emit(session, { type: "error", text: `Failed to start Grok: ${msg}` });
      }
      return undefined;
    }
    return client;
  }
  private async onMessage(msg: WebviewMsg): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.postInitialState();
        break;
      case "send":
        await this.handleSend(msg.text, msg.chips);
        break;
      case "newSession":
        await this.newFocusedSession();
        break;
      case "cancel":
        await this.focused.client?.cancel();
        break;
      case "pickModel":
        await this.pickModel();
        break;
      case "setMode":
        await this.setMode(msg.modeId);
        break;
      case "removeChip":
        this.chips = removeChip(this.chips, msg.id);
        this.postChips();
        break;
      case "toggleChip":
        this.chips = toggleChip(this.chips, msg.id);
        this.postChips();
        break;
      case "openFile": {
        const ref = parseFileRef(msg.path);
        let p = ref.path;
        if (!path.isAbsolute(p)) {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) p = path.join(root, p);
        }
        const uri = vscode.Uri.file(p);
        if (ref.startLine != null) {
          const startLine = Math.max(0, ref.startLine - 1);
          const endLine = ref.endLine != null ? Math.max(startLine, ref.endLine - 1) : startLine;
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER),
            });
          } catch {
            void vscode.commands.executeCommand("vscode.open", uri);
          }
        } else {
          void vscode.commands.executeCommand("vscode.open", uri);
        }
        break;
      }
      case "openUrl":
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case "openDiff":
        await this.openDiffEditor(msg.path, msg.oldText, msg.newText);
        break;
      case "exportExpr":
        await this.exportExpr(msg);
        break;
      case "dropFile":
        this.addDroppedFile(msg.path, msg.shift);
        break;
      case "pasteImage":
        this.addPastedImage(msg.data, msg.name);
        break;
      case "permissionAnswer":
        this.focused.client?.respondPermission(msg.requestId, msg.optionId);
        this.setStatus(this.focused, "working");
        break;
      case "exitPlanAnswer":
        this.handleExitPlan(msg.requestId, msg.verdict, msg.comment);
        break;
      case "questionAnswer":
        this.focused.client?.respondQuestion(msg.requestId, msg.answers ?? {}, msg.annotations ?? {});
        this.setStatus(this.focused, "working");
        break;
      case "questionCancel":
        this.focused.client?.respondQuestionCancelled(msg.requestId);
        this.setStatus(this.focused, "working");
        break;
      case "setModel":
        await this.switchModel(msg.modelId);
        break;
      case "setEffort": {
        if (this.focused.priming) break;
        const newLevel = msg.level;
        const cfg2 = vscode.workspace.getConfiguration("grok");
        if (!this.focused.hasHistory || !this.focused.client) {
          await cfg2.update("defaultEffort", newLevel, vscode.ConfigurationTarget.Global);
          await this.startSession();
          break;
        }
        const mode = await this.pickRestartMode("Changing reasoning effort requires restarting the session.");
        if (!mode) break;
        await cfg2.update("defaultEffort", newLevel, vscode.ConfigurationTarget.Global);
        await this.restartSession(mode);
        break;
      }
      case "updateConfig": {
        const cfg3 = vscode.workspace.getConfiguration("grok");
        await cfg3.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        if (msg.key === "includeActiveFileByDefault") {
          if (msg.value) {
            this.addActiveEditorChip();
          } else {
            this.chips = clearImplicitChips(this.chips);
            this.postChips();
          }
        }
        break;
      }
      case "openGlobalConfig": {
        const home = process.env.HOME || process.env.USERPROFILE || "";
        const globalCfg = path.join(home, ".grok", "config.toml");
        if (!fs.existsSync(globalCfg)) {
          fs.mkdirSync(path.dirname(globalCfg), { recursive: true });
          fs.writeFileSync(globalCfg, "# Grok global configuration\n");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(globalCfg));
        break;
      }
      case "openProjectConfig": {
        const cwd2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const projCfg = path.join(cwd2, ".grok", "config.toml");
        if (!fs.existsSync(projCfg)) {
          fs.mkdirSync(path.dirname(projCfg), { recursive: true });
          fs.writeFileSync(projCfg, "# Grok project configuration\n# MCP servers here apply to this workspace only.\n");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(projCfg));
        break;
      }
      case "runMcpList": {
        const mcpCli = this.cliPath || locateGrokCli(
          vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
        );
        const mcpCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const term = mcpCli
          ? vscode.window.createTerminal({ name: "Grok MCP", shellPath: mcpCli, shellArgs: ["mcp", "list"], cwd: mcpCwd })
          : vscode.window.createTerminal("Grok MCP");
        term.show();
        if (!mcpCli) term.sendText("grok mcp list");
        break;
      }
      case "showLogs":
        this.output.show();
        break;
      case "runInstallCmd": {
        const term = vscode.window.createTerminal("Install Grok");
        term.show();
        const done = "Done. Click 'Re-check connection' in the Grok sidebar.";
        term.sendText(
          process.platform === "win32"
            ? `irm https://x.ai/cli/install.ps1 | iex; Write-Host "\`n${done}"`
            : `curl -fsSL https://x.ai/cli/install.sh | bash && echo "\\n${done}"`,
        );
        break;
      }
      case "runGrokLogin": {
        const cliPath = this.cliPath || locateGrokCli(
          vscode.workspace.getConfiguration("grok").get<string>("cliPath", ""),
        );
        if (!cliPath) {
          this.post({ type: "onboarding", state: "missing-cli" });
          break;
        }
        const term = vscode.window.createTerminal("Grok Login");
        term.show();
        term.sendText(`"${cliPath}" login`);
        break;
      }
      case "recheckConnection":
        await this.startSession();
        break;
      case "logout":
        await this.logout();
        break;
      case "checkGrokUpdate":
        await this.checkGrokUpdate();
        break;
      case "updateGrok":
        await this.updateGrokCliOnDemand();
        break;
      case "listSessions":
        this.postSessionsList();
        break;
      case "resumeSession":
        await this.openSession(msg.id);
        break;
      case "renameSession":
        this.renameSession(msg.id, msg.name);
        break;
      case "deleteSession":
        await this.deleteSession(msg.id, msg.name);
        break;
      case "pickFile":
        await this.pickFileFromComputer();
        break;
      case "listContext":
        await this.postContextItems(msg.dir);
        break;
      case "addContextPath":
        if (msg.path) {
          this.addDroppedFile(msg.path, false);
          this.reveal();
        }
        break;
    }
  }
  private postSessionsList(): void {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const entries = listSessions({
      fs: defaultFs,
      grokHome: resolveGrokHome(process.env),
      cwd,
      overrides,
      log: (m) => this.output.appendLine(m),
    });
    const dots: Record<string, Dot> = {};
    for (const e of entries) dots[e.id] = this.dotForId(e.id);
    for (const s of this.pool) {
      if (s.activeSessionId && !(s.activeSessionId in dots)) {
        dots[s.activeSessionId] = this.dotForId(s.activeSessionId);
      }
    }
    this.post({
      type: "sessions",
      entries,
      activeId: this.focused.activeSessionId,
      dots,
    });
  }
  private renameSession(id: string, name: string): void {
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const trimmed = (name || "").trim();
    const next: SessionMetaOverrides = { ...overrides };
    if (!trimmed) {
      const cur = next[id];
      if (cur) {
        const { customName: _drop, ...rest } = cur;
        if (Object.keys(rest).length === 0) delete next[id];
        else next[id] = rest;
      }
    } else {
      next[id] = { ...(next[id] ?? {}), customName: trimmed };
    }
    void this.context.globalState.update(SESSION_META_KEY, next);
    this.postSessionsList();
  }
  private async deleteSession(id: string, name?: string): Promise<void> {
    const label = name ? `session "${name}"` : "this session";
    const choice = await vscode.window.showWarningMessage(
      `Delete ${label}? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    try {
      deleteSessionDir({
        fs: defaultFs,
        grokHome: resolveGrokHome(process.env),
        cwd,
        id,
      });
    } catch (e) {
      this.output.appendLine(`[sessions] delete failed for ${id}: ${(e as Error).message}`);
    }
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    if (overrides[id]) {
      const next = { ...overrides };
      delete next[id];
      void this.context.globalState.update(SESSION_META_KEY, next);
    }
    const live = [...this.pool].find((s) => s.activeSessionId === id);
    if (live) {
      const wasFocused = live === this.focused;
      this.disposeSession(live);
      if (wasFocused) {
        this.focused = new Session();
        await this.startSession();
      }
    }
    this.postSessionsList();
  }
  private async postContextItems(dir?: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.post({ type: "contextItems", dir: "", parent: null, items: [] });
      return;
    }
    const root = folders[0].uri;
    const relDir = (dir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const dirUri = relDir ? vscode.Uri.joinPath(root, ...relDir.split("/")) : root;
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      entries = [];
    }
    const IGNORE = new Set(["node_modules", ".git"]);
    type Item = { name: string; relPath: string; fsPath: string; isDir: boolean };
    const dirs: Item[] = [];
    const files: Item[] = [];
    for (const [name, type] of entries) {
      if (IGNORE.has(name)) continue;
      const childRel = relDir ? `${relDir}/${name}` : name;
      const fsPath = vscode.Uri.joinPath(dirUri, name).fsPath;
      const isDir = (type & vscode.FileType.Directory) !== 0;
      (isDir ? dirs : files).push({ name, relPath: childRel, fsPath, isDir });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    const parent = relDir ? (relDir.includes("/") ? relDir.replace(/\/[^/]+$/, "") : "") : null;
    this.post({ type: "contextItems", dir: relDir, parent, items: [...dirs, ...files] });
  }
  private async pickFileFromComputer(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Add to chat",
    });
    if (!picked || picked.length === 0) return;
    for (const uri of picked) {
      this.addDroppedFile(uri.fsPath, false);
    }
    this.reveal();
  }
  private async openDiffEditor(filePath: string, oldText: string, newText: string): Promise<void> {
    const tmp = vscode.Uri.parse(`untitled:${filePath}.before`);
    const after = vscode.Uri.file(filePath);
    const beforeDoc = await vscode.workspace.openTextDocument({ content: oldText, language: "plaintext" });
    const afterDoc = await vscode.workspace.openTextDocument({ content: newText, language: "plaintext" });
    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeDoc.uri,
      afterDoc.uri,
      `Grok proposed: ${path.basename(filePath)}`,
    );
    void tmp; void after;
  }
  private async postExitPlanRequest(req: ExitPlanRequest, session: Session, gen: number): Promise<void> {
    const plan = req.plan || session.lastPlanText;
    let snapshot: { path: string; name: string } | undefined;
    try {
      snapshot = await this.createPlanReviewSnapshot(plan);
    } catch (e) {
      this.output.appendLine(`[plan-review] ${(e as Error).message}`);
    }
    if (gen !== session.gen) return;
    session.pendingPlanText = plan;
    session.lastPlanText = "";
    this.emit(session, {
      type: "exitPlanRequest",
      req: { ...req, plan, planPath: snapshot?.path, planName: snapshot?.name },
    });
    this.setStatus(session, "needs-you");
  }
  private async withPlanReviewPaths<T extends { text: string }>(
    plans: T[],
    sessionId?: string,
  ): Promise<Array<T & { planPath?: string; planName?: string }>> {
    const out: Array<T & { planPath?: string; planName?: string }> = [];
    for (const plan of plans) {
      try {
        const snapshot = await this.createPlanReviewSnapshot(plan.text, sessionId);
        out.push({ ...plan, planPath: snapshot.path, planName: snapshot.name });
      } catch (e) {
        this.output.appendLine(`[plan-review] ${(e as Error).message}`);
        out.push(plan);
      }
    }
    return out;
  }
  private async createPlanReviewSnapshot(plan: string, sessionId?: string): Promise<{ path: string; name: string }> {
    const content = plan && plan.trim() ? plan : "(empty plan)\n";
    const sessionPart = sanitizePlanReviewFilePart(
      sessionId ?? this.focused.activeSessionId ?? this.focused.client?.sessionId ?? "session",
    ).slice(0, 80);
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, "plan-reviews", sessionPart);
    await vscode.workspace.fs.createDirectory(dir);
    const uri = await this.uniquePlanReviewUri(dir, `${planReviewFileBaseName(content)}.md`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    return { path: uri.fsPath, name: path.basename(uri.fsPath) };
  }
  private async uniquePlanReviewUri(dir: vscode.Uri, fileName: string): Promise<vscode.Uri> {
    const ext = path.extname(fileName);
    const stem = path.basename(fileName, ext);
    for (let i = 0; i < 100; i += 1) {
      const suffix = i === 0 ? "" : `-${i + 1}`;
      const uri = vscode.Uri.joinPath(dir, `${stem}${suffix}${ext}`);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        return uri;
      }
    }
    return vscode.Uri.joinPath(dir, `${stem}-${Date.now()}${ext}`);
  }
  private addDroppedFile(absPath: string, shiftHeld: boolean): void {
    if (!fs.existsSync(absPath)) return;
    const uri = vscode.Uri.file(absPath);
    const relPath = vscode.workspace.asRelativePath(uri);
    if (isImagePath(absPath)) {
      try {
        const buf = fs.readFileSync(absPath);
        if (buf.length <= MAX_IMAGE_INLINE_BYTES) {
          const imageData = buf.toString("base64");
          const imageMime = getImageMime(absPath);
          const chip = makeExplicitChip(absPath, absPath);
          chip.imageData = imageData;
          chip.imageMime = imageMime;
          chip.dataUrl = `data:${imageMime};base64,${imageData}`;
          this.chips.push(chip);
          this.postChips();
          return;
        } else {
          vscode.window.showWarningMessage(
            `Image is large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Only smaller images are inlined for vision.`,
          );
        }
      } catch {
      }
    }
    if (shiftHeld) {
      let totalLines: number | undefined;
      try {
        if (shouldReadFileInline(fs.statSync(absPath).size)) {
          totalLines = fs.readFileSync(absPath, "utf8").split("\n").length;
        }
      } catch {
      }
      this.chips.push(
        totalLines != null
          ? makeExplicitChip(absPath, relPath, 1, totalLines)
          : makeExplicitChip(absPath, relPath),
      );
    } else {
      this.chips.push(makeExplicitChip(absPath, relPath));
    }
    this.postChips();
  }
  private addPastedImage(dataUrl: string, name?: string): void {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return;
    const imageMime = m[1];
    const imageData = m[2];
    const buf = Buffer.from(imageData, 'base64');
    const tmpDir = os.tmpdir();
    const attachDir = path.join(tmpDir, 'grok-attached-images');
    fs.mkdirSync(attachDir, { recursive: true });
    const ext = imageMime.includes('png') ? '.png' : (imageMime.includes('jpeg') || imageMime.includes('jpg') ? '.jpg' : '.png');
    const safeName = (name || 'pasted-image').replace(/[^a-z0-9._-]/gi, '_');
    const fileName = `${Date.now()}-${safeName}${ext}`;
    const absPath = path.join(attachDir, fileName);
    fs.writeFileSync(absPath, buf);
    const chip = makeExplicitChip(absPath, absPath);
    chip.imageData = imageData;
    chip.imageMime = imageMime;
    chip.dataUrl = dataUrl;
    this.chips.push(chip);
    this.postChips();
    this.reveal();
  }
  private async handleSend(text: string, chips: FileChip[]): Promise<void> {
    const client = await this.ensureClient();
    if (!client) return;
    const session = this.focused;
    const gen = session.gen;
    const finalPrompt = buildPrompt(text, chips, {
      readFile: (p) => fs.readFileSync(p, "utf8"),
      extName: (p) => path.extname(p),
    });
    this.chips = [];
    this.postChips();
    const isFirstSend = !session.hasHistory;
    session.hasHistory = true;
    if (isFirstSend) session.firstUserMessageForTitle = text;
    const sentChips = chips.filter((c) => !c.hidden);
    session.userMessageCount += 1;
    session.inUserMessage = false;
    this.emit(session, { type: "userMessage", text, chips: sentChips });
    this.emit(session, { type: "agentStart" });
    this.setStatus(session, "working");
    try {
      await this.ensurePrimed(client, session, gen);
      if (gen !== session.gen) return;
      const meta = await client.prompt(finalPrompt);
      if (gen !== session.gen) return;
      if (!session.afterTurn) {
        this.emit(session, { type: "agentEnd", meta });
        this.setStatus(session, "done");
      }
      this.maybeGenerateTitle(session);
    } catch (err) {
      if (gen !== session.gen) return;
      const e = err as any;
      const message = e?.data?.message ?? e?.message ?? String(err);
      this.emit(session, { type: "agentError", text: message });
      this.setStatus(session, "error");
    } finally {
      try { await this.runAfterTurn(session); }
      finally { session.suppressPlanReject = false; }
    }
  }
  private maybeGenerateTitle(session: Session): void {
    if (session.titleGenerated) return;
    const sid = session.client?.sessionId ?? session.activeSessionId;
    const first = session.firstUserMessageForTitle;
    if (!sid || !first) return;
    session.titleGenerated = true;
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    if (overrides[sid]?.customName) return;
    const cleaned = first.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const title = cleaned.length > 50 ? cleaned.slice(0, 47) + "…" : cleaned;
    const next: SessionMetaOverrides = {
      ...overrides,
      [sid]: { ...(overrides[sid] ?? {}), customName: title },
    };
    void this.context.globalState.update(SESSION_META_KEY, next);
  }
  private postInitialState(): void {
    const cfg = vscode.workspace.getConfiguration("grok");
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.post({
      type: "initialState",
      effort: cfg.get("defaultEffort", ""),
      cwd,
      useCtrlEnter: cfg.get("useCtrlEnterToSend", false),
      includeActiveFileByDefault: cfg.get("includeActiveFileByDefault", true),
      extVersion: (this.context.extension.packageJSON as { version?: string })?.version ?? "",
    });
    if (cfg.get<boolean>("includeActiveFileByDefault", true)) {
      this.addActiveEditorChip();
    }
    void this.startSession();
  }
  private postChips(): void {
    this.post({ type: "chips", chips: this.chips });
  }
  private static readonly SUPPRESS_TYPES = new Set([
    "messageChunk", "userMessageChunk", "thoughtChunk", "toolCall", "toolCallUpdate", "hostActivity",
    "promptComplete", "providerNotification", "agentEnd",
  ]);
  private static readonly PLAN_REJECT_SUPPRESS = new Set([
    "messageChunk", "userMessageChunk", "thoughtChunk", "toolCall", "toolCallUpdate", "hostActivity", "providerNotification",
  ]);
  private post(message: any): void {
    if (this.focused.suppressContent && GrokSidebar.SUPPRESS_TYPES.has(message.type)) return;
    if (this.focused.suppressPlanReject && GrokSidebar.PLAN_REJECT_SUPPRESS.has(message.type)) return;
    this.view?.webview.postMessage(message);
  }
  private emit(session: Session, message: any): void {
    if (session.suppressContent && GrokSidebar.SUPPRESS_TYPES.has(message.type)) return;
    if (session.suppressPlanReject && GrokSidebar.PLAN_REJECT_SUPPRESS.has(message.type)) return;
    if (message.type === "clearMessages") session.buffer = [];
    else session.buffer.push(message);
    if (session === this.focused) this.view?.webview.postMessage(message);
  }
  private focusSession(session: Session): void {
    if (session === this.focused) return;
    this.focused = session;
    this.touch(session);
    this.markRead(session);
    const wv = this.view?.webview;
    if (wv) {
      wv.postMessage({ type: "clearMessages" });
      for (const m of session.buffer) wv.postMessage(m);
    }
    this.postMode();
    this.postSessionsList();
  }
  private parkFocused(): void {
    const cur = this.focused;
    const busy = cur.status === "working" || cur.status === "needs-you";
    if (!cur.hasHistory && !cur.afterTurn && !busy) this.disposeSession(cur);
  }
  private disposeSession(session: Session): void {
    const id = session.activeSessionId;
    session.gen++;
    session.client?.dispose();
    session.client = undefined;
    this.pool.delete(session);
    if (id) this.post({ type: "sessionDot", id, dot: this.dotForId(id) });
  }
  private touch(session: Session): void {
    session.lastActiveAt = Date.now();
  }
  private reapPool(): void {
    const candidates = [...this.pool].map((session) => ({
      session,
      status: session.status,
      lastActiveAt: session.lastActiveAt,
      focused: session === this.focused,
    }));
    const doomed = selectReapable(candidates, {
      maxLive: GrokSidebar.MAX_LIVE_SESSIONS,
      idleTtlMs: GrokSidebar.IDLE_TTL_MS,
      now: Date.now(),
    });
    for (const c of doomed) this.disposeSession(c.session);
  }
  private setStatus(session: Session, status: SessionStatus): void {
    if (session.status === status) return;
    session.status = status;
    if (status === "working" || status === "needs-you") this.touch(session);
    if ((status === "done" || status === "error") && session !== this.focused) {
      this.setMetaUnread(session.activeSessionId, true, status === "error");
    }
    this.pushDot(session);
  }
  private pushDot(session: Session): void {
    const id = session.activeSessionId;
    if (id) this.post({ type: "sessionDot", id, dot: this.dotForId(id) });
  }
  private dotForId(id: string): Dot {
    const live = [...this.pool].find((s) => s.activeSessionId === id);
    const meta = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {})[id];
    return computeDot({ liveStatus: live?.status, unread: meta?.unread, unreadError: meta?.unreadError });
  }
  private setMetaUnread(id: string | undefined, unread: boolean, error: boolean): void {
    if (!id) return;
    const overrides = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {});
    const cur = overrides[id] ?? {};
    const next: SessionMetaOverrides = { ...overrides };
    if (unread) {
      if (cur.unread && !!cur.unreadError === error) return;
      next[id] = { ...cur, unread: true, unreadError: error || undefined };
    } else {
      if (!cur.unread && !cur.unreadError) return;
      const { unread: _u, unreadError: _e, ...rest } = cur;
      if (Object.keys(rest).length === 0) delete next[id];
      else next[id] = rest;
    }
    void this.context.globalState.update(SESSION_META_KEY, next);
  }
  private markRead(session: Session): void {
    const id = session.activeSessionId;
    if (!id) return;
    const meta = this.context.globalState.get<SessionMetaOverrides>(SESSION_META_KEY, {})[id];
    if (!meta?.unread && !meta?.unreadError) return;
    this.setMetaUnread(id, false, false);
    this.pushDot(session);
  }
  private disposePool(): void {
    for (const s of this.pool) {
      s.gen++;
      s.client?.dispose();
      s.client = undefined;
    }
    this.pool.clear();
  }
  private trackPid(pid: number | undefined): void {
    if (!pid) return;
    const pids = this.context.workspaceState.get<number[]>(LIVE_PIDS_KEY, []);
    if (!pids.includes(pid)) {
      void this.context.workspaceState.update(LIVE_PIDS_KEY, [...pids, pid]);
    }
  }
  private untrackPid(pid: number | undefined): void {
    if (!pid) return;
    const pids = this.context.workspaceState.get<number[]>(LIVE_PIDS_KEY, []);
    if (pids.includes(pid)) {
      void this.context.workspaceState.update(LIVE_PIDS_KEY, pids.filter((p) => p !== pid));
    }
  }
  private isGrokProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        if (process.platform === "win32") {
          execFile("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], (err, stdout) => {
            resolve(!err && /grok/i.test(stdout || ""));
          });
        } else {
          execFile("ps", ["-p", String(pid), "-o", "comm="], (err, stdout) => {
            resolve(!err && /grok/i.test(stdout || ""));
          });
        }
      } catch { resolve(false); }
    });
  }
  private async sweepOrphanGrokProcesses(): Promise<void> {
    const pids = this.context.workspaceState.get<number[]>(LIVE_PIDS_KEY, []);
    if (!pids.length) return;
    await this.context.workspaceState.update(LIVE_PIDS_KEY, []);
    for (const pid of pids) {
      if (await this.isGrokProcess(pid)) {
        this.output.appendLine(`[cleanup] tree-killing orphaned grok process ${pid} from a prior session`);
        killGrokTree(pid, (m) => this.output.appendLine(m));
      }
    }
  }
  private async newFocusedSession(): Promise<void> {
    this.parkFocused();
    this.focused = new Session();
    await this.startSession();
  }
  private async openSession(id: string): Promise<void> {
    for (const s of this.pool) {
      if (s.activeSessionId === id && s.client) {
        this.focusSession(s);
        return;
      }
    }
    this.parkFocused();
    this.focused = new Session();
    await this.startSession(id);
    this.markRead(this.focused);
  }
  private reveal(): void {
    this.view?.show?.(true);
  }
  private watchActiveEditor(): void {
    this.editorWatcher?.dispose();
    this.editorWatcher = vscode.window.onDidChangeActiveTextEditor(() => {
      const includeActive = vscode.workspace
        .getConfiguration("grok")
        .get<boolean>("includeActiveFileByDefault", true);
      if (!includeActive) return;
      this.chips = clearImplicitChips(this.chips);
      this.addActiveEditorChip();
    });
  }
  private addActiveEditorChip(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    const abs = editor.document.uri.fsPath;
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    if (isImagePath(abs) && fs.existsSync(abs)) {
      try {
        const buf = fs.readFileSync(abs);
        if (buf.length <= MAX_IMAGE_INLINE_BYTES) {
          const imageData = buf.toString("base64");
          const imageMime = getImageMime(abs);
          const chip = makeImplicitChip(abs, abs);
          chip.imageData = imageData;
          chip.imageMime = imageMime;
          chip.dataUrl = `data:${imageMime};base64,${imageData}`;
          this.chips.push(chip);
          this.postChips();
          return;
        }
      } catch {}
    }
    this.chips.push(makeImplicitChip(abs, relPath));
    this.postChips();
  }
  private readDotEnv(cwd: string): Record<string, string> {
    const dotEnv: Record<string, string> = {};
    try {
      const content = fs.readFileSync(path.join(cwd, ".env"), "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (key) dotEnv[key] = val;
      }
    } catch {  }
    return dotEnv;
  }
  private buildEnv(cwd: string): NodeJS.ProcessEnv {
    const dotEnv = this.readDotEnv(cwd);
    const env: NodeJS.ProcessEnv = { ...process.env, ...dotEnv };
    for (const key of [
      "GROK_CLAUDE_SKILLS_ENABLED",
      "GROK_CLAUDE_RULES_ENABLED",
      "GROK_CLAUDE_AGENTS_ENABLED",
      "GROK_CLAUDE_MCPS_ENABLED",
      "GROK_CLAUDE_HOOKS_ENABLED",
      "GROK_CURSOR_SKILLS_ENABLED",
      "GROK_CURSOR_RULES_ENABLED",
      "GROK_CURSOR_AGENTS_ENABLED",
      "GROK_CURSOR_MCPS_ENABLED",
      "GROK_CURSOR_HOOKS_ENABLED",
    ]) {
      env[key] = "false";
    }
    if (Object.keys(dotEnv).length > 0) {
      this.output.appendLine(`[env] loaded ${Object.keys(dotEnv).length} var(s) from .env`);
    }
    return env;
  }
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const mediaUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", file));
    const resourceUri = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", file));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Grok CLI Copilot</title>
<meta name="application-name" content="Grok CLI Copilot" />
<meta name="description" content="Grok CLI Copilot VS Code sidebar client for the Grok CLI." />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data:; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="icon" href="${resourceUri("supergrok-icon.png")}" />
<link rel="stylesheet" href="${mediaUri("webview/app.css")}" />
</head>
<body>
      <header class="top-bar">
        <div class="top-brand" aria-label="Grok CLI Copilot">
          <div class="top-brand-copy">
            <span class="top-brand-title">Grok CLI Copilot</span>
            <span class="top-brand-status">CLI agent</span>
          </div>
    </div>
    <div class="top-actions">
      <button id="history-btn" class="toolbar-btn" title="Session history"></button>
      <button id="new-btn" class="toolbar-btn" title="New session"></button>
    </div>
    <div id="history-popover" class="toolbar-popover history-popover" hidden></div>
  </header>
  <main id="messages" class="messages">
    <div class="welcome" id="welcome">
      <h2>Grok CLI Copilot</h2>
      <p class="welcome-byline muted">Grok CLI, rebuilt for a sharper VS Code workflow</p>
      <p id="welcome-version" class="muted loading-dots">Starting</p>
      <div id="welcome-onboarding"></div>
    </div>
  </main>
  <footer class="composer">
    <div class="composer-input-wrap">
      <div id="attach-previews" class="attach-previews" hidden></div>
      <textarea id="input" placeholder="Ask Grok CLI Copilot..." rows="3"></textarea>
    </div>
    <div class="composer-toolbar">
      <div class="toolbar-left">
        <button id="add-btn" class="toolbar-btn" title="Add context"></button>
        <button id="slash-btn" class="toolbar-btn slash-btn" title="Commands"></button>
        <div class="context-donut" id="donut" aria-label="Context usage">
          <svg width="13" height="13" viewBox="0 0 13 13">
            <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--vscode-foreground,#fff)" stroke-width="1.6"/>
            <circle id="donut-arc" cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--vscode-descriptionForeground,#888)" stroke-width="1.6" stroke-dasharray="0 999" transform="rotate(-90 6.5 6.5)"/>
          </svg>
          <span id="donut-label" class="small muted">0%</span>
          <div id="donut-tip" class="donut-tip">
            <span class="donut-tip-main">100% context left</span>
            <span class="donut-tip-sub">0 tokens used</span>
          </div>
        </div>
        <div id="chips"></div>
      </div>
      <div class="toolbar-right">
        <button id="mode-btn" class="toolbar-btn" title="Pick mode"></button>
        <button id="send-btn" class="send"></button>
      </div>
    </div>
    <div id="mode-popover" class="toolbar-popover" hidden></div>
    <div id="settings-popover" class="toolbar-popover settings-popover" hidden></div>
    <div id="add-popover" class="toolbar-popover" hidden></div>
    <div id="context-popover" class="slash-popover context-popover" hidden></div>
    <div id="slash-popover" class="slash-popover" hidden></div>
  </footer>
  <link rel="stylesheet" href="${mediaUri("vendor/katex/katex.min.css")}" />
  <script nonce="${nonce}" src="${mediaUri("vendor/katex/katex.min.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("vendor/mermaid/mermaid.min.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("webview/helpers.js")}"></script>
  <script nonce="${nonce}" src="${mediaUri("webview/app.js")}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
