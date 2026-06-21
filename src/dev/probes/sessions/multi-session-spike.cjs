/**
 * Multi-session spike — does the extension's single-process model generalize to a
 * pool? Spawns N independent `grok agent stdio` processes, runs a turn on each in
 * PARALLEL, and tracks per-session status + timing. Answers the riskiest unknown
 * behind an "Agent Dashboard": do multiple grok processes coexist and make
 * progress at once, or do they fight (global lock / rate-limit / clobbering)?
 *
 * This is a throwaway dev probe, like the other scripts under src/dev/probes. It talks to
 * grok directly — it does NOT import or modify any shipped extension code. Needs a
 * logged-in grok + subscription; burns a little credit. Run:  node src/dev/probes/sessions/multi-session-spike.cjs
 *
 * Env: GROK_BIN=/path/to/grok   N=3 (sessions)   PROMPT_TIMEOUT_MS=60000
 */
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

function resolveGrok() {
  if (process.env.GROK_BIN && fs.existsSync(process.env.GROK_BIN)) return process.env.GROK_BIN;
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const win = process.platform === "win32";
  const candidates = win
    ? [path.join(home, ".grok", "bin", "grok.exe"), path.join(home, ".grok", "bin", "grok.cmd")]
    : [path.join(home, ".grok", "bin", "grok")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return win ? "grok.exe" : "grok";
}
const GROK = resolveGrok();
const N = Number(process.env.N) || 3;
const PROMPT_TIMEOUT_MS = Number(process.env.PROMPT_TIMEOUT_MS) || 60000;
const INIT = { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true } };
const now = () => Number(process.hrtime.bigint() / 1000000n);

// One grok process + the per-session status a dashboard would show.
class Sess {
  constructor(label, cwd) {
    this.label = label;
    this.cwd = cwd;
    this.nextId = 1;
    this.waiters = new Map();
    this.buf = "";
    this.status = "spawning";   // spawning → ready → working → awaiting-input → done | error
    this.chunks = 0;            // agent_message_chunk count (proof of streaming progress)
    this.thoughts = 0;
    this.stderr = "";
    this.events = [];           // [{t, status}] transitions, for the timeline
    const win = process.platform === "win32";
    const useShell = /\.(cmd|bat)$/i.test(GROK) && win;
    this.proc = spawn(GROK, ["agent", "stdio"], { cwd, env: process.env, shell: useShell });
    this.proc.stdout.on("data", (d) => this._onData(d));
    this.proc.stderr.on("data", (d) => {
      const s = d.toString();
      this.stderr += s;
      if (/rate.?limit|too many|concurren|locked|429|quota|exceeded/i.test(s)) this._set("error");
    });
    this.proc.on("exit", (c) => { this.exitCode = c; if (this.status !== "done") this._set("error"); });
  }
  _set(status) {
    if (this.status === status) return;
    this.status = status;
    this.events.push({ t: now(), status });
  }
  _onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      this._handle(m);
    }
  }
  _handle(m) {
    if (m.id != null && m.method == null) { const w = this.waiters.get(m.id); if (w) { this.waiters.delete(m.id); w(m); } return; }
    if (m.method === "session/update") {
      const u = m.params && m.params.update; if (!u) return;
      if (u.sessionUpdate === "agent_message_chunk") this.chunks++;
      if (u.sessionUpdate === "agent_thought_chunk") this.thoughts++;
      return;
    }
    if (m.method && m.id != null) this._serverRequest(m); // mandatory: answer or grok hangs
  }
  _serverRequest(m) {
    const meth = m.method;
    if (meth === "fs/read_text_file") { let content = ""; try { content = fs.readFileSync(m.params.path, "utf8"); } catch {} return this._respond(m.id, { content }); }
    if (meth === "fs/write_text_file") return this._respond(m.id, {});
    if (meth === "terminal/create") return this._respond(m.id, { terminalId: "t" + this.nextId });
    if (meth === "terminal/output") return this._respond(m.id, { output: "", exitStatus: { exitCode: 0 }, truncated: false });
    if (meth === "terminal/wait_for_exit") return this._respond(m.id, { exitCode: 0 });
    if (meth === "terminal/kill" || meth === "terminal/release") return this._respond(m.id, {});
    // A real "needs you" signal — exactly the dashboard's awaiting-input state.
    if (meth === "session/request_permission") { this._set("awaiting-input"); const opts = (m.params && m.params.options) || []; const allow = opts.find((o) => /allow/.test(o.kind)) || opts[0]; this._set("working"); return this._respond(m.id, { outcome: { outcome: "selected", optionId: allow && allow.optionId } }); }
    if (/ask_user_question/.test(meth)) { this._set("awaiting-input"); this._set("working"); return this._respond(m.id, { outcome: "cancelled" }); }
    return this._respond(m.id, {});
  }
  send(method, params) { const id = this.nextId++; this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); return new Promise((res) => this.waiters.set(id, res)); }
  _respond(id, result) { try { this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); } catch {} }
  kill() { try { this.proc.kill(); } catch {} }
}

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms))]);
}
const mkTmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), "grok-spike-" + tag + "-"));

