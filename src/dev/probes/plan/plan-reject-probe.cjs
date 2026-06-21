// Plan-mode REJECT-WITH-FEEDBACK probe. Mirrors the extension's new reject flow
// (src/extension/sidebar-provider.ts handleExitPlan): plan turn -> respond to exit_plan_mode (the
// CLI's unavoidable "approved") -> after the turn ends, re-assert setMode("plan")
// and send a "don't implement, revise" feedback prompt -> observe.
//
// Questions it answers against live grok 0.2.3:
//   Q1  Does a SECOND exit_plan_mode arrive after a feedback-driven revision?
//       (is the plan loop iterable, or one-shot?)
//   Q2  During the revise turn, does grok attempt a WORKSPACE write/command
//       (gate would fire) or only its own plan.md (gate stays quiet)?
//   Q3  Does re-asserting setMode("plan") mid-conversation succeed?
//
// Non-destructive: every fs/write is ACKed WITHOUT writing; runs in a temp dir.
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const GROK = path.join(os.homedir(), ".grok", "bin", "grok.exe");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-reject-exp-"));
fs.writeFileSync(path.join(cwd, "app.js"), "function add(a,b){return a+b}\nmodule.exports={add}\n");
log("cwd: " + cwd);

// --- classify a write target as inside the workspace (a real mutation the gate
// would block) vs outside (grok's own plan.md bookkeeping). Mirror of plan-gate. ---
function canon(p) {
  if (!p) return "";
  let s = String(p).replace(/^\\\\\?\\/, "");
  s = path.resolve(s);
  return process.platform === "win32" ? s.toLowerCase() : s;
}
const ROOT = canon(cwd);
function insideWorkspace(p) {
  const c = canon(p);
  return c === ROOT || c.startsWith(ROOT + path.sep) || c.startsWith(ROOT + "/");
}

const proc = spawn(GROK, ["agent", "stdio"], { cwd, env: process.env });
let nextId = 1;
const waiters = new Map();
function log(s) { process.stderr.write("[exp] " + s + "\n"); }
function send(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res) => waiters.set(id, res));
}
function respond(id, result) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

proc.stderr.on("data", (d) => process.stderr.write("[grok-stderr] " + d.toString()));

// --- observation tally ---
let phase = "plan-1";
let exitCount = 0;
const tally = {
  workspaceWriteAttempts: [], // {phase, path}  <- gate WOULD block these
  planMdWrites: 0,            // outside workspace, gate allows
  terminalCreates: [],        // {phase, command}
  exitPlanModes: [],          // {phase, planContentNull}
  modeUpdates: [],            // {phase, mode}
};

const rl = readline.createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { log("non-json: " + line.slice(0, 160)); return; }

  if (msg.method && msg.id != null) {           // server -> client request
    const m = msg.method;
    if (m === "fs/read_text_file") {
      let content = ""; try { content = fs.readFileSync(msg.params.path, "utf8"); } catch {}
      respond(msg.id, { content });
    } else if (m === "fs/write_text_file") {
      const p = msg.params.path;
      const ws = insideWorkspace(p);
      if (ws) {
        tally.workspaceWriteAttempts.push({ phase, path: p });
        log("[" + phase + "] fs/WRITE *WORKSPACE* " + p + "  (gate WOULD block)");
      } else {
        if (/plan\.md$/i.test(p)) tally.planMdWrites++;
        log("[" + phase + "] fs/write (outside ws) " + p);
      }
      respond(msg.id, {});                        // ack but DO NOT write
    } else if (m.startsWith("terminal/")) {
      if (m === "terminal/create") {
        const cmd = msg.params && (msg.params.command || JSON.stringify(msg.params.args || ""));
        tally.terminalCreates.push({ phase, command: String(cmd).slice(0, 120) });
        log("[" + phase + "] terminal/create  " + String(cmd).slice(0, 120));
        respond(msg.id, { terminalId: "t" + nextId });
      } else if (m === "terminal/output") respond(msg.id, { output: "", exitStatus: { exitCode: 0 }, truncated: false });
      else if (m === "terminal/wait_for_exit") respond(msg.id, { exitCode: 0 });
      else respond(msg.id, {});
    } else if (m.includes("exit_plan_mode")) {
      exitCount++;
      const planNull = !(msg.params && msg.params.planContent);
      tally.exitPlanModes.push({ phase, planContentNull: planNull });
      log("[" + phase + "] EXIT_PLAN_MODE #" + exitCount + "  planContent=" + (planNull ? "null" : "present"));
      respond(msg.id, { outcome: "approved" });   // the CLI treats ANY response as approval
    } else if (m === "session/request_permission") {
      const opts = (msg.params && msg.params.options) || [];
      const rej = opts.find((o) => o.kind === "reject_once") || opts[0];
      log("[" + phase + "] PERMISSION " + JSON.stringify(msg.params.toolCall && msg.params.toolCall.kind));
      respond(msg.id, { outcome: { outcome: "selected", optionId: rej && rej.optionId } });
    } else {
      respond(msg.id, {});
    }
    return;
  }

  if (msg.method === "session/update") {
    const u = msg.params && msg.params.update;
    const t = u && u.sessionUpdate;
    if (t === "current_mode_update") {
      tally.modeUpdates.push({ phase, mode: u.currentModeId });
      log("[" + phase + "] UPD mode -> " + u.currentModeId);
    } else if (t === "plan") {
      log("[" + phase + "] UPD plan (len " + JSON.stringify(u).length + ")");
    } else if (t === "tool_call") {
      log("[" + phase + "] UPD tool_call kind=" + u.kind + " " + JSON.stringify(u.title || "").slice(0, 70));
    }
    return;
  }
  if (msg.id != null) {
    const w = waiters.get(msg.id);
    if (w) { waiters.delete(msg.id); w(msg); }
  }
});

