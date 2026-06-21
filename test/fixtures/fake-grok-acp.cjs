#!/usr/bin/env node
// Minimal fake `grok agent stdio` for integration tests. Speaks the subset of
// ACP that src/acp/client.ts actually exercises:
//   - initialize, session/new, session/load, session/set_model, session/set_mode,
//     session/prompt, session/cancel  (client → server)
//   - fs/write_text_file, terminal/create, x.ai/exit_plan_mode,
//     x.ai/ask_user_question  (server → client)
//   - session/update notifications (agent_message_chunk, and a user_message_chunk
//     echo of the live prompt — grok ≥0.2.33 does this on every prompt)
//
// Each test drives a scenario by sending a prompt whose text matches one of the
// SCENARIO_* tags below. The scenario script issues exactly the server→client
// requests we need to exercise the host's behavior (plan-snoop, gate blocking,
// exit_plan_mode round-trip), then ends the turn.
//
// Deliberately small (~150 lines) and grok-version-independent: it encodes only
// what the protocol REQUIRES, not grok's quirks. The buggy "any response is
// approval" behavior is handled host-side; this fake just ends its turn
// whichever way the host replies to exit_plan_mode.

const readline = require("readline");

// Accept the startup arg shapes the extension actually sends: `agent stdio`,
// optionally with `--reasoning-effort <value>` (agent-level flags, before the
// stdio subcommand). Mirror grok's validation: only the real effort values are
// allowed; anything else (incl. the bogus `max`) exits 2 like the CLI does.
const VALID_EFFORT = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const argv = process.argv.slice(2);
function argvOk(a) {
  if (a.length === 2) return a[0] === "agent" && a[1] === "stdio";
  if (a.length === 4) return a[0] === "agent" && a[1] === "--reasoning-effort" && VALID_EFFORT.has(a[2]) && a[3] === "stdio";
  return false;
}
if (!argvOk(argv)) {
  process.stderr.write(`unexpected argv: ${JSON.stringify(argv)}\n`);
  process.exit(2);
}

const rl = readline.createInterface({ input: process.stdin });

let nextId = 1000;
const pendingReplies = new Map(); // id we sent → resolver

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function respondOk(id, result) { send({ jsonrpc: "2.0", id, result }); }
function notify(method, params) { send({ jsonrpc: "2.0", method, params }); }
function callClient(method, params) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingReplies.delete(id);
      resolve({ error: { code: -32099, message: `Timed out waiting for ${method}` } });
    }, 2000);
    pendingReplies.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
  });
}

const SESSION_ID = "fake-session-1";
const PLAN_PATH = process.env.FAKE_PLAN_PATH || "/tmp/fake-grok-home/.grok/sessions/cwd-x/sess-y/plan.md";
const WORKSPACE_FILE = (process.env.FAKE_WORKSPACE_ROOT || "/tmp/fake-workspace") + "/file.ts";
const RELATIVE_WORKSPACE_FILE = "relative-file.ts";

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // Responses to our outbound requests — pass to the awaiting promise.
  if (msg.id != null && !msg.method && pendingReplies.has(msg.id)) {
    pendingReplies.get(msg.id)({ result: msg.result, error: msg.error });
    pendingReplies.delete(msg.id);
    return;
  }

  // Inbound requests from the host.
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return respondOk(id, { protocolVersion: 1, serverCapabilities: {} });
    case "session/new":
      return respondOk(id, {
        sessionId: SESSION_ID,
        models: { currentModelId: "fake-model", availableModels: [] },
        modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Agent" }, { id: "plan", name: "Plan" }] },
      });
    case "session/load":
      return respondOk(id, {
        models: { currentModelId: "fake-model", availableModels: [] },
        modes: { currentModeId: "default", availableModes: [] },
      });
    case "session/set_model":
      return respondOk(id, { _meta: { model: { Ok: params.modelId } } });
    case "session/set_mode":
      return respondOk(id, {});
    case "session/cancel":
      return respondOk(id, {});
    case "session/prompt":
      return runScenario(id, extractPromptText(params));
  }
});

