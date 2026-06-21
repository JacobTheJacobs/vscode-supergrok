// Plan-mode GATED probe. Unlike plan-reject-probe (which ACKs everything to
// observe grok's raw behavior), this one wires in the EXACT shipped policy
// (out/plan/gate.js) and responds with the same JSON-RPC error the extension
// sends when the gate blocks. It answers the real UX question surfaced by the
// reject probe:
//
//   With the gate LIVE, does plan mode still work on native-Windows grok,
//   and how many "blocked" notices would the user actually see?
//
// Non-destructive: allowed writes are still ACKed WITHOUT writing to disk.
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const gate = require("../../../../out/plan/gate.js");

const GROK = path.join(os.homedir(), ".grok", "bin", "grok.exe");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-gated-exp-"));
fs.writeFileSync(path.join(cwd, "app.js"), "function add(a,b){return a+b}\nmodule.exports={add}\n");
log("cwd: " + cwd);
const CTX = { active: true, workspaceRoot: cwd };

const proc = spawn(GROK, ["agent", "stdio"], { cwd, env: process.env });
let nextId = 1;
const waiters = new Map();
function log(s) { process.stderr.write("[gate] " + s + "\n"); }
function send(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res) => waiters.set(id, res));
}
function respond(id, result) { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function respondErr(id, code, message) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}
proc.stderr.on("data", () => {}); // quiet grok's own logs

let phase = "plan-1";
let exitCount = 0;
const tally = {
  blockedTerminals: [],   // {phase, command}
  allowedTerminals: [],   // {phase, command}
  blockedWrites: [],       // {phase, path}
  allowedPlanWrites: 0,
  exitPlanModes: [],
  reachedPlan: false,      // did a 'plan' update arrive?
};

const rl = readline.createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }

  if (msg.method && msg.id != null) {
    const m = msg.method;
    if (m === "fs/read_text_file") {
      let content = ""; try { content = fs.readFileSync(msg.params.path, "utf8"); } catch {}
      respond(msg.id, { content });
    } else if (m === "fs/write_text_file") {
      const p = msg.params.path;
      if (gate.shouldBlockWrite(p, CTX)) {
        tally.blockedWrites.push({ phase, path: p });
        log("[" + phase + "] BLOCK write  " + p);
        respondErr(msg.id, gate.PLAN_BLOCKED_CODE, gate.PLAN_BLOCKED_WRITE_MSG);
      } else {
        if (gate.isPlanFileWrite(p)) tally.allowedPlanWrites++;
        respond(msg.id, {}); // allowed (outside ws) — ack without writing
      }
    } else if (m === "terminal/create") {
      const cmd = String((msg.params && (msg.params.command || JSON.stringify(msg.params.args))) || "");
      if (gate.shouldBlockTerminal(cmd, CTX)) {
        tally.blockedTerminals.push({ phase, command: cmd.slice(0, 110) });
        log("[" + phase + "] BLOCK term   " + cmd.slice(0, 110));
        respondErr(msg.id, gate.PLAN_BLOCKED_CODE, gate.PLAN_BLOCKED_TERMINAL_MSG);
      } else {
        tally.allowedTerminals.push({ phase, command: cmd.slice(0, 110) });
        log("[" + phase + "] allow term   " + cmd.slice(0, 110));
        respond(msg.id, { terminalId: "t" + nextId });
      }
    } else if (m === "terminal/output") respond(msg.id, { output: "", exitStatus: { exitCode: 0 }, truncated: false });
    else if (m === "terminal/wait_for_exit") respond(msg.id, { exitCode: 0 });
    else if (m.startsWith("terminal/")) respond(msg.id, {});
    else if (m.includes("exit_plan_mode")) {
      exitCount++;
      tally.exitPlanModes.push({ phase });
      log("[" + phase + "] EXIT_PLAN_MODE #" + exitCount);
      respond(msg.id, { outcome: "approved" });
    } else if (m === "session/request_permission") {
      const opts = (msg.params && msg.params.options) || [];
      const rej = opts.find((o) => o.kind === "reject_once") || opts[0];
      respond(msg.id, { outcome: { outcome: "selected", optionId: rej && rej.optionId } });
    } else respond(msg.id, {});
    return;
  }

  if (msg.method === "session/update") {
    const u = msg.params && msg.params.update;
    const t = u && u.sessionUpdate;
    if (t === "plan") { tally.reachedPlan = true; log("[" + phase + "] UPD plan"); }
    else if (t === "current_mode_update") log("[" + phase + "] UPD mode -> " + u.currentModeId);
    return;
  }
  if (msg.id != null) { const w = waiters.get(msg.id); if (w) { waiters.delete(msg.id); w(msg); } }
});

(async () => {
  try {
    const init = await send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    if (init.error) return finish();
    const ns = await send("session/new", { cwd, mcpServers: [] });
    if (ns.error) { log("session/new ERR"); return finish(); }
    const sessionId = ns.result.sessionId;
    await send("session/set_mode", { sessionId, modeId: "plan" });

    log("=== TURN 1: plan prompt (gate LIVE) ===");
    const p1 = await send("session/prompt", { sessionId, prompt: [{ type: "text",
      text: "Plan how to add a subtract(a,b) function to app.js plus a test file. Make a detailed plan." }] });
    log("turn1 stop: " + (p1.error ? "ERR" : JSON.stringify(p1.result && p1.result.stopReason)));

    phase = "revise";
    await send("session/set_mode", { sessionId, modeId: "plan" });
    log("=== TURN 2: feedback prompt (gate LIVE) ===");
    const p2 = await send("session/prompt", { sessionId, prompt: [{ type: "text",
      text: "Don't implement yet — stay in plan mode and revise the plan based on this feedback:\n\n" +
            "Also handle divide(a,b) with a guard against division by zero, and put the tests in a separate __tests__ folder." }] });
    log("turn2 stop: " + (p2.error ? "ERR" : JSON.stringify(p2.result && p2.result.stopReason)));
    summarize();
  } catch (e) { log("EXC " + (e && e.message)); }
  finally { finish(); }
})();

function summarize() {
  const bt = tally.blockedTerminals.length, at = tally.allowedTerminals.length;
  log("");
  log("================= GATED SUMMARY =================");
  log("reached a plan update: " + tally.reachedPlan);
  log("exit_plan_mode count: " + exitCount + "  (>=2 = reject->revise loop survived the gate)");
  log("terminals: " + at + " allowed, " + bt + " BLOCKED  (blocked = user-visible notices)");
  log("workspace writes blocked: " + tally.blockedWrites.length + "  (real mutations stopped)");
  log("plan.md writes allowed: " + tally.allowedPlanWrites + "  (plan still persisted)");
  log("--- blocked terminal commands (each = one notice) ---");
  for (const t of tally.blockedTerminals) log("  [" + t.phase + "] " + t.command);
  log("--- allowed terminal commands ---");
  for (const t of tally.allowedTerminals) log("  [" + t.phase + "] " + t.command);
  log("================================================");
}
function finish() { setTimeout(() => { try { proc.kill(); } catch {} process.exit(0); }, 600); }
setTimeout(() => { log("TIMEOUT"); summarize(); try { proc.kill(); } catch {} process.exit(0); }, 540000);
