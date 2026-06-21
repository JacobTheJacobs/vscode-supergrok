import { ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createInterface, Interface } from "node:readline";
import { EventEmitter } from "node:events";
import {
  collectToolImages,
  extractGeneratedMediaPaths,
  isMediaGenToolCall,
  extractPromptMeta,
  makeAckResponse,
  makeExitPlanResponse,
  makePermissionResponse,
  makeQuestionCancelledResponse,
  makeQuestionResponse,
  makeRequest,
  parseAcpLine,
  routeSessionUpdate,
} from "./dispatch";
import {
  PLAN_BLOCKED_CODE,
  PLAN_BLOCKED_TERMINAL_MSG,
  PLAN_BLOCKED_WRITE_MSG,
  isPlanFileWrite,
  shouldBlockTerminal,
  shouldBlockWrite,
} from "../plan/gate";
import { resolveGrokHome } from "../sessions/store";

export type EffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AcpClientOptions {
  cliPath: string;
  cwd: string;
  effort?: EffortLevel;
  env?: NodeJS.ProcessEnv;
  log: (msg: string) => void;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
  totalContextTokens?: number;
}

export interface SlashCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
}

export interface PromptResultMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
}

export interface PermissionOption {
  optionId: string;
  kind: string;
  name: string;
}

export interface PermissionRequest {
  id: number | string;
  sessionId: string;
  toolCall: {
    toolCallId: string;
    kind: string;
    title: string;
    rawInput?: any;
  };
  options: PermissionOption[];
}

export interface ExitPlanRequest {
  id: number | string;
  sessionId: string;
  plan: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface QuestionItem {
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionRequest {
  id: number | string;
  sessionId: string;
  questions: QuestionItem[];
}

export interface FsReadHandler {
  (path: string): Promise<string>;
}
export interface FsWriteHandler {
  (path: string, content: string): Promise<void>;
}
export interface TerminalHandler {
  create(params: { command: string; env?: Array<{ name: string; value: string }>; cwd?: string; outputByteLimit?: number }): { terminalId: string };
  output(terminalId: string): { output: string; exitStatus: { exitCode: number } | null; truncated: boolean };
  waitForExit(terminalId: string): Promise<{ exitCode: number }>;
  kill(terminalId: string): void;
  release(terminalId: string): void;
}

export interface HostActivity {
  id: string;
  phase: "start" | "complete" | "error";
  kind: "read" | "write" | "terminal" | "terminal-output" | "terminal-wait";
  title: string;
  detail?: string;
  result?: string;
  error?: string;
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer?: ReturnType<typeof setTimeout> };

export function buildGrokAgentArgs(effort?: EffortLevel): string[] {
  // grok 0.2.60's standalone `agent stdio` hangs: a remote policy disables leader
  // mode, and the standalone path never answers the ACP handshake. Forcing
  // --leader makes grok run/connect to its leader process, which works.
  const args = ["agent", "--leader"];
  if (effort) args.push("--reasoning-effort", effort);
  args.push("stdio");
  return args;
}

function quoteWindowsCmdArg(value: string): string {
  return /[\s&()^|<>"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function killGrokTree(pid: number | undefined, log?: (m: string) => void): void {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], (err) => {
        if (err && log) log(`[acp] taskkill ${pid}: ${err.message}`);
      });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {  } }
    }
  } catch (e) {
    if (log) log(`[acp] killGrokTree ${pid}: ${(e as Error).message}`);
  }
}

const CLI_WIRE_METHOD: Record<string, string[]> = {
  exitPlanMode: ["x.ai/exit_plan_mode", "_x.ai/exit_plan_mode"],
  askUserQuestion: ["x.ai/ask_user_question", "_x.ai/ask_user_question"],
  sessionNotification: ["x.ai/session_notification", "_x.ai/session_notification"],
  promptComplete: ["x.ai/session/prompt_complete", "_x.ai/session/prompt_complete"],
};