function extractPromptText(params) {
  if (Array.isArray(params?.prompt) && params.prompt[0]?.type === "text") {
    return params.prompt[0].text;
  }
  return "";
}

async function runScenario(promptId, text) {
  try {
    // grok ≥0.2.33 echoes the live prompt back as a user_message_chunk before it
    // starts working (0.2.3 did not). Model it on EVERY prompt so the host's
    // replay-only de-dup is faithfully exercised by the whole integration suite
    // — the regression that doubled every sent message lived exactly here.
    notify("session/update", { sessionId: SESSION_ID, update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } } });

    if (text.includes("SCENARIO_PROPOSE_PLAN")) {
      // 1. Write to grok's own plan.md (outside the workspace — should be allowed).
      const planText = "# TEST PLAN\n\nStep 1\nStep 2";
      const writeResp = await callClient("fs/write_text_file", { sessionId: SESSION_ID, path: PLAN_PATH, content: planText });
      // 2. Send exit_plan_mode with planContent: null (matches grok 0.2.3 behavior).
      const exitResp = await callClient("x.ai/exit_plan_mode", { sessionId: SESSION_ID, planContent: null });
      // 3. End the turn whichever way the host replied.
      notify("session/update", { sessionId: SESSION_ID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "(plan turn end)" } } });
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 100 } });
      // Stash the exit response on stderr so the test can inspect what the host sent back.
      process.stderr.write(`EXIT_RESPONSE: ${JSON.stringify(exitResp)}\n`);
      return;
    }

    if (text.includes("SCENARIO_WORKSPACE_WRITE")) {
      const writeResp = await callClient("fs/write_text_file", { sessionId: SESSION_ID, path: WORKSPACE_FILE, content: "// new file" });
      process.stderr.write(`WRITE_RESPONSE: ${JSON.stringify(writeResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    if (text.includes("SCENARIO_RELATIVE_WORKSPACE_WRITE")) {
      const writeResp = await callClient("fs/write_text_file", { sessionId: SESSION_ID, path: RELATIVE_WORKSPACE_FILE, content: "// relative file" });
      process.stderr.write(`WRITE_RESPONSE: ${JSON.stringify(writeResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    if (text.includes("SCENARIO_MUTATING_TERMINAL")) {
      const termResp = await callClient("terminal/create", { sessionId: SESSION_ID, command: "rm -rf /tmp/foo" });
      process.stderr.write(`TERMINAL_RESPONSE: ${JSON.stringify(termResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    if (text.includes("SCENARIO_MUTATING_READONLY_HEAD_TERMINAL")) {
      const termResp = await callClient("terminal/create", { sessionId: SESSION_ID, command: "sed -i s/a/b/ file.ts" });
      process.stderr.write(`TERMINAL_RESPONSE: ${JSON.stringify(termResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    if (text.includes("SCENARIO_READONLY_TERMINAL")) {
      const termResp = await callClient("terminal/create", { sessionId: SESSION_ID, command: "ls -la" });
      process.stderr.write(`TERMINAL_RESPONSE: ${JSON.stringify(termResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    if (text.includes("SCENARIO_ASK_QUESTION")) {
      const askResp = await callClient("x.ai/ask_user_question", {
        sessionId: SESSION_ID,
        questions: [{
          question: "Pick one?",
          options: [{ label: "Option A", description: "first" }, { label: "Option B" }],
          multiSelect: false,
        }],
      });
      process.stderr.write(`ASK_RESPONSE: ${JSON.stringify(askResp)}\n`);
      respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 50 } });
      return;
    }

    // Default: just emit one chunk and end.
    notify("session/update", { sessionId: SESSION_ID, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } });
    respondOk(promptId, { stopReason: "end_turn", _meta: { totalTokens: 10 } });
  } catch (e) {
    process.stderr.write(`SCENARIO_ERROR: ${e.message}\n`);
    respondOk(promptId, { stopReason: "error", _meta: { totalTokens: 0 } });
  }
}