async function run() {
  console.log(`\n multi-session spike — binary: ${GROK}\n spawning ${N} concurrent grok agent stdio processes\n`);
  const prompts = [
    "Write a 4-line poem about the ocean. Reply with only the poem.",
    "List 5 prime numbers under 50, comma-separated, nothing else.",
    "In one sentence, explain what a hash map is.",
    "Name three programming languages, comma-separated.",
    "Write a haiku about winter.",
  ];
  const sessions = Array.from({ length: N }, (_, i) => new Sess(`S${i + 1}`, mkTmp("s" + i)));

  // Phase 1: initialize + session/new on all, concurrently. Tests bare coexistence.
  const t0 = now();
  const inits = await Promise.allSettled(sessions.map(async (s) => {
    await withTimeout(s.send("initialize", INIT), 30000, "init");
    const ns = await withTimeout(s.send("session/new", { cwd: s.cwd, mcpServers: [] }), 30000, "new");
    if (!ns.result || !ns.result.sessionId) throw new Error("session/new failed: " + JSON.stringify(ns.error || ns));
    s.sessionId = ns.result.sessionId; s._set("ready");
    return ns.result.sessionId;
  }));
  inits.forEach((r, i) => console.log(`  ${sessions[i].label} init+new: ${r.status === "fulfilled" ? "OK " + r.value.slice(0, 12) + "…" : "FAIL " + r.reason.message}`));
  const ready = sessions.filter((s) => s.status === "ready");
  console.log(`\n ${ready.length}/${N} sessions came up. Now firing a prompt at each — at the SAME time.\n`);

  // Phase 2: fire a prompt at every ready session simultaneously. Tests parallel turns.
  const fireStart = now();
  ready.forEach((s, i) => s._set("working"));
  const turns = ready.map((s, i) => {
    const started = now();
    return withTimeout(
      s.send("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: prompts[i % prompts.length] }] }),
      PROMPT_TIMEOUT_MS, s.label + " prompt",
    ).then((r) => { s.doneAt = now() - started; s._set("done"); s.stop = r.result && r.result.stopReason; return r; })
      .catch((e) => { s.err = e.message; s._set("error"); });
  });

  // Status snapshots while they run — what the dashboard would render live.
  const snaps = [];
  const ticker = setInterval(() => {
    snaps.push({ t: now() - fireStart, row: ready.map((s) => `${s.label}:${s.status}(${s.chunks}c)`).join("  ") });
  }, 1500);

  await Promise.allSettled(turns);
  clearInterval(ticker);
  const wall = now() - fireStart;

  console.log(" live status snapshots (what an Agent Dashboard would show):");
  for (const s of snaps) console.log(`   +${String(s.t).padStart(5)}ms  ${s.row}`);

  console.log("\n per-session result:");
  let okCount = 0, sumSolo = 0;
  for (const s of ready) {
    const ok = s.status === "done";
    if (ok) { okCount++; sumSolo += s.doneAt || 0; }
    console.log(`   ${s.label}: ${ok ? "DONE" : "ERR "} in ${String(s.doneAt || 0).padStart(6)}ms · ${s.chunks} msg-chunks · ${s.thoughts} thoughts · stop=${s.stop || "-"}${s.err ? " · " + s.err : ""}${s.stderr ? " · stderr:" + s.stderr.slice(0, 80).replace(/\n/g, " ") : ""}`);
  }

  // Parallelism factor: if turns ran in parallel, wall-clock ≈ slowest single turn,
  // and is much less than the SUM of the individual turn times.
  const slowest = Math.max(0, ...ready.map((s) => s.doneAt || 0));
  console.log(`\n ── verdict ──`);
  console.log(`   ${okCount}/${ready.length} parallel turns completed`);
  console.log(`   wall-clock for all turns: ${wall}ms · slowest single turn: ${slowest}ms · sum of turns: ${sumSolo}ms`);
  if (okCount === ready.length && okCount > 1) {
    const factor = sumSolo > 0 ? (sumSolo / wall).toFixed(2) : "?";
    console.log(`   parallelism factor (sum/wall): ${factor}×  — >1 means turns genuinely overlapped (not serialized)`);
    console.log(`   ✅ multiple grok processes COEXIST and make progress in parallel — a pool/dashboard is viable.`);
  } else if (okCount === 0) {
    console.log(`   ❌ no parallel turn completed — see errors/stderr above (possible lock / rate-limit / auth contention).`);
  } else {
    console.log(`   ⚠️  partial: ${okCount}/${ready.length} completed — some contention. Inspect errors above.`);
  }
  console.log("");
  sessions.forEach((s) => s.kill());
}

run().then(() => setTimeout(() => process.exit(0), 200)).catch((e) => { console.error("spike crashed:", e); process.exit(2); });
