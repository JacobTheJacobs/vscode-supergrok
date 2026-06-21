(function (root) {
  const FILE_EXTS = new Set([
    "ts","tsx","js","jsx","mjs","cjs","json","md","mdx","toml","yml","yaml",
    "css","scss","sass","less","html","htm","xml","svg",
    "py","rb","go","rs","java","kt","kts","swift","c","cc","cpp","cxx","h","hh","hpp",
    "cs","php","lua","sh","bash","zsh","fish","ps1","bat","cmd",
    "txt","lock","env","ini","cfg","conf","gitignore","dockerignore",
    "vue","svelte","astro","sql","prisma","graphql","gql",
  ]);
  function looksLikeFileRef(s) {
    if (!s || s.length > 200) return false;
    const core = s.replace(/[:#].*$/, "");
    if (/[\s"'`<>|&;]/.test(core)) return false;
    const m = core.match(/\.([A-Za-z0-9]+)$/);
    if (!m) return false;
    return FILE_EXTS.has(m[1].toLowerCase());
  }
  function formatRelativeTime(ts, now) {
    if (!ts) return "";
    const base = typeof now === "number" ? now : Date.now();
    const diff = base - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  }
  function modelDisplayName(modelId, availableModels) {
    if (!modelId) return "";
    const m = (availableModels || []).find((x) => x && x.modelId === modelId);
    if (m && m.name === ["Grok", "Build"].join(" ")) return "Grok CLI Copilot";
    return (m && m.name) || modelId;
  }
  function buildQuestionAnswers(questions, selections) {
    const answers = {};
    let allAnswered = true;
    (questions || []).forEach((q, i) => {
      const picked = (selections && selections[i]) || [];
      if (picked.length === 0) allAnswered = false;
      answers[q.question] = picked.join(", ");
    });
    return { answers, allAnswered };
  }
  function isSubagentToolCall(call) {
    if (!call) return false;
    if (call.kind === "subagent" || call.kind === "agent") return true;
    const n = String(call.tool || call.name || call.title || "")
      .replace(/[_\s-]/g, "").toLowerCase();
    if (/output$/.test(n) || n.startsWith("getcommand")) return false;
    if (/subagent|spawnagent|launchagent|dispatchagent|runagent|delegat/.test(n)) return true;
    if (n === "task" || n === "agent" || n === "agents") return true;
    const r = call.rawInput || call.input || {};
    if (r.subagent_type || r.subagentType || r.subagent ||
      r.agent_type || r.agentType || r.agent) return true;
    if (r.is_background === true || r.background === true) return true;
    if (/^\s*\[bg\]/i.test(String(call.title || ""))) return true;
    return false;
  }
  function subagentLabel(call) {
    const r = (call && (call.rawInput || call.input)) || {};
    const name = r.subagent_type || r.subagentType || r.agent_type || r.agentType ||
      r.subagent || r.agent || r.description || r.name || r.command;
    let s = name != null ? String(name).trim() : "";
    if (s.length > 48) s = s.slice(0, 47).replace(/\s+$/, "") + "…";
    if (s) return s;
    if (r.is_background === true || r.background === true) return "background task";
    return "Subagent";
  }
  function shouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold) {
    const t = typeof threshold === "number" ? threshold : 40;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    return distanceFromBottom <= t;
  }
  function splitMath(text) {
    const src = text == null ? "" : String(text);
    const segs = [];
    const re = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$\$([\s\S]+?)\$\$/g;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) segs.push({ type: "text", value: src.slice(last, m.index) });
      if (m[1] !== undefined) segs.push({ type: "math", value: m[1], display: true });
      else if (m[2] !== undefined) segs.push({ type: "math", value: m[2], display: false });
      else segs.push({ type: "math", value: m[3], display: true });
      last = re.lastIndex;
    }
    if (last < src.length) segs.push({ type: "text", value: src.slice(last) });
    return segs;
  }
  function stripUnsupportedTex(tex) {
    return (tex == null ? "" : String(tex)).replace(/\\label\s*\{[^}]*\}/g, "");
  }
  const api = { FILE_EXTS, looksLikeFileRef, formatRelativeTime, modelDisplayName, buildQuestionAnswers, isSubagentToolCall, subagentLabel, shouldStickToBottom, splitMath, stripUnsupportedTex };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.GrokWebviewHelpers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
