// Diagnostic: dump every tool_call / tool_call_update for an /imagine-video
// prompt on native Windows grok, to see the completed-result wire shape.
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const GROK = path.join(process.env.USERPROFILE || os.homedir(), ".grok", "bin", "grok.exe");
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-winvideo-"));
const p = spawn(GROK, ["agent", "stdio"], { cwd, env: process.env });
let buf = "", nextId = 1, initId, newId, promptId, sessionId;
function send(method, params) { const id = nextId++; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); return id; }
function respond(id, result) { p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function handle(m) {
  if (m.id != null && m.method == null) {
    if (m.id === initId) newId = send("session/new", { cwd, mcpServers: [] });
    else if (m.id === newId) { sessionId = m.result.sessionId; console.log("session", sessionId); promptId = send("session/prompt", { sessionId, prompt: [{ type: "text", text: "/imagine-video a red cube slowly rotating on a white background" }] }); console.log("sent /imagine-video"); }
    else if (m.id === promptId) { console.log("DONE", m.result && m.result.stopReason); setTimeout(() => { p.kill(); process.exit(0); }, 1000); }
    return;
  }
  if (m.method === "session/update") {
    const u = m.params && m.params.update; if (!u) return;
    const t = u.sessionUpdate;
    if (t === "tool_call" || t === "tool_call_update") {
      console.log("\n=== " + t + " ===");
      console.log("  toolCallId:", u.toolCallId);
      console.log("  title:", JSON.stringify(u.title));
      console.log("  kind:", u.kind, "status:", u.status);
      if (u.rawInput) console.log("  rawInput:", JSON.stringify(u.rawInput).slice(0, 300));
      if (u.content) console.log("  content:", JSON.stringify(u.content).slice(0, 1000));
    }
    return;
  }
  if (m.method && m.id != null) {
    if (m.method === "fs/read_text_file") { let c = ""; try { c = fs.readFileSync(m.params.path, "utf8"); } catch {} return respond(m.id, { content: c }); }
    if (m.method === "fs/write_text_file") { return respond(m.id, {}); }
    if (/terminal\/create/.test(m.method)) return respond(m.id, { terminalId: "t1" });
    if (/terminal\/output/.test(m.method)) return respond(m.id, { output: "", exitStatus: { exitCode: 0 }, truncated: false });
    if (/terminal\/wait_for_exit/.test(m.method)) return respond(m.id, { exitCode: 0 });
    if (m.method === "session/request_permission") { const o = (m.params.options || []).find((x) => /allow/.test(x.kind)) || m.params.options[0]; return respond(m.id, { outcome: { outcome: "selected", optionId: o && o.optionId } }); }
    return respond(m.id, {});
  }
}
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch { continue; } handle(m); } });
p.stderr.on("data", (d) => { const s = d.toString(); if (/error|panic/i.test(s)) console.log("STDERR", s.slice(0, 200)); });
initId = send("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true } });
setTimeout(() => { console.log("TIMEOUT"); p.kill(); process.exit(0); }, 300000);