export class AcpClient extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private spawnedPid?: number;
  private rl?: Interface;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  sessionId?: string;
  currentModelId?: string;
  currentModeId?: string;
  availableModels: ModelInfo[] = [];
  availableCommands: SlashCommand[] = [];
  lastMeta?: PromptResultMeta;
  private mediaGenCallIds = new Set<string>();
  planActive = false;
  fsRead?: FsReadHandler;
  fsWrite?: FsWriteHandler;
  terminal?: TerminalHandler;
  constructor(private opts: AcpClientOptions) {
    super();
  }
  async start(): Promise<void> {
    const args = buildGrokAgentArgs(this.opts.effort);
    this.opts.log(`spawning ${this.opts.cliPath} ${args.join(" ")} (cwd=${this.opts.cwd})`);
    const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(this.opts.cliPath);
    const command = needsShell ? (process.env.ComSpec || "cmd.exe") : this.opts.cliPath;
    const commandArgs = needsShell
      ? ["/d", "/s", "/c", `"${[this.opts.cliPath, ...args].map(quoteWindowsCmdArg).join(" ")}"`]
      : args;
    this.proc = spawn(command, commandArgs, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      windowsVerbatimArguments: needsShell,
    });
    this.spawnedPid = this.proc.pid;
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.onLine(line));
    this.proc.stdin.on("error", (err) => {
      this.opts.log(`[acp] stdin error: ${(err as Error).message}`);
    });
    this.proc.stderr.on("data", (d) => {
      const text = d.toString();
      this.opts.log(`[stderr] ${text}`);
      this.emit("stderr", text);
    });
    this.proc.on("exit", (code) => {
      this.opts.log(`grok exited with code ${code}`);
      this.proc = undefined;
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        if (p.timer) clearTimeout(p.timer);
        p.reject(new Error(`Grok process exited (code ${code})`));
      }
      this.emit("exit", code);
    });
    this.proc.on("error", (err) => {
      this.opts.log(`spawn error: ${err.message}`);
      this.emit("error", err);
    });
    const init = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    this.emit("initialized", init);
  }
  async newSession(modelId?: string): Promise<{ sessionId: string }> {
    const res = await this.request("session/new", {
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    this.sessionId = res.sessionId;
    this.currentModelId = res.models?.currentModelId;
    this.availableModels = (res.models?.availableModels ?? []).map((m: any) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description,
      totalContextTokens: m._meta?.totalContextTokens,
    }));
    this.emit("session", res);
    if (modelId && modelId !== this.currentModelId) {
      await this.setModel(modelId);
    }
    return { sessionId: res.sessionId };
  }
  async loadSession(sessionId: string, modelId?: string): Promise<{ sessionId: string }> {
    const res = await this.request("session/load", {
      sessionId,
      cwd: this.opts.cwd,
      mcpServers: [],
    });
    this.sessionId = sessionId;
    this.currentModelId = res?.models?.currentModelId ?? this.currentModelId;
    if (res?.models?.availableModels) {
      this.availableModels = res.models.availableModels.map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        totalContextTokens: m._meta?.totalContextTokens,
      }));
    }
    this.emit("session", { sessionId, ...(res ?? {}) });
    this.emit("sessionLoaded", { sessionId });
    if (modelId && modelId !== this.currentModelId) {
      await this.setModel(modelId);
    }
    return { sessionId };
  }
  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) throw new Error("no session");
    const res = await this.request("session/set_model", {
      sessionId: this.sessionId,
      modelId,
    });
    const ok = res?._meta?.model?.Ok;
    if (ok) {
      this.currentModelId = ok;
      this.emit("modelChanged", ok);
    }
  }
  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) throw new Error("no session");
    await this.request("session/set_mode", {
      sessionId: this.sessionId,
      modeId,
    });
  }
  async prompt(text: string): Promise<PromptResultMeta> {
    if (!this.sessionId) throw new Error("no session");
    const result = await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
    const meta = extractPromptMeta(result);
    this.lastMeta = meta;
    this.emit("promptComplete", meta);
    return meta;
  }
  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    this.writeLine({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
  }
  respondPermission(requestId: number | string, optionId: string): void {
    this.writeLine(makePermissionResponse(requestId, optionId));
  }
  respondExitPlan(requestId: number | string, type: "approved" | "abandoned" | "rejected"): void {
    this.writeLine(makeExitPlanResponse(requestId, type));
  }
  respondQuestion(
    requestId: number | string,
    answers: Record<string, string>,
    annotations: Record<string, { notes?: string; preview?: string }> = {},
  ): void {
    this.writeLine(makeQuestionResponse(requestId, answers, annotations));
  }
  respondQuestionCancelled(requestId: number | string): void {
    this.writeLine(makeQuestionCancelledResponse(requestId));
  }
  get pid(): number | undefined { return this.spawnedPid; }
  dispose(): void {
    this.rl?.close();
    killGrokTree(this.spawnedPid, this.opts.log);
    try { this.proc?.kill(); } catch {  }
    this.proc = undefined;
  }
  private writeLine(obj: unknown): boolean {
    const proc = this.proc;
    if (!proc || proc.killed || !proc.stdin.writable) return false;
    try {
      proc.stdin.write(JSON.stringify(obj) + "\n");
      return true;
    } catch (err) {
      this.opts.log(`[acp] stdin write failed: ${(err as Error).message}`);
      return false;
    }
  }
  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      this.pending.set(id, entry);
      if (!this.writeLine(makeRequest(id, method, params))) {
        this.pending.delete(id);
        reject(new Error(`Grok process is not running (${method})`));
        return;
      }
      const timeoutMs = method === "session/prompt" ? 1_800_000 : 120_000;
      entry.timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`ACP request timed out: ${method}`));
        }
      }, timeoutMs);
    });
  }
  private respondOk(id: number | string, result: any = {}): void {
    this.writeLine(makeAckResponse(id, result));
  }
  private respondError(id: number | string, code: number, message: string): void {
    this.writeLine({ jsonrpc: "2.0", id, error: { code, message } });
  }
  private onLine(line: string): void {
    const ev = parseAcpLine(line);
    if (!ev) return;
    if (ev.kind === "non-json") {
      this.opts.log(`[non-json] ${ev.line.slice(0, 200)}`);
      return;
    }
    if (ev.kind === "response") {
      const p = this.pending.get(ev.id as number);
      if (p) {
        this.pending.delete(ev.id as number);
        if (p.timer) clearTimeout(p.timer);
        if (ev.error) p.reject(ev.error);
        else p.resolve(ev.result);
      }
      return;
    }
    if (ev.kind === "session-update") {
      this.handleSessionUpdate(ev.update);
      return;
    }
    void this.handleServerRequest({ id: ev.id, method: ev.method, params: ev.params });
  }
  private handleSessionUpdate(u: any): void {
    const r = routeSessionUpdate(u);
    if (!r) return;
    if (r.event === "modeChanged") {
      this.currentModeId = r.modeId;
      this.emit("modeChanged", r.modeId);
      return;
    }
    if (r.event === "commandsUpdate") {
      this.availableCommands = r.commands;
      this.emit("commandsUpdate", r.commands);
      return;
    }
    if (r.event === "messageChunk") this.emit("messageChunk", r.text);
    else if (r.event === "userMessageChunk") this.emit("userMessageChunk", r.text);
    else if (r.event === "thoughtChunk") this.emit("thoughtChunk", r.text);
    else if (r.event === "mediaContent") this.emit("mediaContent", r.media);
    else if (r.event === "toolCall") {
      this.emit("toolCall", r.payload);
      this.emitToolMedia(r.payload);
    } else if (r.event === "toolCallUpdate") {
      this.emit("toolCallUpdate", r.payload);
      this.emitToolMedia(r.payload);
    } else if (r.event === "plan") this.emit("plan", r.payload);
    else this.emit("update", r.payload);
  }
  private emitToolMedia(payload: any): void {
    const id = payload?.toolCallId;
    if (isMediaGenToolCall(payload) && typeof id === "string") this.mediaGenCallIds.add(id);
    const media = collectToolImages(payload);
    if (typeof id === "string" && this.mediaGenCallIds.has(id)) {
      media.push(...extractGeneratedMediaPaths(payload));
    }
    for (const m of media) this.emit("mediaContent", m);
  }
  private async handleServerRequest(msg: any): Promise<void> {
    const { method, id, params } = msg;
    const activity = this.activityForServerRequest(method, id, params);
    if (activity) this.emit("hostActivity", activity);
    try {
      if (method === "fs/read_text_file") {
        if (!this.fsRead) throw new Error("fsRead handler not registered");
        const content = await this.fsRead(params.path);
        this.completeHostActivity(activity, `${content.length} chars`);
        this.respondOk(id, { content });
        return;
      }
      if (method === "fs/write_text_file") {
        if (!this.fsWrite) throw new Error("fsWrite handler not registered");
        if (isPlanFileWrite(params.path)) {
          this.emit("planFileContent", params.content ?? "");
        }
        if (shouldBlockWrite(params.path, {
          active: this.planActive,
          workspaceRoot: this.opts.cwd,
          grokHome: resolveGrokHome(this.opts.env ?? process.env),
        })) {
          this.emit("mutationBlocked", { kind: "write", target: params.path });
          this.failHostActivity(activity, PLAN_BLOCKED_WRITE_MSG);
          this.respondError(id, PLAN_BLOCKED_CODE, PLAN_BLOCKED_WRITE_MSG);
          return;
        }
        await this.fsWrite(params.path, params.content);
        this.completeHostActivity(activity, `${String(params.content ?? "").length} chars`);
        this.respondOk(id, {});
        return;
      }
      if (method === "terminal/create") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        if (shouldBlockTerminal(params.command, { active: this.planActive, workspaceRoot: this.opts.cwd })) {
          this.emit("mutationBlocked", { kind: "terminal", target: params.command });
          this.failHostActivity(activity, PLAN_BLOCKED_TERMINAL_MSG);
          this.respondError(id, PLAN_BLOCKED_CODE, PLAN_BLOCKED_TERMINAL_MSG);
          return;
        }
        const created = this.terminal.create(params);
        this.completeHostActivity(activity, `terminal ${created.terminalId}`);
        this.respondOk(id, created);
        return;
      }
      if (method === "terminal/output") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        const output = this.terminal.output(params.terminalId);
        this.completeHostActivity(activity, output.output || (output.exitStatus ? `exit ${output.exitStatus.exitCode}` : ""));
        this.respondOk(id, output);
        return;
      }
      if (method === "terminal/wait_for_exit") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        const r = await this.terminal.waitForExit(params.terminalId);
        this.completeHostActivity(activity, `exit ${r.exitCode}`);
        this.respondOk(id, r);
        return;
      }
      if (method === "terminal/kill") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.terminal.kill(params.terminalId);
        this.respondOk(id, {});
        return;
      }
      if (method === "terminal/release") {
        if (!this.terminal) throw new Error("terminal handler not registered");
        this.terminal.release(params.terminalId);
        this.respondOk(id, {});
        return;
      }
      if (method === "session/request_permission") {
        const req: PermissionRequest = {
          id,
          sessionId: params.sessionId,
          toolCall: params.toolCall,
          options: params.options ?? [],
        };
        this.emit("permissionRequest", req);
        return;
      }
      if (CLI_WIRE_METHOD.exitPlanMode.includes(method)) {
        const req: ExitPlanRequest = {
          id,
          sessionId: params?.sessionId ?? this.sessionId ?? "",
          plan: params?.planContent ?? params?.plan ?? params?.input?.plan ?? "",
        };
        this.emit("exitPlanRequest", req);
        return;
      }
      if (CLI_WIRE_METHOD.askUserQuestion.includes(method)) {
        const req: QuestionRequest = {
          id,
          sessionId: params?.sessionId ?? this.sessionId ?? "",
          questions: Array.isArray(params?.questions) ? params.questions : [],
        };
        this.emit("questionRequest", req);
        return;
      }
      if (CLI_WIRE_METHOD.sessionNotification.includes(method)) {
        this.emit("providerNotification", params?.update);
        if (id != null) this.respondOk(id, {});
        return;
      }
      if (CLI_WIRE_METHOD.promptComplete.includes(method)) {
        this.emit("providerPromptComplete", params);
        if (id != null) this.respondOk(id, {});
        return;
      }
      this.emit("serverRequest", msg);
      if (id != null) this.respondOk(id, {});
    } catch (err) {
      this.failHostActivity(activity, (err as Error).message || "Internal error");
      this.opts.log(`server request handler error (${method}): ${(err as Error).message}`);
      if (id != null) {
        this.respondError(id, -32603, (err as Error).message || "Internal error");
      }
    }
  }
  private activityForServerRequest(method: string, id: number | string, params: any): HostActivity | undefined {
    const activityId = `${method}:${String(id)}`;
    if (method === "fs/read_text_file") {
      const path = String(params?.path ?? "");
      return { id: activityId, phase: "start", kind: "read", title: path ? `Reading ${path}` : "Reading file", detail: path };
    }
    if (method === "fs/write_text_file") {
      const path = String(params?.path ?? "");
      return { id: activityId, phase: "start", kind: "write", title: path ? `Writing ${path}` : "Writing file", detail: path };
    }
    if (method === "terminal/create") {
      const command = String(params?.command ?? "");
      return { id: activityId, phase: "start", kind: "terminal", title: command ? `Running ${command}` : "Running command", detail: command };
    }
    if (method === "terminal/output") {
      const terminalId = String(params?.terminalId ?? "");
      return { id: activityId, phase: "start", kind: "terminal-output", title: terminalId ? `Reading terminal ${terminalId}` : "Reading terminal output", detail: terminalId };
    }
    if (method === "terminal/wait_for_exit") {
      const terminalId = String(params?.terminalId ?? "");
      return { id: activityId, phase: "start", kind: "terminal-wait", title: terminalId ? `Waiting for terminal ${terminalId}` : "Waiting for command", detail: terminalId };
    }
    return undefined;
  }
  private completeHostActivity(activity: HostActivity | undefined, result?: string): void {
    if (!activity) return;
    this.emit("hostActivity", { ...activity, phase: "complete", result });
  }
  private failHostActivity(activity: HostActivity | undefined, error: string): void {
    if (!activity) return;
    this.emit("hostActivity", { ...activity, phase: "error", error });
  }
}
