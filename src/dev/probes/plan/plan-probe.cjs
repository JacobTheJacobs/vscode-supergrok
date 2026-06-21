// Plan-mode probe: drive `grok agent stdio`, observe what plan mode does.
// We ACK every fs/write WITHOUT writing to disk, so nothing mutates — we only
// observe whether grok routes its plan / edits through fs/write_text_file,
// terminal/create, or session/request_permission, and what paths it targets.
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const GROK = path.join(os.homedir(), ".grok", "bin", "grok.exe");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-plan-exp-"));
// seed one file so reads have something to find
fs.writeFileSync(path.join(cwd, "app.js"), "function add(a,b){return a+b}\nmodule.exports={add}\n");
log("cwd: " + cwd);

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
function respondErr(id, message) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
}

proc.stderr.on("data", (d) => process.stderr.write("[grok-stderr] " + d.toString()));

const rl = readline.createInterface({ input: proc.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { log("non-json: " + line.slice(0, 160)); return; }

  if (msg.method && msg.id != null) {           // server -> client request
    const m = msg.method;
    if (m === "fs/read_text_file") {
      let content = ""; try { content = fs.readFileSync(msg.params.path, "utf8"); } catch {}
      log("REQ fs/read  " + msg.params.path);
      respond(msg.id, { content });
    } else if (m === "fs/write_text_file") {
      log("REQ fs/WRITE " + msg.params.path + "  (len " + (msg.params.content || "").length + ")");
      log("     preview: " + JSON.stringify((msg.params.content || "").slice(0, 160)));
      respond(msg.id, {});                        // ack but DO NOT write
    } else if (m.startsWith("terminal/")) {
      log("REQ " + m + "  " + JSON.stringify(msg.params).slice(0, 160));
      if (m === "terminal/create") respond(msg.id, { terminalId: "t1" });
      else if (m === "terminal/output") respond(msg.id, { output: "", exitStatus: { exitCode: 0 }, truncated: false });
      else if (m === "terminal/wait_for_exit") respond(msg.id, { exitCode: 0 });
      else respond(msg.id, {});
    } else if (m.includes("exit_plan_mode")) {
      log("REQ EXIT_PLAN_MODE  params=" + JSON.stringify(msg.params).slice(0, 400));
      respond(msg.id, { outcome: "approved" });
    } else if (m === "session/request_permission") {
      log("REQ PERMISSION  toolCall=" + JSON.stringify(msg.params.toolCall).slice(0, 240));
      const opts = msg.params.options || [];
      const rej = opts.find((o) => o.kind === "reject_once") || opts[0];
      respond(msg.id, { outcome: { outcome: "selected", optionId: rej && rej.optionId } });
    } else {
      log("REQ (other) " + m + "  " + JSON.stringify(msg.params).slice(0, 160));
      respond(msg.id, {});
    }
    return;
  }

  if (msg.method === "session/update") {
    const u = msg.params && msg.params.update;
    const t = u && u.sessionUpdate;
    if (t === "plan") log("UPD plan  " + JSON.stringify(u).slice(0, 500));
    else if (t === "current_mode_update") log("UPD mode -> " + u.currentModeId);
    else if (t === "tool_call") log("UPD tool_call  kind=" + u.kind + " title=" + JSON.stringify(u.title || "").slice(0, 80));
    else if (t === "agent_message_chunk") { /* quiet */ }
    else log("UPD " + t);
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
    if (init.error) { log("initialize ERROR: " + JSON.stringify(init.error)); return finish(); }
    log("initialized: " + JSON.stringify(init.result && init.result.serverInfo || init.result).slice(0, 160));

    const ns = await send("session/new", { cwd, mcpServers: [] });
    if (ns.error) { log("session/new ERROR: " + JSON.stringify(ns.error)); return finish(); }
    const sessionId = ns.result.sessionId;
    log("session: " + sessionId);

    const sm = await send("session/set_mode", { sessionId, modeId: "plan" });
    log("set_mode plan -> " + (sm.error ? "ERR " + JSON.stringify(sm.error) : "ok"));

    log("--- sending plan prompt ---");
    const pr = await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Plan how to add a subtract(a,b) function to app.js and write a test file. Make a detailed plan." }],
    });
    log("prompt complete: " + (pr.error ? "ERR " + JSON.stringify(pr.error) : JSON.stringify(pr.result).slice(0, 200)));
  } catch (e) {
    log("EXC " + (e && e.message));
  } finally {
    finish();
  }
})();

function finish() {
  setTimeout(() => { try { proc.kill(); } catch {} process.exit(0); }, 500);
}
setTimeout(() => { log("TIMEOUT — killing"); try { proc.kill(); } catch {} process.exit(0); }, 170000);