(async () => {
  try {
    const init = await send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    if (init.error) { log("initialize ERROR"); return finish(); }

    const ns = await send("session/new", { cwd, mcpServers: [] });
    if (ns.error) { log("session/new ERROR: " + JSON.stringify(ns.error)); return finish(); }
    const sessionId = ns.result.sessionId;
    log("session: " + sessionId);

    const sm = await send("session/set_mode", { sessionId, modeId: "plan" });
    log("set_mode plan -> " + (sm.error ? "ERR" : "ok"));

    log("=== TURN 1: initial plan prompt ===");
    const p1 = await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Plan how to add a subtract(a,b) function to app.js plus a test file. Make a detailed plan." }],
    });
    log("turn1 stopReason: " + (p1.error ? "ERR " + JSON.stringify(p1.error) : JSON.stringify(p1.result)));

    // --- mirror the extension's reject-with-feedback afterTurn ---
    phase = "revise";
    log("=== Q3: re-assert setMode(plan) mid-conversation ===");
    const sm2 = await send("session/set_mode", { sessionId, modeId: "plan" });
    log("re-assert set_mode plan -> " + (sm2.error ? "ERR " + JSON.stringify(sm2.error) : "ok"));

    log("=== TURN 2: feedback prompt (the exact wording the extension sends) ===");
    const p2 = await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text:
        "Don't implement yet — stay in plan mode and revise the plan based on this feedback:\n\n" +
        "Also handle divide(a,b) with a guard against division by zero, and put the tests in a separate __tests__ folder." }],
    });
    log("turn2 stopReason: " + (p2.error ? "ERR " + JSON.stringify(p2.error) : JSON.stringify(p2.result)));

    summarize();
  } catch (e) {
    log("EXC " + (e && e.message));
  } finally {
    finish();
  }
})();

function summarize() {
  log("");
  log("================= SUMMARY =================");
  log("exit_plan_mode count: " + exitCount + "  (Q1: >=2 means the loop is iterable)");
  for (const e of tally.exitPlanModes) log("   exit_plan_mode @ " + e.phase + "  planContentNull=" + e.planContentNull);
  log("mode updates: " + tally.modeUpdates.map((m) => m.phase + ":" + m.mode).join(", "));
  log("WORKSPACE write attempts (gate would block): " + tally.workspaceWriteAttempts.length +
      "  (Q2: 0 during 'revise' = happy path, gate stays quiet)");
  for (const w of tally.workspaceWriteAttempts) log("   ws-write @ " + w.phase + "  " + w.path);
  log("plan.md writes (outside ws, allowed): " + tally.planMdWrites);
  log("terminal/create: " + tally.terminalCreates.length);
  for (const t of tally.terminalCreates) log("   term @ " + t.phase + "  " + t.command);
  log("==========================================");
}

function finish() {
  setTimeout(() => { try { proc.kill(); } catch {} process.exit(0); }, 600);
}
setTimeout(() => { log("TIMEOUT — killing"); summarize(); try { proc.kill(); } catch {} process.exit(0); }, 540000);
