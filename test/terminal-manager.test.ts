import { describe, it, expect } from "vitest";
import * as os from "node:os";
import { TerminalManager, resolveExitCode, buildKillPlan } from "../src/terminal/manager";

const nodeEval = (script: string) => `node -e "${script.replace(/"/g, '\\"')}"`;

describe("TerminalManager", () => {
  it("captures stdout from a quick command", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({ command: nodeEval("process.stdout.write('HELLO_TM')") });
    const { exitCode } = await m.waitForExit(terminalId);
    expect(exitCode).toBe(0);
    const r = m.output(terminalId);
    expect(r.output).toContain("HELLO_TM");
    expect(r.exitStatus).toEqual({ exitCode: 0 });
    expect(r.truncated).toBe(false);
    m.release(terminalId);
  });
  it("captures stderr and nonzero exit", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("process.stderr.write('ERR'); process.exit(7)"),
    });
    const r = await m.waitForExit(terminalId);
    expect(r.exitCode).toBe(7);
    const out = m.output(terminalId);
    expect(out.output).toContain("ERR");
    m.release(terminalId);
  });
  it("respects outputByteLimit and sets truncated flag", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("process.stdout.write('a'.repeat(5000))"),
      outputByteLimit: 100,
    });
    await m.waitForExit(terminalId);
    const r = m.output(terminalId);
    expect(r.output.length).toBeLessThanOrEqual(100);
    expect(r.truncated).toBe(true);
    m.release(terminalId);
  });
  it("does not emit U+FFFD when truncation splits a multi-byte character", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("process.stdout.write('\\u2713'.repeat(60))"),
      outputByteLimit: 100,
    });
    await m.waitForExit(terminalId);
    const r = m.output(terminalId);
    expect(r.truncated).toBe(true);
    expect(r.output).not.toContain("�");
    expect(/^✓+$/.test(r.output)).toBe(true);
    m.release(terminalId);
  });
  it("returns exitStatus null while still running", () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("setTimeout(()=>{}, 5000)"),
    });
    const r = m.output(terminalId);
    expect(r.exitStatus).toBeNull();
    m.kill(terminalId);
    m.release(terminalId);
  });
  it("injects env from {name,value} pairs", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("process.stdout.write(process.env.GROK_TEST_VAR || '')"),
      env: [{ name: "GROK_TEST_VAR", value: "INJECTED" }],
    });
    await m.waitForExit(terminalId);
    expect(m.output(terminalId).output).toContain("INJECTED");
    m.release(terminalId);
  });
  it("honors cwd", async () => {
    const m = new TerminalManager();
    const tmp = os.tmpdir();
    const { terminalId } = m.create({
      command: nodeEval("process.stdout.write(process.cwd())"),
      cwd: tmp,
    });
    await m.waitForExit(terminalId);
    const got = m.output(terminalId).output.trim().toLowerCase();
    expect(got).toContain(tmp.replace(/\\/g, "/").toLowerCase().split("/").pop()!);
  });
  it("waitForExit resolves immediately if already exited", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({ command: nodeEval("process.exit(0)") });
    await m.waitForExit(terminalId);
    const r = await m.waitForExit(terminalId);
    expect(r.exitCode).toBe(0);
    m.release(terminalId);
  });
  it("output() throws on unknown terminalId", () => {
    const m = new TerminalManager();
    expect(() => m.output("nope")).toThrowError(/unknown terminalId/);
  });
  it("kill+release on a missing id is a no-op", () => {
    const m = new TerminalManager();
    expect(() => m.kill("nope")).not.toThrow();
    expect(() => m.release("nope")).not.toThrow();
  });
  it("disposeAll kills outstanding terminals", () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({
      command: nodeEval("setTimeout(()=>{}, 60000)"),
    });
    m.disposeAll();
    expect(() => m.output(terminalId)).toThrow();
  });
  it("reports a non-zero exit code when a running process is killed", async () => {
    const m = new TerminalManager();
    const { terminalId } = m.create({ command: nodeEval("setInterval(()=>{}, 1000)") });
    await new Promise((r) => setTimeout(r, 150));
    m.kill(terminalId);
    const { exitCode } = await m.waitForExit(terminalId);
    expect(exitCode).not.toBe(0);
    m.release(terminalId);
  });
});

describe("resolveExitCode", () => {
  it("passes through a real exit code, including 0", () => {
    expect(resolveExitCode(0, null)).toBe(0);
    expect(resolveExitCode(7, null)).toBe(7);
  });
  it("maps a signal kill to 128 + signum (SIGTERM -> 143), never 0", () => {
    expect(resolveExitCode(null, "SIGTERM")).toBe(128 + os.constants.signals.SIGTERM);
    expect(resolveExitCode(null, "SIGTERM")).toBe(143);
    expect(resolveExitCode(null, "SIGKILL")).toBe(128 + os.constants.signals.SIGKILL);
    expect(resolveExitCode(null, "SIGTERM")).not.toBe(0);
  });
});

describe("buildKillPlan", () => {
  it("uses taskkill with /T /F (tree + force) on Windows", () => {
    const plan = buildKillPlan(1234, "win32");
    expect(plan.kind).toBe("taskkill");
    if (plan.kind === "taskkill") {
      expect(plan.file).toBe("taskkill");
      expect(plan.args).toContain("/T");
      expect(plan.args).toContain("/F");
      expect(plan.args).toContain("1234");
    }
  });
  it("uses a SIGTERM signal on POSIX", () => {
    const plan = buildKillPlan(1234, "linux");
    expect(plan).toEqual({ kind: "signal", signal: "SIGTERM" });
  });
});
