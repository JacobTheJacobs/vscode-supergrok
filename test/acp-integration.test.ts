import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { AcpClient } from "../src/acp/client";

function fixtureCli(): string {
  const dir = path.join(__dirname, "fixtures");
  return process.platform === "win32"
    ? path.join(dir, "fake-grok-acp.cmd")
    : path.join(dir, "fake-grok-acp.sh");
}

beforeAll(() => {
  if (process.platform !== "win32") {
    const sh = path.join(__dirname, "fixtures", "fake-grok-acp.sh");
    try { fs.chmodSync(sh, 0o755); } catch {  }
  }
});

function collect<T>(client: AcpClient, event: string): T[] {
  const out: T[] = [];
  client.on(event, (v) => out.push(v));
  return out;
}

function waitFor<T>(client: AcpClient, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    client.once(event, (v) => { clearTimeout(t); resolve(v); });
  });
}

async function waitForStderr(arr: string[], re: RegExp, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!re.test(arr.join(""))) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`stderr never matched ${re}; got: ${JSON.stringify(arr.join(""))}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("ACP integration (real subprocess, fake CLI)", () => {
  let client: AcpClient;
  let workspace: string;
  let planHome: string;
  let stderr: string[];
  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "grok-int-ws-"));
    planHome = fs.mkdtempSync(path.join(os.tmpdir(), "grok-int-plan-"));
    const planPath = path.join(planHome, ".grok", "sessions", "cwd-x", "sess-y", "plan.md");
    const captured: string[] = [];
    stderr = captured;
    client = new AcpClient({
      cliPath: fixtureCli(),
      cwd: workspace,
      env: {
        ...process.env,
        FAKE_WORKSPACE_ROOT: workspace,
        FAKE_PLAN_PATH: planPath,
      },
      log: () => {},
    });
    client.on("stderr", (t: string) => captured.push(t));
    client.fsRead = async (p) => fs.readFileSync(p, "utf8");
    client.fsWrite = async (p, content) => {
      const target = path.isAbsolute(p) ? p : path.join(workspace, p);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    };
    let terminalCalls = 0;
    (client as any).terminal = {
      create: (params: { command: string }) => { terminalCalls += 1; return { terminalId: `t-${terminalCalls}` }; },
      output: () => ({ output: "", exitStatus: { exitCode: 0 }, truncated: false }),
      waitForExit: async () => ({ exitCode: 0 }),
      kill: () => {},
      release: () => {},
    };
    (client as any).__terminalCalls = () => terminalCalls;
    await client.start();
    await client.newSession();
  });
  afterEach(() => {
    try { client.removeAllListeners(); } catch {  }
    try { (client as any).proc?.kill(); } catch {  }
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {  }
    try { fs.rmSync(planHome, { recursive: true, force: true }); } catch {  }
  });
  it("lifecycle: spawn → initialize → session/new succeeds and a basic prompt round-trips", async () => {
    expect(client.sessionId).toBe("fake-session-1");
    const meta = await client.prompt("hello");
    expect(meta).toMatchObject({ totalTokens: 10 });
  });
  it("startup: a valid default effort is forwarded as --reasoning-effort before stdio", async () => {
    const logs: string[] = [];
    const effortClient = new AcpClient({
      cliPath: fixtureCli(),
      cwd: workspace,
      env: {
        ...process.env,
        FAKE_WORKSPACE_ROOT: workspace,
        FAKE_PLAN_PATH: path.join(planHome, ".grok", "sessions", "cwd-x", "sess-effort", "plan.md"),
      },
      effort: "high",
      log: (msg) => logs.push(msg),
    });
    try {
      await effortClient.start();
      await effortClient.newSession();
      expect(effortClient.sessionId).toBe("fake-session-1");
      expect(logs.join("\n")).toContain("--reasoning-effort high");
      expect(logs.join("\n")).toContain("agent --reasoning-effort high stdio");
    } finally {
      effortClient.dispose();
    }
  });
  it("plan-snoop: grok's plan.md write is allowed AND emits planFileContent with the text", async () => {
    client.planActive = true;
    const planFireP = waitFor<string>(client, "planFileContent");
    const exitFireP = waitFor<any>(client, "exitPlanRequest");
    const promptP = client.prompt("SCENARIO_PROPOSE_PLAN");
    const planText = await planFireP;
    expect(planText).toContain("TEST PLAN");
    const exitReq = await exitFireP;
    expect(exitReq.sessionId).toBe("fake-session-1");
    client.respondExitPlan(exitReq.id, "rejected");
    await promptP;
    const planPathFromEnv = (client as any).opts.env.FAKE_PLAN_PATH;
    expect(fs.existsSync(planPathFromEnv)).toBe(true);
    expect(fs.readFileSync(planPathFromEnv, "utf8")).toContain("TEST PLAN");
  });
  it("gate: planActive=true blocks fs/write_text_file inside the workspace", async () => {
    client.planActive = true;
    const blocked = collect<{ kind: string; target: string }>(client, "mutationBlocked");
    await client.prompt("SCENARIO_WORKSPACE_WRITE");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].kind).toBe("write");
    expect(blocked[0].target.replace(/\\/g, "/")).toBe(workspace.replace(/\\/g, "/") + "/file.ts");
    await waitForStderr(stderr, /WRITE_RESPONSE.*"error"/);
    expect(stderr.join("")).toMatch(/WRITE_RESPONSE.*"error"/);
    expect(fs.existsSync(path.join(workspace, "file.ts"))).toBe(false);
  });
  it("gate: planActive=true blocks relative fs/write_text_file paths inside the workspace", async () => {
    client.planActive = true;
    const blocked = collect<{ kind: string; target: string }>(client, "mutationBlocked");
    await client.prompt("SCENARIO_RELATIVE_WORKSPACE_WRITE");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].kind).toBe("write");
    expect(blocked[0].target).toBe("relative-file.ts");
    await waitForStderr(stderr, /WRITE_RESPONSE.*"error"/);
    expect(stderr.join("")).toMatch(/WRITE_RESPONSE.*"error"/);
    expect(fs.existsSync(path.join(workspace, "relative-file.ts"))).toBe(false);
  });
  it("gate: planActive=false allows fs/write_text_file inside the workspace", async () => {
    client.planActive = false;
    const blocked = collect<unknown>(client, "mutationBlocked");
    await client.prompt("SCENARIO_WORKSPACE_WRITE");
    expect(blocked).toHaveLength(0);
    expect(fs.readFileSync(path.join(workspace, "file.ts"), "utf8")).toBe("// new file");
  });
  it("gate: planActive=true blocks terminal/create with a mutating command", async () => {
    client.planActive = true;
    const blocked = collect<{ kind: string; target: string }>(client, "mutationBlocked");
    await client.prompt("SCENARIO_MUTATING_TERMINAL");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].kind).toBe("terminal");
    expect(blocked[0].target).toContain("rm");
    expect((client as any).__terminalCalls()).toBe(0);
  });
  it("gate: planActive=true blocks terminal/create with mutating args on an otherwise read-only head", async () => {
    client.planActive = true;
    const blocked = collect<{ kind: string; target: string }>(client, "mutationBlocked");
    await client.prompt("SCENARIO_MUTATING_READONLY_HEAD_TERMINAL");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].kind).toBe("terminal");
    expect(blocked[0].target).toContain("sed");
    expect((client as any).__terminalCalls()).toBe(0);
  });
  it("gate: planActive=true allows terminal/create with a read-only command (ls)", async () => {
    client.planActive = true;
    const blocked = collect<unknown>(client, "mutationBlocked");
    await client.prompt("SCENARIO_READONLY_TERMINAL");
    expect(blocked).toHaveLength(0);
    expect((client as any).__terminalCalls()).toBe(1);
  });
  it("ask_user_question: host emits questionRequest and respondQuestion replies with outcome:accepted", async () => {
    const reqP = waitFor<any>(client, "questionRequest");
    const promptP = client.prompt("SCENARIO_ASK_QUESTION");
    const req = await reqP;
    expect(req.sessionId).toBe("fake-session-1");
    expect(req.questions[0].question).toBe("Pick one?");
    expect(req.questions[0].options[0].label).toBe("Option A");
    client.respondQuestion(req.id, { "Pick one?": "Option A" });
    await promptP;
    await waitForStderr(stderr, /ASK_RESPONSE.*"outcome":"accepted"/);
    expect(stderr.join("")).toMatch(/"answers":\{"Pick one\?":"Option A"\}/);
  });
  it("user_message_chunk: a live echo surfaces as a userMessageChunk event on the client", async () => {
    const echoes = collect<string>(client, "userMessageChunk");
    await client.prompt("investigate the parser");
    expect(echoes).toContain("investigate the parser");
  });
  it("respond*/cancel swallow stdin write failures instead of crashing", async () => {
    (client as any).proc.stdin = {
      writable: true,
      write() {
        throw new Error("write EPIPE / ERR_STREAM_DESTROYED");
      },
      destroy() {},
    };
    expect(() => client.respondPermission(1, "opt-1")).not.toThrow();
    expect(() => client.respondExitPlan(2, "rejected")).not.toThrow();
    await expect(client.cancel()).resolves.toBeUndefined();
  });
  it("a write to a non-writable stdin is skipped, not attempted", () => {
    let called = false;
    (client as any).proc.stdin = {
      writable: false,
      write() {
        called = true;
        throw new Error("should never be called");
      },
      destroy() {},
    };
    expect(() => client.respondPermission(1, "opt-1")).not.toThrow();
    expect(called).toBe(false);
  });
});
