(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const input = $("input");
  const sendBtn = $("send-btn");
  const newBtn = $("new-btn");
  const historyBtn = $("history-btn");
  const modeBtn = $("mode-btn");
  const addBtn = $("add-btn");
  const slashBtn = $("slash-btn");
  const chipsEl = $("chips");
  const attachEl = $("attach-previews");
  const donut = $("donut");
  const donutArc = $("donut-arc");
  const donutLabel = $("donut-label");
  const donutTip = $("donut-tip");
  if (donutTip && donut) {
    document.body.appendChild(donutTip);
    const showTip = () => {
      const r = donut.getBoundingClientRect();
      donutTip.style.transform = "none";
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const tw = donutTip.offsetWidth || 150;
      const th = donutTip.offsetHeight || 40;
      let left = Math.round(r.left + r.width / 2 - tw / 2);
      left = Math.max(6, Math.min(left, vw - tw - 6));
      let top = Math.round(r.top - 8 - th);
      if (top < 6) top = Math.round(r.bottom + 8);
      donutTip.style.left = left + "px";
      donutTip.style.top = top + "px";
      donutTip.classList.add("show");
    };
    const hideTip = () => donutTip.classList.remove("show");
    donut.addEventListener("mouseenter", showTip);
    donut.addEventListener("mouseleave", hideTip);
  }
  const slashPopover = $("slash-popover");
  const modePopover = $("mode-popover");
  const settingsPopover = $("settings-popover");
  const addPopover = $("add-popover");
  const contextPopover = $("context-popover");
  const historyPopover = $("history-popover");
  const topBar = document.querySelector(".top-bar");
  const topStatus = document.querySelector(".top-brand-status");
  const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"];
  const EFFORT_TOOLTIPS = {
    none: "None — no extra reasoning",
    minimal: "Minimal — least reasoning",
    low: "Low — fast, lightweight reasoning",
    medium: "Medium — balanced",
    high: "High — deeper reasoning",
    xhigh: "Extra high — deepest reasoning, slowest",
  };
  const EFFORT_LABELS = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
  };
  const state = {
    welcomeVisible: true,
    currentModelId: null,
    availableModels: [],
    currentModeId: "agent",
    effort: "",
    cwd: "",
    contextWindow: 200000,
    showThinking: true,
    commands: [],
    chips: [],
    busy: false,
    activeAgentEl: null,
    activeAgentRaw: "",
    activeUserEl: null,
    activeUserRaw: "",
    activeThoughtEl: null,
    activeThoughtHdrEl: null,
    thoughtStartTime: null,
    activeToolGroupEl: null,
    activityRowsById: new Map(),
    slashFiltered: [],
    slashActive: 0,
    slashSearch: "",
    pendingDiffByToolCallId: new Map(),
    toolItemsByToolCallId: new Map(),
    agentRenderScheduled: false,
    thoughtBuffer: "",
    thoughtRenderScheduled: false,
    sessions: [],
    activeSessionId: null,
    dots: {},
    sessionSearch: "",
    sessionListScrollTop: 0,
    renamingSessionId: null,
    replaying: false,
    questionToolCalls: new Map(),
    restoredCardsByToolCallId: new Map(),
    planHistoryQueue: [],
    userMsgCount: 0,
    planProcessingEl: null,
    grokkingEl: null,
    busyLocked: false,
    cliVersion: "",
    startingPhase: false,
    extVersion: "",
    settingsView: "",
    suppressReplayTurn: false,
    skipUserBubble: false,
    stickToBottom: true,
  };
  const LEGACY_PRIMER_PRODUCT = ["grok", "build-vscode"].join("-");
  const PRIMER_PATTERN = new RegExp(`^\\s*\\[(?:vscode-supergrok|${LEGACY_PRIMER_PRODUCT}) primer v\\d+\\]`);
  const PLAN_MARKER_PATTERN = /^\s*\[Plan (approved|rejected|cancelled)\]\s*/i;
  function stripPlanMarker(text) {
    const m = PLAN_MARKER_PATTERN.exec(text || "");
    if (!m) return { matched: false, rest: text };
    return { matched: true, rest: (text || "").slice(m[0].length) };
  }
  const ICON = {
    eye: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`,
    file: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
    squarePen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>`,
    arrowUp: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
    square: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`,
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    sparkle: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    bot: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    listTree: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
    zap: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    atSign: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    slash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 4-8 16"/></svg>`,
  };
  const MODE_META = {
    agent: {
      icon: ICON.bot,
      label: "Agent mode",
      desc: "Grok acts directly, asking approval only for changes it judges sensitive",
    },
    plan: {
      icon: ICON.listTree,
      label: "Plan mode",
      desc: "Grok explores and proposes a plan; file writes and commands are blocked until you approve it",
    },
    yolo: {
      icon: ICON.zap,
      label: "YOLO",
      desc: "Grok will automatically approve all permission requests",
    },
  };
  const DEFAULT_SLASH_COMMANDS = [
    { name: "compact", description: "Compress conversation history to save context window", group: "Memory" },
    { name: "memory", description: "Open conversation memory", group: "Memory" },
    { name: "flush", description: "Flush conversation memory to disk now", group: "Memory" },
    { name: "dream", description: "Run memory consolidation", group: "Memory" },
    { name: "fork", description: "Fork this conversation into a new branch", group: "Session" },
  ];
  const SLASH_GROUP_ORDER = ["Context", "Session", "Model", "Memory", "Commands", "Tools", "Settings"];
  function capitalize(s) {
    if (!s) return "";
    if (s === "xhigh") return "XHigh";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function toK(n) {
    return Math.round(n / 1000) + "K";
  }
  function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function formatTime(ts) {
    const d = new Date(ts);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
  }
  function updateModeBtn(modeId) {
    // YOLO is surfaced via the "Always approve" toggle, not the mode button — when
    // auto-approve is on, keep showing the underlying operating mode here.
    const displayId = modeId === "yolo" ? (state.preYoloMode || "agent") : modeId;
    const meta = MODE_META[displayId] || MODE_META.agent;
    modeBtn.innerHTML = `${meta.icon}<span class="btn-label">${escapeHtml(meta.label)}</span>`;
    modeBtn.classList.toggle("plan-active", displayId === "plan");
    modeBtn.classList.remove("yolo-active");
  }
  function effortLabel(id) {
    return EFFORT_LABELS[id] || capitalize(id) || "Default";
  }
  function effortIndex(id) {
    const idx = EFFORT_LEVELS.indexOf(id || "");
    return idx >= 0 ? idx : EFFORT_LEVELS.indexOf("minimal");
  }
  function compactStatus(text) {
    return String(text || "")
      .replace(/\bGrok CLI Copilot\b/g, "CLI")
      .replace(/\bGrok CLI\b/g, "CLI")
      .replace(/\s+/g, " ")
      .trim();
  }
  function setTopStatus(text, tone) {
    if (!topStatus) return;
    const value = compactStatus(text) || "Connected";
    topStatus.textContent = value;
    topStatus.title = value;
    topStatus.classList.toggle("is-running", tone === "running");
    topStatus.classList.toggle("is-attention", tone === "attention");
    topStatus.classList.toggle("is-error", tone === "error");
    topStatus.classList.toggle("loading-dots", tone === "running");
    if (topBar) {
      topBar.classList.toggle("is-running", tone === "running");
      topBar.classList.toggle("is-attention", tone === "attention");
      topBar.classList.toggle("is-error", tone === "error");
    }
  }
  function connectedStatusText() {
    return state.cliVersion ? `Connected · v${state.cliVersion}` : "Connected";
  }
  function setConnectedStatus() {
    setTopStatus(connectedStatusText(), "idle");
  }
  function applyThinkingVisibility() {
    document.body.classList.toggle("hide-thinking", !state.showThinking);
  }
  function topStatusForTool(call) {
    const kind = String(call?.kind || call?.name || "").toLowerCase();
    const label = toolLabel(call || {});
    if (/web|browser|search|fetch|http|url/.test(kind) || /search|browse|fetch|web/i.test(label)) return label || "Searching";
    if (/terminal|shell|bash|command|exec/.test(kind) || /run|terminal|command|shell/i.test(label)) return label || "Running shell";
    if (/read|file|grep|list|glob/.test(kind) || /read|open|list|find/i.test(label)) return label || "Reading files";
    if (/write|edit|patch|create|delete/.test(kind) || /write|edit|patch|create|delete/i.test(label)) return label || "Editing files";
    return label || "Using tool";
  }
  newBtn.innerHTML = ICON.squarePen;
  historyBtn.innerHTML = ICON.clock;
  sendBtn.innerHTML = ICON.arrowUp;
  addBtn.innerHTML = ICON.plus;
  slashBtn.innerHTML = ICON.slash;
  updateModeBtn("agent");
  setTopStatus("Starting", "running");
  const { looksLikeFileRef, formatRelativeTime, modelDisplayName, buildQuestionAnswers, isSubagentToolCall, subagentLabel, shouldStickToBottom, splitMath, stripUnsupportedTex } = globalThis.GrokWebviewHelpers;
  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function exprActionsHtml(kind) {
    const isMermaid = kind === "mermaid";
    const label = isMermaid ? "diagram" : "LaTeX";
    const imgActions = isMermaid
      ? `<button class="expr-btn" type="button" data-expr-act="download" title="Download as PNG / SVG">${ICON.download}</button>` +
        `<button class="expr-btn" type="button" data-expr-act="open" title="Open as PNG">${ICON.file}</button>`
      : "";
    return (
      `<span class="expr-actions" contenteditable="false">` +
        `<button class="expr-btn" type="button" data-expr-act="copy" title="Copy ${label}">${ICON.copy}</button>` +
        imgActions +
      `</span>`
    );
  }
  function rawMath(src, display) {
    const esc = escapeHtml(src);
    return display
      ? `<span class="math-raw math-display">${esc}</span>`
      : `<span class="math-raw">${esc}</span>`;
  }
  function renderMath(latex, display) {
    const orig = (latex == null ? "" : String(latex)).trim();
    const src = stripUnsupportedTex(orig);
    const K = globalThis.katex;
    let inner = null;
    if (K && typeof K.renderToString === "function") {
      try {
        inner = K.renderToString(src, {
          displayMode: !!display,
          throwOnError: false,
          output: "htmlAndMathml",
          strict: "ignore",
        });
      } catch (_) {
      }
    }
    if (inner == null) inner = rawMath(src, display);
    if (!display) return inner;
    return `<span class="math-export" data-export-kind="latex" data-export-src="${escapeAttr(orig)}">` +
      inner + exprActionsHtml("latex") + `</span>`;
  }
  const mermaidSvgCache = new Map();
  const mermaidInFlight = new Set();
  let mermaidIdSeq = 0;
  let mermaidReady = false;
  function initMermaid() {
    const m = globalThis.mermaid;
    if (!m || typeof m.initialize !== "function") return;
    const light = document.body.classList.contains("vscode-light");
    const cssVar = (name, fb) => {
      try {
        const v = getComputedStyle(document.body).getPropertyValue(name).trim();
        return v || fb;
      } catch (_) { return fb; }
    };
    const fg = cssVar("--vscode-foreground", light ? "#1f1f1f" : "#cccccc");
    const accent = cssVar("--vscode-textLink-foreground", light ? "#1a73e8" : "#4daafc");
    const nodeBg = cssVar("--vscode-editorWidget-background", light ? "#f3f3f3" : "#252526");
    const border = cssVar("--vscode-panel-border", light ? "#d4d4d4" : "#3c3c3c");
    const line = cssVar("--vscode-descriptionForeground", light ? "#6a6a6a" : "#9d9d9d");
    const clusterBg = cssVar("--vscode-editor-inactiveSelectionBackground", light ? "#e8eaf3" : "#2d2d2d");
    const font = cssVar("--vscode-font-family", "sans-serif");
    try {
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        fontFamily: font,
        themeVariables: {
          darkMode: !light,
          background: "transparent",
          fontFamily: font,
          fontSize: "14px",
          primaryColor: nodeBg,
          primaryTextColor: fg,
          primaryBorderColor: accent,
          secondaryColor: clusterBg,
          tertiaryColor: clusterBg,
          mainBkg: nodeBg,
          nodeBorder: accent,
          lineColor: line,
          textColor: fg,
          titleColor: fg,
          clusterBkg: clusterBg,
          clusterBorder: border,
          edgeLabelBackground: nodeBg,
          actorBkg: nodeBg,
          actorBorder: accent,
          noteBkgColor: clusterBg,
          noteBorderColor: border,
        },
        themeCSS:
          ".node rect,.node polygon,.node circle,.node path{rx:6px;ry:6px}" +
          ".edgePath .path{stroke-width:1.5px}",
        flowchart: { curve: "basis", useMaxWidth: true, padding: 14, nodeSpacing: 48, rankSpacing: 56, diagramPadding: 10 },
        sequence: { useMaxWidth: true, wrap: true, mirrorActors: false },
      });
      mermaidReady = true;
    } catch (_) {
      mermaidReady = false;
    }
  }
  function mermaidSourceOf(block) {
    const codeEl = block.querySelector(".mermaid-src code") || block.querySelector(".mermaid-src");
    return (codeEl ? codeEl.textContent : "").trim();
  }
  function decorateMermaid(block, svg, src) {
    block.innerHTML = svg + exprActionsHtml("mermaid");
    block.setAttribute("data-export-kind", "mermaid");
    block.setAttribute("data-export-src", src);
    block.setAttribute("data-mermaid-state", "done");
  }
  function applyCachedMermaid(src) {
    const svg = mermaidSvgCache.get(src);
    if (!svg) return;
    document.querySelectorAll(".mermaid-block").forEach((block) => {
      if (block.getAttribute("data-mermaid-state") === "done") return;
      if (mermaidSourceOf(block) === src) {
        decorateMermaid(block, svg, src);
      }
    });
  }
  function renderMermaidIn(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const blocks = root.querySelectorAll(".mermaid-block");
    if (!blocks.length) return;
    const m = globalThis.mermaid;
    if (!mermaidReady || !m || typeof m.render !== "function") return;
    blocks.forEach((block) => {
      if (block.getAttribute("data-mermaid-state") === "done") return;
      const src = mermaidSourceOf(block);
      if (!src) return;
      if (mermaidSvgCache.has(src)) {
        const svg = mermaidSvgCache.get(src);
        if (svg) decorateMermaid(block, svg, src);
        return;
      }
      if (mermaidInFlight.has(src)) return;
      mermaidInFlight.add(src);
      const id = "grok-mmd-" + (mermaidIdSeq++);
      Promise.resolve()
        .then(() => m.render(id, src))
        .then((res) => { mermaidSvgCache.set(src, (res && res.svg) || null); })
        .catch(() => { mermaidSvgCache.set(src, null); })
        .then(() => {
          mermaidInFlight.delete(src);
          applyCachedMermaid(src);
        });
    });
  }
  function canRasterize() {
    try { return !!document.createElement("canvas").getContext("2d"); } catch (_) { return false; }
  }
  function themeVar(name, fallback) {
    try {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch (_) { return fallback; }
  }
  function exportColors() {
    return {
      bg: themeVar("--vscode-sideBar-background", "#1e1e1e"),
      fg: themeVar("--vscode-foreground", "#cccccc"),
    };
  }
  function themedSvg(svgEl, color, bg) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    let style = clone.getAttribute("style") || "";
    if (color) style += `;color:${color}`;
    if (bg) style += `;background:${bg}`;
    clone.setAttribute("style", style);
    return new XMLSerializer().serializeToString(clone);
  }
  async function mermaidThemedSvg(src, theme, fallbackEl) {
    const m = globalThis.mermaid;
    if (m && typeof m.render === "function" && src) {
      try {
        const id = "grok-mmd-exp-" + (mermaidIdSeq++);
        const res = await m.render(id, `%%{init: {'theme':'${theme}'}}%%\n` + src);
        if (res && res.svg) {
          const tmp = document.createElement("div");
          tmp.innerHTML = res.svg;
          const el = tmp.querySelector("svg");
          if (el) return themedSvg(el, null, null);
        }
      } catch (_) {  }
    }
    return fallbackEl ? themedSvg(fallbackEl, null, null) : "";
  }
  function svgToPng(svgStr, w, h, scale, bg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
    });
  }
  function copyExprSource(src, btn) {
    navigator.clipboard.writeText(src || "").then(() => {
      const prev = btn.innerHTML;
      btn.innerHTML = ICON.check;
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = prev; btn.classList.remove("copied"); }, 1500);
    });
  }
  async function exportExpr(host, action) {
    const svgEl = host.querySelector("svg");
    if (!svgEl) return;
    const kind = host.getAttribute("data-export-kind") || "latex";
    const colors = exportColors();
    const rect = svgEl.getBoundingClientRect();
    const w = rect.width || 320, h = rect.height || 100;
    const wysiwyg = themedSvg(svgEl, colors.fg, colors.bg);
    let png = null;
    if (canRasterize()) {
      try { png = await svgToPng(wysiwyg, w, h, 3, colors.bg); } catch (_) { png = null; }
    }
    if (action === "open") {
      vscode.postMessage({ type: "exportExpr", action, kind, svg: wysiwyg, png });
      return;
    }
    let svgDark, svgLight;
    if (kind === "mermaid") {
      const src = host.getAttribute("data-export-src") || "";
      svgDark = await mermaidThemedSvg(src, "dark", svgEl);
      svgLight = await mermaidThemedSvg(src, "default", svgEl);
    } else {
      svgDark = themedSvg(svgEl, "#e8e8e8", null);
      svgLight = themedSvg(svgEl, "#1f1f1f", null);
    }
    const current = document.body.classList.contains("vscode-light") ? "light" : "dark";
    vscode.postMessage({ type: "exportExpr", action, kind, png, svgDark, svgLight, current });
  }
  function renderDiffCode(code) {
    const lines = code.replace(/\n+$/, "").split("\n");
    const body = lines.map((ln) => {
      let cls = "diff-line";
      if (/^@@/.test(ln)) cls += " diff-hunk";
      else if (/^(\+\+\+|---|diff |index )/.test(ln)) cls += " diff-meta";
      else if (ln[0] === "+") cls += " diff-add";
      else if (ln[0] === "-") cls += " diff-del";
      return `<span class="${cls}">${escapeHtml(ln) || "&nbsp;"}</span>`;
    }).join("");
    return `<code class="diff-code">${body}</code>`;
  }
  function renderMarkdown(raw) {
    const codeBlocks = [];
    let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const i = codeBlocks.length;
      if (lang === "mermaid") {
        codeBlocks.push(
          `<div class="code-block mermaid-block">` +
            `<button class="code-copy-btn" type="button" title="Copy code">` +
              `<span class="code-copy-glyph">${ICON.copy}</span>` +
              `<span class="code-copy-label">Copy code</span>` +
            `</button>` +
            `<pre class="mermaid-src"><code>${escapeHtml(code).trimEnd()}</code></pre>` +
          `</div>`
        );
        return `\x00B${i}\x00`;
      }
      const isDiff = lang === "diff";
      const inner = isDiff
        ? renderDiffCode(code)
        : `<code>${escapeHtml(code).trimEnd()}</code>`;
      codeBlocks.push(
        `<div class="code-block${isDiff ? " diff" : ""}">` +
          `<button class="code-copy-btn" type="button" title="Copy code">` +
            `<span class="code-copy-glyph">${ICON.copy}</span>` +
            `<span class="code-copy-label">Copy code</span>` +
          `</button>` +
          `<pre>${inner}</pre>` +
        `</div>`
      );
      return `\x00B${i}\x00`;
    });
    const mathHtml = [];
    s = splitMath(s).map((seg) => {
      if (seg.type !== "math") return seg.value;
      const i = mathHtml.length;
      mathHtml.push(renderMath(seg.value, seg.display));
      return seg.display ? `\x00D${i}\x00` : `\x00M${i}\x00`;
    }).join("");
    function inline(t) {
      return t
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/`([^`\n]+)`/g, (_, code) => {
          if (looksLikeFileRef(code)) {
            const safe = code.replace(/"/g, "&quot;");
            return `<a href="${safe}" class="file-ref-link"><code>${code}</code></a>`;
          }
          return `<code>${code}</code>`;
        })
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
          const safe = url.replace(/"/g, "&quot;");
          return `<a href="${safe}">${text}</a>`;
        })
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    }
    const tables = [];
    {
      const isTableRow = (l) => /^\s*\|.+\|\s*$/.test(l);
      const isSep = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l);
      const splitRow = (l) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const srcLines = s.split('\n');
      const kept = [];
      let i = 0;
      while (i < srcLines.length) {
        if (i + 1 < srcLines.length && isTableRow(srcLines[i]) && isSep(srcLines[i + 1])) {
          const headers = splitRow(srcLines[i]);
          const sepCells = splitRow(srcLines[i + 1]);
          if (headers.length === sepCells.length) {
            const aligns = sepCells.map(c => {
              const L = c.startsWith(':'), R = c.endsWith(':');
              return L && R ? 'center' : R ? 'right' : L ? 'left' : '';
            });
            const rows = [];
            let j = i + 2;
            while (j < srcLines.length && isTableRow(srcLines[j])) {
              const cells = splitRow(srcLines[j]);
              while (cells.length < headers.length) cells.push('');
              rows.push(cells.slice(0, headers.length));
              j++;
            }
            const styleFor = (k) => aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
            let html = '<div class="md-table-wrap"><table><thead><tr>';
            headers.forEach((h, k) => { html += `<th${styleFor(k)}>${inline(h)}</th>`; });
            html += '</tr></thead><tbody>';
            for (const row of rows) {
              html += '<tr>';
              row.forEach((c, k) => { html += `<td${styleFor(k)}>${inline(c)}</td>`; });
              html += '</tr>';
            }
            html += '</tbody></table></div>';
            const idx = tables.length;
            tables.push(html);
            kept.push(`\x00T${idx}\x00`);
            i = j;
            continue;
          }
        }
        kept.push(srcLines[i]);
        i++;
      }
      s = kept.join('\n');
    }
    function expandInline(line) {
      if (!/^\s*\d+\. /.test(line)) return [line];
      const indent = line.match(/^(\s*)/)[1];
      const parts = line.trim().split(/(?<=\S)\s+(?=\d+\. )/);
      if (parts.length <= 1) return [line];
      const nums = parts.map(p => parseInt(p.match(/^(\d+)\./)?.[1] ?? '0'));
      const sequential = nums.every((n, i) => n === i + 1);
      return sequential ? parts.map(p => indent + p) : [line];
    }
    const rawLines = s.split('\n');
    const lines = [];
    for (const ln of rawLines) lines.push(...expandInline(ln));
    let out = '';
    let stack = [];
    let pendingBreak = false;
    let lastWasBlock = false;
    let lastPara = false;
    function closeLiAt(i) {
      if (stack[i].liOpen) { out += '</li>'; stack[i].liOpen = false; }
    }
    function closeFrom(depth) {
      for (let i = stack.length - 1; i >= depth; i--) {
        closeLiAt(i);
        out += `</${stack[i].tag}>`;
      }
      stack = stack.slice(0, depth);
    }
    for (const line of lines) {
      if (!line.trim()) {
        if (stack.length === 0 && !lastWasBlock) pendingBreak = true;
        lastPara = false;
        continue;
      }
      lastWasBlock = false;
      const tm = line.trim().match(/^\x00T(\d+)\x00$/);
      if (tm) {
        closeFrom(0);
        out += `\x00T${tm[1]}\x00`;
        lastWasBlock = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }
      const dm = line.trim().match(/^\x00D(\d+)\x00$/);
      if (dm) {
        closeFrom(0);
        out += `\x00D${dm[1]}\x00`;
        lastWasBlock = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }
      const hm = line.match(/^(#{1,3}) (.+)$/);
      if (hm) {
        closeFrom(0);
        out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`;
        lastWasBlock = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }
      const lm = line.match(/^( *)([-*]|\d+\.) (.+)$/);
      if (lm) {
        const indent = lm[1].length;
        const isOl = /\d/.test(lm[2][0]);
        const tag = isOl ? 'ol' : 'ul';
        const content = lm[3];
        while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
          closeLiAt(stack.length - 1);
          out += `</${stack[stack.length - 1].tag}>`;
          stack.pop();
        }
        if (stack.length === 0 || stack[stack.length - 1].indent < indent) {
          out += `<${tag}>`;
          stack.push({ tag, indent, liOpen: false });
        } else {
          closeLiAt(stack.length - 1);
          if (stack[stack.length - 1].tag !== tag) {
            out += `</${stack[stack.length - 1].tag}><${tag}>`;
            stack[stack.length - 1].tag = tag;
          }
        }
        out += `<li>${inline(content)}`;
        stack[stack.length - 1].liOpen = true;
        lastPara = false;
        pendingBreak = false;
        continue;
      }
      closeFrom(0);
      if (pendingBreak) { out += '<br><br>'; pendingBreak = false; }
      else if (lastPara) out += '<br>';
      out += inline(line);
      lastPara = true;
    }
    closeFrom(0);
    return out
      .replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i])
      .replace(/\x00T(\d+)\x00/g, (_, i) => tables[+i])
      .replace(/\x00D(\d+)\x00/g, (_, i) => mathHtml[+i])
      .replace(/\x00M(\d+)\x00/g, (_, i) => mathHtml[+i]);
  }
  function closePopovers() {
    modePopover.hidden = true;
    settingsPopover.hidden = true;
    addPopover.hidden = true;
    contextPopover.hidden = true;
    slashPopover.hidden = true;
    historyPopover.hidden = true;
  }
  function positionPopover(popover, btn) {
    const composerRect = popover.parentElement.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    popover.style.top = "auto";
    popover.style.bottom = (composerRect.bottom - btnRect.top + 4) + "px";
    popover.style.left = (btnRect.left - composerRect.left) + "px";
    popover.style.right = "auto";
    requestAnimationFrame(() => {
      const pw = popover.getBoundingClientRect().width;
      const leftOffset = btnRect.left - composerRect.left;
      if (leftOffset + pw > composerRect.width) {
        popover.style.left = Math.max(0, composerRect.width - pw) + "px";
      }
    });
  }
  function positionDropdownPopover(popover, btn) {
    const parentRect = popover.parentElement.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    popover.style.bottom = "auto";
    popover.style.top = (btnRect.bottom - parentRect.top + 4) + "px";
    popover.style.left = (btnRect.left - parentRect.left) + "px";
    popover.style.right = "auto";
    requestAnimationFrame(() => {
      const pw = popover.getBoundingClientRect().width;
      const leftOffset = btnRect.left - parentRect.left;
      if (leftOffset + pw > parentRect.width) {
        popover.style.left = Math.max(0, parentRect.width - pw) + "px";
      }
    });
  }
  function addSettingsItem(labelHtml, onclick) {
    const el = document.createElement("div");
    el.className = "toolbar-popover-item";
    el.innerHTML = labelHtml;
    el.onclick = (e) => { e.stopPropagation(); onclick(); };
    settingsPopover.appendChild(el);
  }
  function reopenSlashFromSettings() {
    settingsPopover.hidden = true;
    const m = slashQueryAtCursor();
    showSlashCommands(m ? m[1] : "");
  }
  function openSettingsSubpanel(render) {
    closePopovers();
    render(reopenSlashFromSettings);
    positionPopover(settingsPopover, slashBtn);
    settingsPopover.hidden = false;
  }
  function renderConfigDebugPanel(backAction = reopenSlashFromSettings) {
    state.settingsView = "config";
    settingsPopover.innerHTML = "";
    addSettingsItem('<span class="popover-back">← Config &amp; debug</span>', backAction);
    addSettingsItem('<span>Open global config</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "openGlobalConfig" });
      closePopovers();
    });
    addSettingsItem('<span>Open project config</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "openProjectConfig" });
      closePopovers();
    });
    addSettingsItem('<span>MCP servers</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "runMcpList" });
      closePopovers();
    });
    addSettingsItem('<span>Skills folder</span><span class="popover-external">↗</span>', () => {
      vscode.postMessage({ type: "openSkillsFolder" });
      closePopovers();
    });
  }
  function renderModelPicker(backAction = reopenSlashFromSettings) {
    state.settingsView = "model";
    settingsPopover.innerHTML = "";
    addSettingsItem('<span class="popover-back">← Model</span>', backAction);
    const models = state.availableModels.length
      ? state.availableModels
      : [{ modelId: state.currentModelId || "grok-build", name: state.currentModelId || "grok-build" }];
    for (const m of models) {
      const el = document.createElement("div");
      const active = m.modelId === state.currentModelId;
      el.className = "toolbar-popover-item" + (active ? " active" : "");
      el.innerHTML = `<span>${escapeHtml(truncate(m.name || m.modelId, 28))}</span>${active ? '<span class="popover-check">✓</span>' : ""}`;
      el.title = m.modelId;
      el.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "setModel", modelId: m.modelId });
        closePopovers();
      };
      settingsPopover.appendChild(el);
    }
  }
  function openModePopover() {
    if (!modePopover.hidden) { closePopovers(); return; }
    modePopover.innerHTML = "";
    for (const [id, meta] of Object.entries(MODE_META)) {
      // YOLO is controlled by the "Always approve" permission toggle, not the
      // mode picker — but its metadata stays in MODE_META so the mode button
      // still shows the YOLO label/style while it's active.
      if (id === "yolo") continue;
      const el = document.createElement("div");
      const baseMode = state.currentModeId === "yolo" ? (state.preYoloMode || "agent") : state.currentModeId;
      const active = id === baseMode;
      el.className = "toolbar-popover-item mode-popover-item" +
        (active ? " active" : "") +
        (meta.disabled ? " disabled" : "");
      el.innerHTML =
        `<span class="mode-item-icon">${meta.icon}</span>` +
        `<span class="mode-item-body">` +
          `<span class="mode-item-label">${escapeHtml(meta.label)}</span>` +
          `<span class="mode-item-desc">${escapeHtml(meta.desc)}</span>` +
          (meta.disabledNote ? `<span class="mode-item-disabled-note">${escapeHtml(meta.disabledNote)}</span>` : "") +
        `</span>` +
        (active ? '<span class="popover-check">✓</span>' : "");
      el.onclick = (e) => {
        e.stopPropagation();
        if (meta.disabled) return;
        vscode.postMessage({ type: "setMode", modeId: id });
        closePopovers();
      };
      modePopover.appendChild(el);
    }
    positionPopover(modePopover, modeBtn);
    modePopover.hidden = false;
  }
  function openAddPopover() {
    if (!addPopover.hidden) { closePopovers(); return; }
    closePopovers();
    addPopover.innerHTML = "";
    const ctx = document.createElement("div");
    ctx.className = "toolbar-popover-item";
    ctx.innerHTML = `<span class="add-item-icon">${ICON.atSign}</span><span>Add context</span>`;
    ctx.onclick = (e) => {
      e.stopPropagation();
      openContextPicker();
    };
    addPopover.appendChild(ctx);
    const item = document.createElement("div");
    item.className = "toolbar-popover-item";
    item.innerHTML = `<span class="add-item-icon">${ICON.upload}</span><span>Upload from computer</span>`;
    item.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "pickFile" });
      closePopovers();
    };
    addPopover.appendChild(item);
    positionPopover(addPopover, addBtn);
    addPopover.hidden = false;
  }
  let ctxItems = [];
  let ctxDir = "";
  let ctxParent = null;
  let ctxQuery = "";
  let ctxActive = 0;
  let ctxRows = [];
  let ctxLoading = true;
  let ctxFromAt = false;
  function openContextPicker(fromAt) {
    closePopovers();
    ctxFromAt = !!fromAt;
    ctxItems = []; ctxDir = ""; ctxParent = null; ctxQuery = ""; ctxActive = 0; ctxLoading = true;
    contextPopover.innerHTML =
      `<div class="context-search-wrap"><span class="context-search-icon">${ICON.search}</span>` +
      `<input type="text" class="context-search" placeholder="Search this folder…" spellcheck="false" /></div>` +
      `<div class="context-crumb"></div>` +
      `<div class="context-list"></div>`;
    contextPopover.hidden = false;
    const search = contextPopover.querySelector(".context-search");
    search.addEventListener("input", () => { ctxQuery = search.value; ctxActive = 0; renderContextList(); });
    search.addEventListener("keydown", onContextKeydown);
    renderContextList();
    vscode.postMessage({ type: "listContext", dir: "" });
    setTimeout(() => search.focus(), 0);
  }
  function navigateContext(dir) {
    ctxLoading = true;
    ctxQuery = "";
    ctxActive = 0;
    const search = contextPopover.querySelector(".context-search");
    if (search) search.value = "";
    renderContextList();
    vscode.postMessage({ type: "listContext", dir: dir || "" });
  }
  function buildContextRows() {
    const q = ctxQuery.toLowerCase().trim();
    const rows = [];
    if (!q && ctxParent !== null) rows.push({ kind: "up" });
    for (const it of ctxItems) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      rows.push({ kind: it.isDir ? "dir" : "file", item: it });
    }
    return rows;
  }
  function renderContextList() {
    const crumb = contextPopover.querySelector(".context-crumb");
    if (crumb) crumb.textContent = ctxDir ? "/" + ctxDir : "workspace root";
    const listEl = contextPopover.querySelector(".context-list");
    if (!listEl) return;
    if (ctxLoading) { listEl.innerHTML = `<div class="context-empty">Loading…</div>`; return; }
    ctxRows = buildContextRows();
    if (!ctxRows.length) {
      listEl.innerHTML = `<div class="context-empty">${ctxQuery ? "No matches in this folder" : "Empty folder"}</div>`;
      return;
    }
    if (ctxActive >= ctxRows.length) ctxActive = ctxRows.length - 1;
    listEl.innerHTML = "";
    ctxRows.forEach((row, i) => {
      const el = document.createElement("div");
      el.className = "context-row" + (i === ctxActive ? " active" : "");
      if (row.kind === "up") {
        el.innerHTML = `<span class="context-row-icon">${ICON.folder}</span><span class="context-row-name">..</span>`;
        el.onclick = () => navigateContext(ctxParent);
      } else {
        const it = row.item;
        el.innerHTML =
          `<span class="context-row-icon">${it.isDir ? ICON.folder : ICON.file}</span>` +
          `<span class="context-row-name">${escapeHtml(it.name)}</span>` +
          (it.isDir ? `<button class="context-row-add" type="button" title="Add this folder">${ICON.plus}</button>` : "");
        el.onclick = () => (row.kind === "dir" ? navigateContext(it.relPath) : addContextItem(it));
        if (it.isDir) {
          const addBtn = el.querySelector(".context-row-add");
          if (addBtn) addBtn.onclick = (e) => { e.stopPropagation(); addContextItem(it); };
        }
      }
      listEl.appendChild(el);
    });
  }
  function scrollContextActive() {
    const listEl = contextPopover.querySelector(".context-list");
    const active = listEl && listEl.children[ctxActive];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }
  function closeContextPicker() {
    contextPopover.hidden = true;
    if (ctxFromAt) {
      input.value = input.value.replace(/(^|\s)@\S*$/, "$1");
      renderInputHighlight();
      ctxFromAt = false;
    }
  }
  function addContextItem(it) {
    if (!it) return;
    vscode.postMessage({ type: "addContextPath", path: it.fsPath });
    closeContextPicker();
    input.focus();
  }
  function onContextKeydown(e) {
    const n = ctxRows.length;
    if (e.key === "Escape") { e.preventDefault(); closeContextPicker(); input.focus(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) { ctxActive = Math.min(n - 1, ctxActive + 1); renderContextList(); scrollContextActive(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) { ctxActive = Math.max(0, ctxActive - 1); renderContextList(); scrollContextActive(); } }
    else if (e.key === "Enter") {
      e.preventDefault();
      const row = ctxRows[ctxActive];
      if (!row) return;
      if (row.kind === "up") navigateContext(ctxParent);
      else if (row.kind === "dir") navigateContext(row.item.relPath);
      else addContextItem(row.item);
    }
  }
  function atQueryAtCursor() {
    return (input.value.slice(0, input.selectionStart || 0)).match(/(?:^|\s)@(\S*)$/);
  }
  function updateAtMention() {
    const m = atQueryAtCursor();
    if (!m) {
      if (ctxFromAt && !contextPopover.hidden) { ctxFromAt = false; contextPopover.hidden = true; }
      return;
    }
    if (contextPopover.hidden) openContextPicker(true);
  }
  const DOT_LABEL = {
    working: "Working",
    "needs-you": "Needs you",
    unread: "Finished — unopened",
    error: "Finished with an error — unopened",
  };
  function applySessionDot(dot, value) {
    const v = DOT_LABEL[value] ? value : "none";
    dot.className = "history-row-dot dot-" + v;
    dot.title = DOT_LABEL[value] || "";
  }
  function patchSessionDot(id) {
    const sel = "[data-session-dot=\"" + (window.CSS && CSS.escape ? CSS.escape(id) : id) + "\"]";
    const dot = historyPopover.querySelector(sel);
    if (dot) applySessionDot(dot, state.dots[id]);
  }
  function renderHistoryList() {
    const previousList = historyPopover.querySelector(".history-list");
    const previousScrollTop = previousList ? previousList.scrollTop : state.sessionListScrollTop;
    historyPopover.innerHTML = "";
    const searchWrap = document.createElement("div");
    searchWrap.className = "history-search-wrap";
    const search = document.createElement("input");
    search.type = "text";
    search.className = "history-search";
    search.placeholder = "Search sessions…";
    search.value = state.sessionSearch;
    search.oninput = () => {
      state.sessionSearch = search.value;
      renderSessionRows();
    };
    search.onkeydown = (e) => { e.stopPropagation(); };
    search.onclick = (e) => e.stopPropagation();
    searchWrap.appendChild(search);
    historyPopover.appendChild(searchWrap);
    const list = document.createElement("div");
    list.className = "history-list";
    list.scrollTop = previousScrollTop || 0;
    list.onscroll = () => {
      state.sessionListScrollTop = list.scrollTop;
    };
    historyPopover.appendChild(list);
    function renderSessionRows() {
      list.innerHTML = "";
      const q = state.sessionSearch.trim().toLowerCase();
      const filtered = state.sessions.filter((s) => {
        if (!q) return true;
        return (s.displayName || "").toLowerCase().includes(q);
      });
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = state.sessions.length === 0 ? "No sessions yet." : "No matches.";
        list.appendChild(empty);
        return;
      }
      for (const s of filtered) {
        list.appendChild(renderSessionRow(s));
      }
    }
    function renderSessionRow(s) {
      const row = document.createElement("div");
      const active = s.id === state.activeSessionId;
      row.className = "history-row" + (active ? " active" : "");
      const dot = document.createElement("span");
      dot.setAttribute("data-session-dot", s.id);
      applySessionDot(dot, state.dots[s.id]);
      row.appendChild(dot);
      const main = document.createElement("div");
      main.className = "history-row-main";
      if (state.renamingSessionId === s.id) {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "history-rename";
        inp.value = s.displayName;
        inp.onclick = (e) => e.stopPropagation();
        inp.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            vscode.postMessage({ type: "renameSession", id: s.id, name: inp.value });
            state.renamingSessionId = null;
          } else if (e.key === "Escape") {
            state.renamingSessionId = null;
            renderSessionRows();
          }
        };
        inp.onblur = () => {
          if (state.renamingSessionId === s.id) {
            vscode.postMessage({ type: "renameSession", id: s.id, name: inp.value });
            state.renamingSessionId = null;
          }
        };
        main.appendChild(inp);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else {
        const name = document.createElement("div");
        name.className = "history-row-name";
        name.textContent = s.displayName || "Untitled";
        name.title = s.rawSummary || s.displayName || "";
        main.appendChild(name);
        const meta = document.createElement("div");
        meta.className = "history-row-meta";
        const parts = [];
        if (s.numMessages) parts.push(`${s.numMessages} msg`);
        parts.push(formatRelativeTime(s.updatedAt));
        meta.textContent = parts.join(" · ");
        main.appendChild(meta);
        row.onclick = () => {
          if (active) { closePopovers(); return; }
          vscode.postMessage({ type: "resumeSession", id: s.id });
          closePopovers();
        };
      }
      row.appendChild(main);
      const actions = document.createElement("div");
      actions.className = "history-row-actions";
      const renameBtn = document.createElement("button");
      renameBtn.className = "history-action-btn";
      renameBtn.innerHTML = ICON.pencil;
      renameBtn.title = "Rename";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        state.renamingSessionId = s.id;
        renderSessionRows();
      };
      actions.appendChild(renameBtn);
      if (!active) {
        const delBtn = document.createElement("button");
        delBtn.className = "history-action-btn history-action-danger";
        delBtn.innerHTML = ICON.trash;
        delBtn.title = "Delete";
        delBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "deleteSession", id: s.id, name: s.displayName });
        };
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);
      return row;
    }
    renderSessionRows();
    list.scrollTop = previousScrollTop || 0;
  }
  function openHistoryPopover() {
    if (!historyPopover.hidden) { closePopovers(); return; }
    closePopovers();
    state.sessionSearch = "";
    state.sessionListScrollTop = 0;
    state.renamingSessionId = null;
    renderHistoryList();
    positionDropdownPopover(historyPopover, historyBtn);
    historyPopover.hidden = false;
    vscode.postMessage({ type: "listSessions" });
  }
  function clearWelcome() {
    if (!state.welcomeVisible) return;
    const welcome = $("welcome");
    if (welcome) welcome.hidden = true;
    state.welcomeVisible = false;
  }
  function resetForNewSession() {
    for (const child of Array.from(messagesEl.children)) {
      if (child.id !== "welcome") child.remove();
    }
    const welcome = $("welcome");
    if (welcome) {
      welcome.hidden = false;
      const onb = $("welcome-onboarding");
      if (onb) onb.innerHTML = "";
      const ver = $("welcome-version");
      if (ver) { ver.classList.add("loading-dots"); ver.textContent = "Starting"; }
    }
    state.welcomeVisible = true;
    state.pendingDiffByToolCallId.clear();
    state.toolItemsByToolCallId.clear();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeUserEl = null;
    state.activeUserRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtBuffer = "";
    state.activeToolGroupEl = null;
    state.replaying = false;
    state.planHistoryQueue = [];
    state.userMsgCount = 0;
    state.suppressReplayTurn = false;
    state.skipUserBubble = false;
    state.stickToBottom = true;
    setTopStatus("Starting", "running");
    hidePlanProcessing();
    hideGrokking();
  }
  function showStartupStatus(text) {
    const verEl = $("welcome-version");
    if (!verEl) return;
    verEl.classList.add("loading-dots");
    verEl.textContent = String(text || "Starting");
    setTopStatus(text || "Starting", "running");
  }
  function showOnboarding(mode, info) {
    info = info || {};
    const welcome = $("welcome");
    if (welcome) welcome.hidden = false;
    state.welcomeVisible = true;
    const onb = $("welcome-onboarding");
    const ver = $("welcome-version");
    if (!onb) return;
    if (mode === "missing-cli") {
      if (ver) { ver.classList.remove("loading-dots"); ver.textContent = "CLI not installed"; }
      const installCmd = info.platform === "win32"
        ? "irm https://x.ai/cli/install.ps1 | iex"
        : "curl -fsSL https://x.ai/cli/install.sh | bash";
      onb.innerHTML =
        `<div class="onb">` +
          `<p class="onb-heading">Install the Grok CLI</p>` +
          `<div class="onb-cmd">` +
            `<code>${installCmd}</code>` +
            `<button class="onb-copy" type="button" title="Copy" data-cmd="${installCmd}">${ICON.copy}</button>` +
          `</div>` +
          `<button class="onb-action" type="button" data-act="runInstall">Open terminal &amp; run</button>` +
          `<button class="onb-action onb-secondary" type="button" data-act="recheck">Re-check connection</button>` +
        `</div>`;
    } else if (mode === "auth-required") {
      if (ver) { ver.classList.remove("loading-dots"); ver.textContent = "Authentication required"; }
      onb.innerHTML =
        `<div class="onb">` +
          `<p class="onb-heading">Sign in to continue</p>` +
          `<p class="onb-desc"><strong>SuperGrok Heavy subscription</strong> &mdash; required for the Grok CLI build entitlement.</p>` +
          `<button class="onb-action" type="button" data-act="runLogin">Open terminal &amp; run <code>grok login</code></button>` +
          `<button class="onb-action onb-secondary" type="button" data-act="recheck">Re-check connection</button>` +
        `</div>`;
    } else {
      onb.innerHTML = "";
    }
  }
  function makeCollapsible(el, container) {
    el.classList.add("collapsible");
    const expandBtn = document.createElement("button");
    expandBtn.className = "msg-expand-btn";
    expandBtn.textContent = "Show more";
    container.appendChild(expandBtn);
    expandBtn.onclick = () => {
      el.classList.remove("collapsible");
      expandBtn.style.display = "none";
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "msg-collapse-btn";
      collapseBtn.textContent = "Show less";
      container.appendChild(collapseBtn);
      collapseBtn.onclick = () => {
        el.classList.add("collapsible");
        expandBtn.style.display = "";
        collapseBtn.remove();
      };
    };
  }
  function addMessage(role, text, chips) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el._copyText = text || "";
    let contentParent = el;
    if (role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "msg-bubble";
      el.appendChild(bubble);
      contentParent = bubble;
    }
    const body = document.createElement("div");
    body.className = "body";
    if (text) { body.innerHTML = renderMarkdown(text); renderMermaidIn(body); }
    if (role === "user" && chips && chips.length > 0) {
      const imageChips = chips.filter((c) =>
        !c.hidden &&
        !!(c.dataUrl || c.imageData || (c.imageMime && c.imageMime.startsWith("image/")) || /\.(png|jpe?g|gif|webp|svg)$/i.test(c.relPath))
      );
      if (imageChips.length > 0) {
        const previews = document.createElement("div");
        previews.className = "attached-images";
        for (const chip of imageChips) {
          const src = chip.dataUrl || (chip.imageData && chip.imageMime ? `data:${chip.imageMime};base64,${chip.imageData}` : "");
          if (src) {
            const wrap = document.createElement("div");
            wrap.className = "attached-image";
            const fileName = chip.relPath.split(/[\\/]/).pop() || chip.relPath;
            const img = document.createElement("img");
            img.src = src;
            img.alt = fileName;
            img.title = chip.relPath || fileName;
            wrap.appendChild(img);
            previews.appendChild(wrap);
          }
        }
        contentParent.appendChild(previews);
      }
    }
    contentParent.appendChild(body);
    if (role === "user" && chips && chips.length > 0) {
      const chipsRow = document.createElement("div");
      chipsRow.className = "msg-chips";
      for (const chip of chips) {
        const tag = document.createElement("span");
        tag.className = "msg-chip";
        const fileName = chip.relPath.split(/[\\/]/).pop() || chip.relPath;
        const isImg = !!(chip.dataUrl || chip.imageData || (chip.imageMime && chip.imageMime.startsWith("image/")) || /\.(png|jpe?g|gif|webp|svg)$/i.test(chip.relPath));
        if (isImg) {
          const src = chip.dataUrl || (chip.imageData && chip.imageMime ? `data:${chip.imageMime};base64,${chip.imageData}` : "");
          if (src) {
            const img = document.createElement("img");
            img.className = "msg-chip-thumb";
            img.src = src;
            img.alt = "";
            const label = document.createElement("span");
            label.textContent = truncate(fileName, 20);
            tag.appendChild(img);
            tag.appendChild(label);
          } else {
            tag.innerHTML = ICON.file + `<span>${escapeHtml(truncate(fileName, 20))}</span>`;
          }
        } else {
          tag.innerHTML = ICON.file + `<span>${escapeHtml(truncate(fileName, 20))}</span>`;
        }
        tag.title = chip.relPath || chip.path || "";
        chipsRow.appendChild(tag);
      }
      contentParent.appendChild(chipsRow);
    }
    if (role === "user" || role === "agent") {
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const copyBtn = document.createElement("button");
      copyBtn.className = "msg-action-btn msg-copy-btn";
      copyBtn.type = "button";
      copyBtn.title = "Copy message";
      copyBtn.innerHTML = `<span class="msg-action-glyph">${ICON.copy}</span>`;
      const ts = document.createElement("span");
      ts.className = "msg-timestamp";
      ts.textContent = formatTime(Date.now());
      actions.appendChild(copyBtn);
      actions.appendChild(ts);
      el.appendChild(actions);
    }
    messagesEl.appendChild(el);
    scrollToBottom();
    if (role === "user" && text) {
      requestAnimationFrame(() => {
        if (body.scrollHeight > 56) makeCollapsible(el, contentParent);
      });
    }
    return body;
  }
  const TOOL_VERB = {
    read_file: "Read", file_read: "Read",
    write_file: "Write", file_write: "Write", write: "Write",
    bash: "Run", execute: "Run", run_command: "Run", run_terminal_command: "Run",
    shell: "Run", run_bash: "Run",
    list_dir: "List", list_directory: "List",
    search_files: "Search", grep: "Search", ripgrep: "Search",
    search_replace: "Edit", edit_file: "Edit", str_replace: "Edit",
    web_search: "Web search", search_web: "Web search",
    web_fetch: "Fetch", webfetch: "Fetch",
  };
  function toolName(call) {
    return call.tool || call.name || call.title || "";
  }
  function toolFilePath(call) {
    const r = call.rawInput || call.input || {};
    return r.target_file || r.filePath || r.file_path || r.path ||
      (Array.isArray(r.paths) ? r.paths[0] : "");
  }
  function prettyPath(p) {
    if (!p) return "";
    if (p === "." || p === "./") return "root folder";
    return p.split(/[\\/]/).pop() || p;
  }
  function categorize(call) {
    const n = String(toolName(call)).replace(/[\s-]+/g, "_").toLowerCase();
    if (call.kind === "read" || /^(read_file|file_read|list_dir|list_directory)$/.test(n)) return "explore";
    if (/^(web_search|search_web|web_fetch|webfetch)$/.test(n)) return "web";
    return "other";
  }
  function summarizeTools(calls) {
    let explore = 0, web = 0, other = 0;
    for (const c of calls) {
      const cat = categorize(c);
      if (cat === "explore") explore++;
      else if (cat === "web") web++;
      else other++;
    }
    const parts = [];
    if (explore) parts.push(`Explored ${explore} item${explore === 1 ? "" : "s"}`);
    if (web) parts.push("searched web");
    if (other) parts.push(`ran ${other} command${other === 1 ? "" : "s"}`);
    return parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Tool calls";
  }
  function inProgressLabel(call) {
    const name = String(toolName(call)).replace(/[\s-]+/g, "_").toLowerCase();
    const filePath = toolFilePath(call);
    if (/^(list_dir|list_directory)$/.test(name)) {
      return filePath ? `Listing ${prettyPath(filePath)}` : "Listing files";
    }
    if (/^(read_file|file_read)$/.test(name) || call.kind === "read") {
      return filePath ? `Reading ${prettyPath(filePath)}` : "Reading file";
    }
    if (/^(web_search|search_web)$/.test(name)) return "Searching web";
    if (/^(web_fetch|webfetch)$/.test(name)) return "Fetching page";
    if (/^(grep|ripgrep|search_files)$/.test(name)) return "Searching code";
    if (/^(write_file|file_write|write|edit_file|search_replace|str_replace)$/.test(name) || call.kind === "edit") {
      return filePath ? `Editing ${prettyPath(filePath)}` : "Editing file";
    }
    if (/^(bash|execute|run_command|run_terminal_command|shell|run_bash)$/.test(name) || call.kind === "execute") {
      return "Running command";
    }
    return name ? `Running ${name}` : "Running tool";
  }
  function toolLabel(call) {
    const name = String(toolName(call)).replace(/[\s-]+/g, "_").toLowerCase();
    const verb = TOOL_VERB[name] ||
      (call.kind === "read" ? "Read" : call.kind === "edit" ? "Edit" :
       call.kind === "execute" ? "Run" : null);
    const r = call.rawInput || call.input || {};
    const filePath = toolFilePath(call);
    const command = r.command || r.cmd;
    let target = "";
    if (filePath) {
      const base = prettyPath(filePath);
      const isRead = name === "read_file" || name === "file_read";
      if (isRead && r.offset != null && r.limit != null) {
        const end = Number(r.offset) + Number(r.limit) - 1;
        target = `${base} lines ${r.offset}-${end}`;
      } else {
        target = base;
      }
    } else if (command) {
      target = command.length > 40 ? command.slice(0, 40) + "…" : command;
    } else {
      const fallback = Object.values(r).find(
        (v) => typeof v === "string" && v.length > 0 && v.length < 120
      ) || "";
      target = fallback ? fallback.split(/[\\/]/).pop() || fallback : "";
    }
    if (verb && target) return `${verb} ${target}`;
    if (verb) return verb;
    return name || "tool";
  }
  function closeToolGroup() {
    if (!state.activeToolGroupEl) return;
    const el = state.activeToolGroupEl;
    const calls = el._calls || [];
    el.classList.remove("in-progress");
    const hdr = el.querySelector(".tool-group-header");
    const label = hdr && hdr.querySelector(".tool-group-label");
    if (label) label.textContent = calls.length === 1 ? toolLabel(calls[0]) : summarizeTools(calls);
    state.activeToolGroupEl = null;
  }
  function ensureToolGroup() {
    clearWelcome();
    hideGrokking();
    if (!state.activeToolGroupEl) {
      const el = document.createElement("div");
      el.className = "tool-group in-progress";
      el._calls = [];
      const hdr = document.createElement("div");
      hdr.className = "tool-group-header";
      const body = document.createElement("div");
      body.className = "tool-group-body";
      el.classList.add("expanded");
      el.appendChild(hdr);
      el.appendChild(body);
      messagesEl.appendChild(el);
      hdr.onclick = () => {
        const expanded = !body.hidden;
        body.hidden = expanded;
        el.classList.toggle("expanded", !expanded);
      };
      state.activeToolGroupEl = el;
    }
    return state.activeToolGroupEl;
  }
  function statusGlyph(status) {
    if (status === "done") return "✓";
    if (status === "error") return "×";
    return "";
  }
  function setToolItemStatus(item, status) {
    if (!item) return;
    item.classList.toggle("running", status === "running");
    item.classList.toggle("done", status === "done");
    item.classList.toggle("error", status === "error");
    const glyph = item.querySelector(".tool-item-status");
    if (glyph) glyph.textContent = statusGlyph(status);
  }
  function addToolDetail(item, text) {
    const value = String(text || "").trim();
    if (!item || !value) return;
    let detail = item.querySelector(".tool-item-output");
    if (!detail) {
      detail = document.createElement("pre");
      detail.className = "tool-item-output";
      item.appendChild(detail);
    }
    detail.textContent = value.length > 1200 ? value.slice(0, 1200) + "\n…" : value;
  }
  function addToToolGroup(call) {
    const el = ensureToolGroup();
    setTopStatus(topStatusForTool(call), "running");
    el._calls.push(call);
    const hdr = el.querySelector(".tool-group-header");
    const body = el.querySelector(".tool-group-body");
    const item = document.createElement("div");
    item.className = "tool-item running";
    const status = document.createElement("span");
    status.className = "tool-item-status";
    const label = document.createElement("span");
    label.className = "tool-item-label";
    label.textContent = toolLabel(call);
    item.appendChild(status);
    item.appendChild(label);
    body.appendChild(item);
    if (call.toolCallId) state.toolItemsByToolCallId.set(call.toolCallId, item);
    hdr.innerHTML =
      `<span class="tool-group-label">${escapeHtml(inProgressLabel(call))}</span>` +
      `<span class="tool-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>` +
      `<span class="tool-chevron" aria-hidden="true">›</span>`;
    scrollToBottom();
  }
  function updateToolGroupCall(call) {
    const item = state.toolItemsByToolCallId.get(call && call.toolCallId);
    if (!item) return false;
    const status = String(call.status || call.state || "").toLowerCase();
    setToolItemStatus(item, /fail|error|cancel|reject/.test(status) ? "error" :
      /complete|done|success|finished/.test(status) ? "done" : "running");
    if (/fail|error|cancel|reject/.test(status)) setTopStatus("Tool failed", "error");
    else if (!/complete|done|success|finished/.test(status)) setTopStatus(topStatusForTool(call), "running");
    const text = toolUpdateText(call);
    if (text) addToolDetail(item, text);
    return true;
  }
  function hostActivityLabel(activity) {
    const kind = String(activity.kind || "").toLowerCase();
    const title = String(activity.title || "");
    const detail = String(activity.detail || "");
    if (title) return title;
    if (kind === "read") return detail ? `Reading ${prettyPath(detail)}` : "Reading file";
    if (kind === "write") return detail ? `Writing ${prettyPath(detail)}` : "Writing file";
    if (kind === "terminal") return detail ? `Running ${truncate(detail, 80)}` : "Running command";
    if (kind === "terminal-output") return "Reading terminal output";
    if (kind === "terminal-wait") return "Waiting for command";
    return "Grok activity";
  }
  function addHostActivity(activity) {
    if (state.suppressReplayTurn || !activity) return;
    const el = ensureToolGroup();
    const body = el.querySelector(".tool-group-body");
    const id = activity.id || `${activity.kind || "activity"}-${Date.now()}-${state.activityRowsById.size}`;
    let item = state.activityRowsById.get(id);
    if (!item) {
      item = document.createElement("div");
      item.className = "tool-item running host-activity";
      const status = document.createElement("span");
      status.className = "tool-item-status";
      const label = document.createElement("span");
      label.className = "tool-item-label";
      item.appendChild(status);
      item.appendChild(label);
      body.appendChild(item);
      state.activityRowsById.set(id, item);
      el._calls.push({ kind: activity.kind || "activity", title: hostActivityLabel(activity), rawInput: { command: activity.detail } });
    }
    const phase = String(activity.phase || "start").toLowerCase();
    setTopStatus(hostActivityLabel(activity), phase === "error" ? "error" : "running");
    const label = item.querySelector(".tool-item-label");
    if (label) label.textContent = hostActivityLabel(activity);
    setToolItemStatus(item, phase === "error" ? "error" : phase === "complete" ? "done" : "running");
    if (activity.result || activity.error) addToolDetail(item, activity.error || activity.result);
    const hdr = el.querySelector(".tool-group-header");
    if (hdr) {
      hdr.innerHTML =
        `<span class="tool-group-label">${escapeHtml(hostActivityLabel(activity))}</span>` +
        `<span class="tool-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>` +
        `<span class="tool-chevron" aria-hidden="true">›</span>`;
    }
    scrollToBottom();
  }
  function attachDiffPreviewToToolItem(toolCallId, diff) {
    const item = state.toolItemsByToolCallId.get(toolCallId);
    if (!item || item.querySelector(".preview-link")) return;
    const oldLines = (diff.oldText || "").split("\n").length;
    const newLines = (diff.newText || "").split("\n").length;
    const sub = document.createElement("div");
    sub.className = "tool-item-subtitle";
    sub.textContent = `${oldLines} → ${newLines} lines`;
    item.appendChild(sub);
    const preview = document.createElement("button");
    preview.className = "preview-link";
    preview.textContent = "open diff preview →";
    preview.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({
        type: "openDiff",
        path: diff.path,
        oldText: diff.oldText,
        newText: diff.newText,
      });
    };
    item.appendChild(preview);
    scrollToBottom();
  }
  function addSessionContextBanner() {
    clearWelcome();
    const existing = document.getElementById("summarizing-indicator");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "session-context-banner";
    el.textContent = "Context from previous session applied";
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function addError(text) {
    clearWelcome();
    setTopStatus("Error", "error");
    const el = document.createElement("div");
    el.className = "msg error";
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function buildMediaActions(path) {
    const actions = document.createElement("div");
    actions.className = "generated-media-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "generated-media-btn";
    copyBtn.title = "Copy path";
    copyBtn.innerHTML = ICON.copy;
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(path).then(() => {
        copyBtn.innerHTML = ICON.check;
        copyBtn.classList.add("copied");
        setTimeout(() => { copyBtn.innerHTML = ICON.copy; copyBtn.classList.remove("copied"); }, 1500);
      });
    };
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "generated-media-btn";
    openBtn.title = "Open in VS Code";
    openBtn.innerHTML = ICON.file;
    openBtn.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "openFile", path });
    };
    actions.appendChild(copyBtn);
    actions.appendChild(openBtn);
    return actions;
  }
  function addGeneratedMedia(msg) {
    if (state.suppressReplayTurn) return;
    const isVideo = msg.media === "video";
    closeToolGroup();
    clearWelcome();
    hideGrokking();
    const el = document.createElement("div");
    el.className = "generated-image" + (isVideo ? " generated-video" : "");
    if (msg.src) {
      if (isVideo) {
        const video = document.createElement("video");
        video.src = msg.src;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        el.appendChild(video);
      } else {
        const img = document.createElement("img");
        img.src = msg.src;
        img.alt = "Generated image";
        img.loading = "lazy";
        if (msg.path) {
          img.title = "Open " + msg.path;
          img.style.cursor = "pointer";
          img.onclick = () => vscode.postMessage({ type: "openFile", path: msg.path });
        }
        el.appendChild(img);
      }
      if (msg.path) el.appendChild(buildMediaActions(msg.path));
    } else if (msg.url) {
      const link = document.createElement("button");
      link.className = "preview-link";
      link.textContent = isVideo ? "open generated video ↗" : "open generated image ↗";
      link.onclick = () => vscode.postMessage({ type: "openUrl", url: msg.url });
      el.appendChild(link);
    }
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function addSubagentCard(call) {
    closeToolGroup();
    clearWelcome();
    hideGrokking();
    const el = document.createElement("div");
    el.className = "subagent-card";
    const label = escapeHtml(subagentLabel(call));
    el.innerHTML =
      `<span class="subagent-badge">${ICON.listTree || "🤖"}</span>` +
      `<span class="subagent-label">Subagent: ${label}</span>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function addPlanNotice(text) {
    clearWelcome();
    hideGrokking();
    setTopStatus("Plan mode", "attention");
    const el = document.createElement("div");
    el.className = "plan-notice";
    el.innerHTML = `${ICON.listTree}<span>${escapeHtml(text)}</span>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function humanToolName(name) {
    const n = String(name || "").trim();
    const key = n.toLowerCase();
    const known = {
      list_dir: "List directory",
      grep: "Search text",
      glob: "Find files",
      read_file: "Read file",
      read_text_file: "Read file",
      write_file: "Write file",
      edit_file: "Edit file",
      bash: "Run shell",
      terminal: "Run shell",
      web_search: "Search web",
      web_fetch: "Open web",
    };
    if (known[key]) return known[key];
    return n.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Use tool";
  }
  function thoughtParamLabel(name) {
    const key = String(name || "").toLowerCase();
    if (key === "target_directory") return "dir";
    if (key === "target_file") return "file";
    if (key === "pattern") return "pattern";
    if (key === "command") return "cmd";
    if (key === "url") return "url";
    return key.replace(/[_-]+/g, " ") || "param";
  }
  function compactThoughtValue(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function parseThoughtMarkup(raw) {
    const text = String(raw || "");
    const queryMatch = /The user query is:\s*["“]([^"”]+)["”]/i.exec(text);
    const tools = [];
    const toolRe = /<tool_call\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/tool_call>|$)/gi;
    let m;
    while ((m = toolRe.exec(text))) {
      const params = [];
      const paramRe = /<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/parameter>|$)/gi;
      let p;
      while ((p = paramRe.exec(m[2] || ""))) {
        const value = compactThoughtValue(p[2]);
        if (value) params.push({ name: p[1], value });
      }
      tools.push({ name: m[1], params });
    }
    const notes = text
      .replace(/The user query is:\s*["“][^"”]+["”]\.?/i, " ")
      .replace(toolRe, " ")
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { query: queryMatch?.[1], tools, notes };
  }
  function renderThoughtBody(raw) {
    if (!state.activeThoughtEl) return;
    const parsed = parseThoughtMarkup(raw);
    const hasStructure = !!parsed.query || parsed.tools.length > 0;
    state.activeThoughtEl.replaceChildren();
    if (!hasStructure) {
      const plain = document.createElement("div");
      plain.className = "thinking-prose";
      plain.textContent = raw;
      state.activeThoughtEl.appendChild(plain);
      return;
    }
    if (parsed.query) {
      const query = document.createElement("div");
      query.className = "thinking-query";
      query.innerHTML =
        `<span class="thinking-query-label">Request</span>` +
        `<span class="thinking-query-text">${escapeHtml(parsed.query)}</span>`;
      state.activeThoughtEl.appendChild(query);
    }
    if (parsed.tools.length) {
      const list = document.createElement("div");
      list.className = "thinking-steps";
      parsed.tools.forEach((tool, i) => {
        const row = document.createElement("div");
        row.className = "thinking-step";
        const detail = tool.params
          .slice(0, 3)
          .map((p) => `${thoughtParamLabel(p.name)}: ${p.value}`)
          .join(" · ");
        row.innerHTML =
          `<span class="thinking-step-index">${i + 1}</span>` +
          `<span class="thinking-step-main">` +
            `<span class="thinking-step-title">${escapeHtml(humanToolName(tool.name))}</span>` +
            (detail ? `<span class="thinking-step-detail">${escapeHtml(detail)}</span>` : "") +
          `</span>`;
        list.appendChild(row);
      });
      state.activeThoughtEl.appendChild(list);
    }
    if (parsed.notes) {
      const notes = document.createElement("div");
      notes.className = "thinking-prose";
      notes.textContent = parsed.notes;
      state.activeThoughtEl.appendChild(notes);
    }
  }
  function appendThought(text) {
    if (state.suppressReplayTurn) return;
    setTopStatus("Thinking", "running");
    hidePlanProcessing();
    hideGrokking();
    state.activeUserEl = null;
    state.skipUserBubble = false;
    clearWelcome();
    if (!state.activeThoughtEl) {
      if (!state.thoughtStartTime) state.thoughtStartTime = Date.now();
      state.thoughtBuffer = "";
      const el = document.createElement("div");
      el.className = "msg thinking";
      const hdr = document.createElement("div");
      hdr.className = "thinking-header";
      hdr.innerHTML = `<span class="thinking-chevron">▼</span><span class="thinking-label loading-dots">Thinking</span>`;
      const body = document.createElement("div");
      body.className = "thinking-body";
      hdr.onclick = () => {
        const open = body.hidden;
        body.hidden = !open;
        hdr.querySelector(".thinking-chevron").textContent = open ? "▼" : "▶";
      };
      el.appendChild(hdr);
      el.appendChild(body);
      messagesEl.appendChild(el);
      state.activeThoughtEl = body;
      state.activeThoughtHdrEl = hdr;
    }
    state.thoughtBuffer += text;
    renderThoughtBody(state.thoughtBuffer);
    if (!state.thoughtRenderScheduled) {
      state.thoughtRenderScheduled = true;
      requestAnimationFrame(flushThought);
    }
  }
  function flushThought() {
    state.thoughtRenderScheduled = false;
    if (!state.activeThoughtEl) return;
    renderThoughtBody(state.thoughtBuffer);
    scrollToBottom();
  }
  function appendAgent(text) {
    if (state.suppressReplayTurn) return;
    setTopStatus("Responding", "running");
    hidePlanProcessing();
    hideGrokking();
    state.activeUserEl = null;
    state.skipUserBubble = false;
    closeToolGroup();
    clearWelcome();
    if (!state.activeAgentEl) {
      state.activeAgentEl = addMessage("agent", "");
      state.activeAgentRaw = "";
    }
    state.activeAgentRaw += text;
    if (!state.agentRenderScheduled) {
      state.agentRenderScheduled = true;
      requestAnimationFrame(flushAgent);
    }
  }
  function flushAgent() {
    state.agentRenderScheduled = false;
    if (!state.activeAgentEl) return;
    state.activeAgentEl.innerHTML = renderMarkdown(state.activeAgentRaw);
    renderMermaidIn(state.activeAgentEl);
    const wrapper = state.activeAgentEl.parentElement;
    if (wrapper) wrapper._copyText = state.activeAgentRaw;
    scrollToBottom();
  }
  function commitAgentTurn() {
    flushAgent();
    flushThought();
    if (state.thoughtStartTime && state.activeThoughtHdrEl) {
      const label = state.activeThoughtHdrEl.querySelector(".thinking-label");
      if (label) {
        label.classList.remove("loading-dots");
        label.textContent = state.replaying
          ? "Thought"
          : `Thought for ${Math.round((Date.now() - state.thoughtStartTime) / 1000)}s`;
      }
      state.thoughtStartTime = null;
    }
    closeToolGroup();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
  }
  function appendUserChunk(text) {
    if (!state.replaying) return;
    if (state.activeAgentEl || state.activeThoughtEl || state.activeToolGroupEl) {
      commitAgentTurn();
    }
    clearWelcome();
    if (!state.activeUserEl && !state.skipUserBubble) {
      if (state.replaying && PRIMER_PATTERN.test(text)) {
        state.suppressReplayTurn = true;
        return;
      }
      state.suppressReplayTurn = false;
      drainPlanHistory(state.userMsgCount);
      if (state.replaying) {
        const mk = stripPlanMarker(text);
        if (mk.matched) {
          if (!mk.rest.trim()) {
            state.skipUserBubble = true;
            return;
          }
          text = mk.rest;
        }
      }
      state.userMsgCount += 1;
      state.activeUserEl = addMessage("user", "");
      state.activeUserRaw = "";
    }
    if (state.skipUserBubble) return;
    if (state.suppressReplayTurn) return;
    state.activeUserRaw += text;
    state.activeUserEl.innerHTML = renderMarkdown(state.activeUserRaw);
    scrollToBottom();
  }
  function drainPlanHistory(cutoff) {
    if (!state.planHistoryQueue.length) return;
    state.planHistoryQueue = state.planHistoryQueue.filter((p) => {
      if (typeof p.afterUserMessage === "number" && p.afterUserMessage <= cutoff) {
        addPlanHistoryCard(p.text, p.verdict, p.planPath, p.planName);
        return false;
      }
      return true;
    });
  }
  function flushPlanHistory() {
    if (!state.planHistoryQueue.length) return;
    for (const p of state.planHistoryQueue) addPlanHistoryCard(p.text, p.verdict, p.planPath, p.planName);
    state.planHistoryQueue = [];
  }
  function showPlanProcessing() {
    hidePlanProcessing();
    hideGrokking();
    clearWelcome();
    setTopStatus("Processing plan", "running");
    const el = document.createElement("div");
    el.className = "plan-processing";
    el.innerHTML = '<span class="plan-processing-dots"><span></span><span></span><span></span></span>';
    el.setAttribute("aria-label", "Grok is processing");
    messagesEl.appendChild(el);
    state.planProcessingEl = el;
    scrollToBottom();
  }
  function hidePlanProcessing() {
    if (state.planProcessingEl && state.planProcessingEl.parentElement) {
      state.planProcessingEl.parentElement.removeChild(state.planProcessingEl);
    }
    state.planProcessingEl = null;
  }
  function showGrokking() {
    hideGrokking();
    hidePlanProcessing();
    clearWelcome();
    setTopStatus("Thinking", "running");
    const el = document.createElement("div");
    el.className = "grokking";
    el.innerHTML =
      '<span class="grokking-status" aria-hidden="true"></span>' +
      '<span class="grokking-label loading-dots">Grokking</span>' +
      '<span class="grokking-detail">Waiting for Grok CLI activity</span>';
    el.setAttribute("aria-label", "Grok is working");
    messagesEl.appendChild(el);
    state.grokkingEl = el;
    scrollToBottom();
  }
  function hideGrokking() {
    if (state.grokkingEl && state.grokkingEl.parentElement) {
      state.grokkingEl.parentElement.removeChild(state.grokkingEl);
    }
    state.grokkingEl = null;
  }
  function scrollToBottom() {
    if (state.stickToBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function forceScrollToBottom() {
    state.stickToBottom = true;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  messagesEl.addEventListener("scroll", () => {
    state.stickToBottom = shouldStickToBottom(
      messagesEl.scrollTop, messagesEl.scrollHeight, messagesEl.clientHeight);
  });
  function addPermissionCard(req) {
    clearWelcome();
    hideGrokking();
    setTopStatus("Needs approval", "attention");
    const el = document.createElement("div");
    el.className = "card permission";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = req.toolCall?.title || `permission: ${req.toolCall?.kind || "tool"}`;
    el.appendChild(title);
    const diff = state.pendingDiffByToolCallId.get(req.toolCall?.toolCallId);
    if (diff) {
      const subtitle = document.createElement("div");
      subtitle.className = "card-subtitle";
      const oldLines = (diff.oldText || "").split("\n").length;
      const newLines = (diff.newText || "").split("\n").length;
      subtitle.textContent = `${diff.path} — ${oldLines} → ${newLines} lines`;
      el.appendChild(subtitle);
      const preview = document.createElement("button");
      preview.className = "preview-link";
      preview.textContent = "open diff preview →";
      preview.onclick = () =>
        vscode.postMessage({
          type: "openDiff",
          path: diff.path,
          oldText: diff.oldText,
          newText: diff.newText,
        });
      el.appendChild(preview);
    }
    const actions = document.createElement("div");
    actions.className = "card-actions";
    for (const opt of req.options || []) {
      const btn = document.createElement("button");
      btn.textContent = opt.name;
      if (opt.kind === "allow_once") btn.classList.add("primary");
      if (opt.kind === "reject_once") btn.classList.add("danger");
      btn.onclick = () => {
        vscode.postMessage({
          type: "permissionAnswer",
          requestId: req.id,
          optionId: opt.optionId,
        });
        el.classList.add("resolved");
        for (const b of actions.querySelectorAll("button")) b.disabled = true;
        const chosen = document.createElement("div");
        chosen.className = "card-subtitle";
        chosen.textContent = `you chose: ${opt.name}`;
        el.appendChild(chosen);
      };
      actions.appendChild(btn);
    }
    el.appendChild(actions);
    messagesEl.appendChild(el);
    forceScrollToBottom();
  }
  function buildQuestionHead(el, headingText) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = headingText;
    el.appendChild(title);
    return title;
  }
  function answerLineEl(labels) {
    const ans = document.createElement("div");
    ans.className = "question-answer";
    ans.textContent = labels ? "✓ " + labels : "(skipped)";
    return ans;
  }
  function addQuestionCard(req) {
    clearWelcome();
    hideGrokking();
    setTopStatus("Needs answer", "attention");
    const questions = Array.isArray(req.questions) ? req.questions : [];
    const el = document.createElement("div");
    el.className = "card question";
    const title = buildQuestionHead(el, "Grok is asking");
    const selections = questions.map(() => []);
    const oneClick = questions.length === 1 && !questions[0].multiSelect;
    let submitBtn;
    let skip;
    const collapse = (skipped) => {
      el.classList.add("resolved");
      title.textContent = skipped ? "Skipped" : "You answered";
      const actions = el.querySelector(".card-actions");
      if (actions) actions.remove();
      if (skip) skip.remove();
      [...el.querySelectorAll(".question-block")].forEach((block, qi) => {
        const opts = block.querySelector(".question-options");
        if (opts) opts.remove();
        block.appendChild(answerLineEl(skipped ? "" : (selections[qi] || []).join(", ")));
      });
    };
    const submit = () => {
      const { answers } = buildQuestionAnswers(questions, selections);
      vscode.postMessage({ type: "questionAnswer", requestId: req.id, answers, annotations: {} });
      collapse(false);
    };
    questions.forEach((q, qi) => {
      const block = document.createElement("div");
      block.className = "question-block";
      const qText = document.createElement("div");
      qText.className = "question-text";
      qText.textContent = questionText(q);
      block.appendChild(qText);
      const opts = document.createElement("div");
      opts.className = "question-options";
      for (const opt of q.options || []) {
        const btn = document.createElement("button");
        btn.className = "question-option";
        const lbl = document.createElement("span");
        lbl.className = "question-option-label";
        lbl.textContent = opt.label || "";
        btn.appendChild(lbl);
        if (opt.description) {
          const desc = document.createElement("span");
          desc.className = "question-option-desc";
          desc.textContent = opt.description;
          btn.appendChild(desc);
        }
        btn.onclick = () => {
          if (oneClick) {
            selections[qi] = [opt.label];
            submit();
            return;
          }
          if (q.multiSelect) {
            const i = selections[qi].indexOf(opt.label);
            if (i >= 0) { selections[qi].splice(i, 1); btn.classList.remove("selected"); }
            else { selections[qi].push(opt.label); btn.classList.add("selected"); }
          } else {
            selections[qi] = [opt.label];
            for (const sib of opts.querySelectorAll(".question-option")) sib.classList.remove("selected");
            btn.classList.add("selected");
          }
          if (submitBtn) {
            submitBtn.disabled = !buildQuestionAnswers(questions, selections).allAnswered;
          }
        };
        opts.appendChild(btn);
      }
      block.appendChild(opts);
      el.appendChild(block);
    });
    if (!oneClick) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      submitBtn = document.createElement("button");
      submitBtn.className = "primary";
      submitBtn.textContent = "Submit";
      submitBtn.disabled = true;
      submitBtn.onclick = submit;
      actions.appendChild(submitBtn);
      el.appendChild(actions);
    }
    skip = document.createElement("button");
    skip.className = "question-skip";
    skip.textContent = "Skip";
    skip.onclick = () => {
      vscode.postMessage({ type: "questionCancel", requestId: req.id });
      collapse(true);
    };
    el.appendChild(skip);
    messagesEl.appendChild(el);
    forceScrollToBottom();
  }
  function toolUpdateText(call) {
    const c = call && call.content;
    if (Array.isArray(c)) {
      for (const item of c) {
        const t = (item && item.content && item.content.text) ?? (item && item.text);
        if (typeof t === "string") return t;
      }
    }
    return "";
  }
  function isQuestionToolTitle(title) {
    const t = String(title || "").replace(/[_\s]/g, "").toLowerCase();
    return t === "askuserquestion" || t === "askquestion";
  }
  function questionsFromCall(call) {
    const q = call && call.rawInput && call.rawInput.questions;
    if (Array.isArray(q) && q.length) return q;
    const title = String((call && call.title) || "");
    if (/^ask[:\s]/i.test(title)) return [{ question: title.replace(/^ask[:\s]+/i, "").trim() }];
    return null;
  }
  function isQuestionTool(call) {
    return isQuestionToolTitle(call && call.title) || questionsFromCall(call) != null;
  }
  function questionText(q) {
    return (q && (q.question || q.prompt)) || "";
  }
  function restoredLabelsByQuestion(questions, answerText) {
    const text = String(answerText || "");
    const out = questions.map(() => "");
    let m, matched = false;
    const reA = /"([^"]+)"\s*=\s*"([^"]*)"/g;
    while ((m = reA.exec(text))) {
      const qi = questions.findIndex((q) => questionText(q) === m[1]);
      if (qi >= 0) { out[qi] = m[2]; matched = true; }
    }
    if (matched) return out;
    const reB = /Question\s+([^\s:]+)\s*:\s*Selected option\(s\)\s*([^\n]*)/gi;
    while ((m = reB.exec(text))) {
      const qid = m[1].trim();
      const qi = questions.findIndex((q) => String(q && q.id) === qid);
      if (qi < 0) continue;
      const opts = questions[qi].options || [];
      out[qi] = m[2].split(",").map((s) => s.trim()).filter(Boolean).map((id) => {
        const o = opts.find((x) => String(x && x.id) === id || (x && x.label) === id);
        return o ? o.label : id;
      }).join(", ");
    }
    return out;
  }
  function cleanAnswerText(text) {
    return String(text || "")
      .replace(/^User has answered your questions:\s*/i, "")
      .replace(/^User questions responses:\s*/i, "")
      .replace(/\s*You can now continue.*$/is, "")
      .trim();
  }
  function addRestoredQuestionCard(questions, answerText) {
    clearWelcome();
    const qs = Array.isArray(questions) ? questions : [];
    const el = document.createElement("div");
    el.className = "card question resolved";
    el._questions = qs;
    buildQuestionHead(el, "You answered");
    qs.forEach((q) => {
      const block = document.createElement("div");
      block.className = "question-block";
      const qText = document.createElement("div");
      qText.className = "question-text";
      qText.textContent = questionText(q);
      block.appendChild(qText);
      el.appendChild(block);
    });
    messagesEl.appendChild(el);
    if (answerText) fillRestoredAnswer(el, answerText);
    scrollToBottom();
    return el;
  }
  function fillRestoredAnswer(el, answerText) {
    if (!el || el._answered || !answerText) return;
    const qs = el._questions || [];
    const labels = restoredLabelsByQuestion(qs, answerText);
    const anyLabel = labels.some((l) => l);
    if (qs.length && anyLabel) {
      [...el.querySelectorAll(".question-block")].forEach((block, qi) => {
        if (!block.querySelector(".question-answer")) block.appendChild(answerLineEl(labels[qi]));
      });
    } else {
      const clean = cleanAnswerText(answerText);
      if (clean) el.appendChild(answerLineEl(clean));
    }
    el._answered = true;
  }
  const VERDICT_LABEL = {
    approved: "Approved",
    rejected: "Rejected",
    abandoned: "Cancelled",
  };
  function pathBaseName(p) {
    return String(p || "").split(/[\\/]/).filter(Boolean).pop() || "plan.md";
  }
  function addPlanFileLink(el, planPath, planName) {
    if (!planPath) return;
    const planTools = document.createElement("div");
    planTools.className = "plan-tools";
    const link = document.createElement("a");
    link.className = "file-ref-link plan-file-link";
    link.href = planPath;
    link.title = planPath;
    const code = document.createElement("code");
    code.textContent = planName || pathBaseName(planPath);
    link.appendChild(code);
    planTools.appendChild(link);
    el.appendChild(planTools);
  }
  function addPlanCard(req) {
    clearWelcome();
    hideGrokking();
    setTopStatus("Review plan", "attention");
    commitAgentTurn();
    const el = document.createElement("div");
    el.className = "card plan";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = "Plan ready for review";
    el.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    sub.textContent = "Nothing has been written yet. Approve, reject with feedback, or cancel to leave plan mode.";
    el.appendChild(sub);
    const planText = req.plan || "";
    addPlanFileLink(el, req.planPath, req.planName);
    const body = document.createElement("div");
    body.className = "plan-body";
    body.innerHTML = planText ? renderMarkdown(planText) : "(empty plan)";
    renderMermaidIn(body);
    el.appendChild(body);
    const feedback = document.createElement("textarea");
    feedback.className = "plan-feedback";
    feedback.rows = 2;
    feedback.placeholder = "Optional comment — Grok decides what to do with it";
    el.appendChild(feedback);
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const mk = (label, cls, verdict, withComment) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.classList.add(cls);
      b.dataset.verdict = verdict;
      b.onclick = () => {
        const comment = withComment ? feedback.value.trim() : "";
        vscode.postMessage({
          type: "exitPlanAnswer",
          requestId: req.id,
          verdict,
          ...(comment ? { comment } : {}),
        });
        el.classList.add("resolved");
        actions.remove();
        feedback.remove();
        const status = document.createElement("div");
        status.className = "plan-verdict-label plan-verdict-" + verdict;
        status.textContent = VERDICT_LABEL[verdict] ?? "Resolved";
        el.appendChild(status);
      };
      return b;
    };
    actions.appendChild(mk("Approve & implement", "primary", "approved", true));
    actions.appendChild(mk("Reject", "", "rejected", true));
    actions.appendChild(mk("Cancel", "secondary", "abandoned", true));
    el.appendChild(actions);
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function addPlanHistoryCard(text, verdict, planPath, planName) {
    clearWelcome();
    const el = document.createElement("div");
    el.className = "card plan plan-history";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = "Plan from this session";
    el.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "card-subtitle";
    const verdictLabel = VERDICT_LABEL[verdict];
    sub.textContent = verdictLabel
      ? `Restored from the previous session — you ${verdictLabel.toLowerCase()} this plan.`
      : "Restored from the previous session.";
    el.appendChild(sub);
    addPlanFileLink(el, planPath, planName);
    const body = document.createElement("div");
    body.className = "plan-body";
    body.innerHTML = text ? renderMarkdown(text) : "(empty plan)";
    renderMermaidIn(body);
    el.appendChild(body);
    if (verdictLabel) {
      const status = document.createElement("div");
      status.className = "plan-verdict-label plan-verdict-" + verdict;
      status.textContent = verdictLabel;
      el.appendChild(status);
    }
    messagesEl.appendChild(el);
    scrollToBottom();
  }
  function renderChips() {
    chipsEl.innerHTML = "";
    if (attachEl) attachEl.innerHTML = "";
    let imageCount = 0;
    for (const chip of state.chips) {
      const fileName = (chip.relPath.split(/[\\/]/).pop() || chip.relPath);
      const isImg = !!(chip.dataUrl || chip.imageData || (chip.imageMime && chip.imageMime.startsWith("image/")) || /\.(png|jpe?g|gif|webp|svg)$/i.test(chip.relPath));
      const src = chip.dataUrl || (chip.imageData && chip.imageMime ? `data:${chip.imageMime};base64,${chip.imageData}` : "");
      if (isImg && src && attachEl) {
        imageCount++;
        const card = document.createElement("div");
        card.className = "attach-card" + (chip.hidden ? " is-hidden" : "");
        card.title = chip.path || chip.relPath;
        const img = document.createElement("img");
        img.className = "attach-card-thumb";
        img.src = src;
        img.alt = fileName;
        const meta = document.createElement("div");
        meta.className = "attach-card-meta";
        const name = document.createElement("span");
        name.className = "attach-card-name";
        name.textContent = truncate(fileName, 22);
        const dims = document.createElement("span");
        dims.className = "attach-card-dims";
        img.onload = () => { if (img.naturalWidth) dims.textContent = img.naturalWidth + "×" + img.naturalHeight; };
        meta.appendChild(name);
        meta.appendChild(dims);
        const remove = document.createElement("button");
        remove.className = "attach-card-remove";
        remove.type = "button";
        remove.title = "Remove image";
        remove.setAttribute("aria-label", "Remove image");
        remove.innerHTML = ICON.x;
        remove.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: "removeChip", id: chip.id }); };
        card.appendChild(img);
        card.appendChild(meta);
        card.appendChild(remove);
        attachEl.appendChild(card);
      } else {
        const el = document.createElement("div");
        el.className = "chip" + (chip.hidden ? " chip-hidden" : "");
        el.title = chip.path || chip.relPath;
        el.innerHTML = (chip.hidden ? ICON.eyeOff : ICON.file) +
          `<span>${truncate(fileName, 10)}</span>`;
        el.onclick = () => vscode.postMessage({ type: "toggleChip", id: chip.id });
        chipsEl.appendChild(el);
      }
    }
    if (attachEl) attachEl.hidden = imageCount === 0;
  }
  function updateDonut(used) {
    const max = state.contextWindow;
    const pct = Math.min(100, Math.round((used / max) * 100));
    const circumference = 2 * Math.PI * 5;
    const arc = (pct / 100) * circumference;
    donutArc.setAttribute("stroke-dasharray", `${arc} ${circumference}`);
    donutArc.setAttribute("stroke", "var(--sg-accent)");
    donutLabel.textContent = "";
    const remPct = 100 - pct;
    const summary = `${remPct}% context left · ${used.toLocaleString()} / ${max.toLocaleString()} tokens used`;
    if (donut) donut.setAttribute("aria-label", summary);
    if (donutTip) {
      donutTip.innerHTML =
        `<span class="donut-tip-main">${remPct}% context left</span>` +
        `<span class="donut-tip-sub">${used.toLocaleString()} / ${max.toLocaleString()} tokens used</span>`;
    }
  }
  function slashCommandName(cmd) {
    const raw = typeof cmd === "string" ? cmd : (cmd && (cmd.name || cmd.command || cmd.id));
    return String(raw || "").trim().replace(/^\/+/, "");
  }
  function slashCommandDescription(cmd) {
    if (typeof cmd === "string") return "";
    return String((cmd && (cmd.description || cmd.desc || cmd.summary)) || "").trim();
  }
  function localSlashCommands() {
    const settingsLocked = !!state.busy;
    const currentModel = modelDisplayName(state.currentModelId, state.availableModels) || "Grok CLI Copilot";
    const currentEffort = state.effort || "minimal";
    return [
      {
        name: "switch-model",
        label: "Switch model...",
        description: `Current model: ${currentModel}`,
        group: "Model",
        action: "model",
        disabled: settingsLocked,
      },
      {
        name: "effort",
        label: `Effort (${effortLabel(currentEffort)})`,
        description: EFFORT_TOOLTIPS[currentEffort] || "Set reasoning effort",
        group: "Model",
        action: "effortSlider",
        level: currentEffort,
        disabled: settingsLocked,
      },
      {
        name: "thinking",
        label: "Thinking",
        description: "Show Grok's reasoning trace blocks in the conversation",
        group: "Model",
        action: "toggle",
        key: "showThinking",
        checked: state.showThinking,
      },
      {
        name: "always-approve",
        label: "Always approve",
        description: "Auto-approve every permission request (YOLO mode)",
        group: "Model",
        action: "toggle",
        key: "alwaysApprove",
        checked: state.currentModeId === "yolo",
      },
      {
        name: "config-debug",
        label: "Config & debug",
        description: "Open config files, MCP servers, and extension logs",
        group: "Settings",
        action: "config",
      },
      {
        name: "log-out",
        label: "Log out",
        description: "Sign out of the Grok CLI Copilot session",
        group: "Settings",
        action: "logout",
      },
    ];
  }
  function titleCaseWords(value) {
    return String(value || "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function slashCommandGroup(cmd) {
    const explicit = typeof cmd === "string" ? "" : (cmd && (cmd.group || cmd.category || cmd.section));
    if (explicit) return titleCaseWords(explicit);
    const name = slashCommandName(cmd).toLowerCase();
    if (/^(fork|resume|rewind|clear|new|session|sessions|history)\b/.test(name)) return "Session";
    if (/^(attach|file|files|mention|context|add|workspace|cwd)\b/.test(name)) return "Context";
    if (/^(compact|memory|dream|flush)\b/.test(name)) return "Memory";
    if (/^(model|effort|thinking)\b/.test(name)) return "Model";
    if (/^(mcp|tool|tools|server|servers)\b/.test(name)) return "Tools";
    return "Commands";
  }
  function normalizeSlashCommand(cmd) {
    const name = slashCommandName(cmd);
    if (!name) return null;
    return {
      raw: cmd,
      name,
      label: typeof cmd === "string" ? "" : String((cmd && cmd.label) || ""),
      description: slashCommandDescription(cmd),
      group: slashCommandGroup(cmd),
      action: typeof cmd === "string" ? "" : (cmd && cmd.action),
      level: typeof cmd === "string" ? "" : (cmd && cmd.level),
      key: typeof cmd === "string" ? "" : (cmd && cmd.key),
      url: typeof cmd === "string" ? "" : (cmd && cmd.url),
      checked: typeof cmd !== "string" && !!(cmd && cmd.checked),
      active: typeof cmd !== "string" && !!(cmd && cmd.active),
      disabled: typeof cmd !== "string" && !!(cmd && cmd.disabled),
    };
  }
  function allSlashCommands() {
    const cliCommands = Array.isArray(state.commands) && state.commands.length
      ? state.commands
      : DEFAULT_SLASH_COMMANDS;
    const locals = localSlashCommands();
    const localNames = new Set(locals.map((c) => slashCommandName(c).toLowerCase()));
    const source = [...locals, ...cliCommands];
    const seen = new Set();
    const groups = new Map();
    for (const item of source) {
      const cmd = normalizeSlashCommand(item);
      if (!cmd) continue;
      // A local command (e.g. the Always-approve toggle) overrides the CLI's
      // plain command of the same name, so we don't list both.
      if (!cmd.action && localNames.has(cmd.name.toLowerCase())) continue;
      const key = `${cmd.action ? "local" : "cli"}:${cmd.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!groups.has(cmd.group)) groups.set(cmd.group, []);
      groups.get(cmd.group).push(cmd);
    }
    const ordered = [];
    for (const group of SLASH_GROUP_ORDER) {
      const items = groups.get(group);
      if (items) ordered.push(...items);
      groups.delete(group);
    }
    for (const items of groups.values()) ordered.push(...items);
    return ordered;
  }
  function slashCommandDisplay(cmd) {
    return cmd.label || `/${cmd.name}`;
  }
  function slashQueryAtCursor() {
    return (input.value.slice(0, input.selectionStart || 0)).match(/(?:^|\n)\/(\S*)$/);
  }
  function showSlashCommands(query) {
    state.slashSearch = String(query || "");
    const q = String(query || "").toLowerCase();
    state.slashFiltered = allSlashCommands().filter((cmd) => {
      if (!q) return true;
      return cmd.name.toLowerCase().startsWith(q) ||
        (cmd.label && cmd.label.toLowerCase().includes(q)) ||
        (cmd.description && cmd.description.toLowerCase().includes(q));
    });
    state.slashActive = 0;
    renderSlash();
    slashPopover.hidden = false;
  }
  function updateSlash() {
    const m = slashQueryAtCursor();
    if (!m) { slashPopover.hidden = true; state.slashFiltered = []; return; }
    showSlashCommands(m[1]);
  }
  function openSlashPopover() {
    if (!slashPopover.hidden) { closePopovers(); return; }
    closePopovers();
    if (!slashQueryAtCursor()) {
      const needsBreak = input.value && !input.value.endsWith("\n");
      input.value += `${needsBreak ? "\n" : ""}/`;
      input.selectionStart = input.selectionEnd = input.value.length;
      renderInputHighlight();
    }
    const m = slashQueryAtCursor();
    showSlashCommands(m ? m[1] : "");
    const search = slashPopover.querySelector(".slash-search");
    if (search) setTimeout(() => search.focus(), 0);
  }
  function ensureSlashShell() {
    if (slashPopover.querySelector(".slash-list")) return;
    slashPopover.innerHTML =
      `<div class="context-search-wrap"><span class="context-search-icon">${ICON.search}</span>` +
      `<input type="text" class="context-search slash-search" placeholder="Search commands…" spellcheck="false" /></div>` +
      `<div class="slash-list"></div>`;
    const search = slashPopover.querySelector(".slash-search");
    search.addEventListener("input", () => {
      setComposerSlashQuery(search.value);
      showSlashCommands(search.value);
    });
    search.addEventListener("keydown", onSlashSearchKeydown);
  }
  function setComposerSlashQuery(value) {
    const v = String(value || "");
    if (/(?:^|\n)\/(\S*)$/.test(input.value)) {
      input.value = input.value.replace(/(?:^|\n)\/(\S*)$/, (full) => (full.startsWith("\n") ? "\n/" : "/") + v);
    } else {
      const needsBreak = input.value && !input.value.endsWith("\n");
      input.value += `${needsBreak ? "\n" : ""}/` + v;
    }
    input.selectionStart = input.selectionEnd = input.value.length;
    renderInputHighlight();
  }
  function onSlashSearchKeydown(e) {
    const n = state.slashFiltered.length;
    if (e.key === "Escape") { e.preventDefault(); closePopovers(); input.focus(); return; }
    if (!n) return;
    if (e.key === "ArrowDown") { e.preventDefault(); state.slashActive = (state.slashActive + 1) % n; renderSlash(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); state.slashActive = (state.slashActive - 1 + n) % n; renderSlash(); }
    else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pickSlash(state.slashFiltered[state.slashActive]); }
  }
  function renderSlash() {
    ensureSlashShell();
    const search = slashPopover.querySelector(".slash-search");
    if (search && document.activeElement !== search) search.value = state.slashSearch || "";
    const listEl = slashPopover.querySelector(".slash-list");
    listEl.innerHTML = "";
    if (!state.slashFiltered.length) {
      const empty = document.createElement("div");
      empty.className = "slash-empty";
      empty.textContent = "No matching Grok commands";
      listEl.appendChild(empty);
      return;
    }
    let activeEl = null;
    let lastGroup = "";
    state.slashFiltered.forEach((cmd, i) => {
      if (cmd.group !== lastGroup) {
        const section = document.createElement("div");
        section.className = "slash-section-title";
        section.textContent = cmd.group;
        listEl.appendChild(section);
        lastGroup = cmd.group;
      }
      const el = document.createElement("div");
      el.className = `slash-item${i === state.slashActive ? " active" : ""}${cmd.active ? " selected" : ""}${cmd.disabled ? " disabled" : ""}`;
      if (i === state.slashActive) activeEl = el;
      const line = document.createElement("div");
      line.className = "slash-line";
      const name = document.createElement("div");
      name.className = "slash-name";
      name.textContent = slashCommandDisplay(cmd);
      line.appendChild(name);
      const trailing = document.createElement("div");
      trailing.className = "slash-trailing";
      if (cmd.action === "effortSlider") {
        const value = cmd.level || "minimal";
        const effortControl = document.createElement("div");
        effortControl.className = "slash-effort-control";
        effortControl.title = cmd.description || "Set reasoning effort";
        const slider = document.createElement("input");
        slider.className = "slash-effort-slider";
        slider.type = "range";
        slider.min = "0";
        slider.max = String(EFFORT_LEVELS.length - 1);
        slider.step = "1";
        slider.value = String(effortIndex(value));
        slider.disabled = !!cmd.disabled;
        slider.title = cmd.description || "Set reasoning effort";
        slider.setAttribute("aria-label", "Reasoning effort");
        const dots = document.createElement("div");
        dots.className = "slash-effort-dots";
        const paint = (idx) => {
          const level = EFFORT_LEVELS[idx] || "minimal";
          name.textContent = `Effort (${effortLabel(level)})`;
          slider.title = EFFORT_TOOLTIPS[level] || `Set reasoning effort to ${effortLabel(level)}`;
          const pct = EFFORT_LEVELS.length <= 1 ? 0 : (idx / (EFFORT_LEVELS.length - 1)) * 100;
          slider.style.setProperty("--effort-pct", `${pct}%`);
          Array.from(dots.children).forEach((tick, iTick) => {
            tick.classList.toggle("active", iTick === idx);
          });
        };
        for (const level of EFFORT_LEVELS) {
          const tick = document.createElement("span");
          tick.title = EFFORT_TOOLTIPS[level] || effortLabel(level);
          dots.appendChild(tick);
        }
        paint(Number(slider.value));
        slider.oninput = (e) => {
          e.stopPropagation();
          paint(Number(slider.value));
        };
        slider.onchange = (e) => {
          e.stopPropagation();
          if (cmd.disabled) return;
          const level = EFFORT_LEVELS[Number(slider.value)] || "minimal";
          if (level === state.effort) return;
          state.effort = level;
          vscode.postMessage({ type: "setEffort", level });
          showSlashCommands((slashQueryAtCursor() || [null, ""])[1] || "");
        };
        slider.onclick = (e) => e.stopPropagation();
        effortControl.appendChild(slider);
        effortControl.appendChild(dots);
        trailing.appendChild(effortControl);
        el.classList.add("slash-item-control");
        line.appendChild(trailing);
        el.appendChild(line);
        el.onclick = (e) => e.stopPropagation();
        listEl.appendChild(el);
        return;
      }
      if (cmd.active) {
        const check = document.createElement("span");
        check.className = "slash-check";
        check.textContent = "✓";
        trailing.appendChild(check);
      }
      if (cmd.description) {
        const info = document.createElement("button");
        info.type = "button";
        info.className = "slash-info-btn";
        info.title = cmd.description;
        info.setAttribute("aria-label", `Command info for ${slashCommandDisplay(cmd)}: ${cmd.description}`);
        info.innerHTML = ICON.info;
        info.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const details = el.querySelector(".slash-info-text");
          if (!details) return;
          const open = details.hidden;
          details.hidden = !open;
          info.classList.toggle("active", open);
          info.setAttribute("aria-expanded", open ? "true" : "false");
        };
        trailing.appendChild(info);
      }
      if (cmd.action === "toggle") {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = `slash-toggle${cmd.checked ? " on" : ""}`;
        toggle.setAttribute("aria-label", `${slashCommandDisplay(cmd)} ${cmd.checked ? "on" : "off"}`);
        toggle.setAttribute("aria-pressed", cmd.checked ? "true" : "false");
        toggle.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (cmd.disabled) return;
          pickSlash(cmd);
        };
        trailing.appendChild(toggle);
      }
      if (trailing.childNodes.length) {
        line.appendChild(trailing);
      }
      el.appendChild(line);
      if (cmd.description) {
        const details = document.createElement("div");
        details.className = "slash-info-text";
        details.textContent = cmd.description;
        details.hidden = true;
        el.appendChild(details);
      }
      el.onclick = (e) => {
        e.stopPropagation();
        if (cmd.disabled) return;
        pickSlash(cmd);
      };
      listEl.appendChild(el);
    });
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }
  function pickSlash(cmd) {
    if (cmd && cmd.action) {
      runSlashAction(cmd);
      return;
    }
    const name = slashCommandName(cmd);
    input.value = input.value.replace(/(?:^|\n)\/(\S*)$/, (full) =>
      full.startsWith("\n") ? `\n/${name} ` : `/${name} `,
    );
    slashPopover.hidden = true;
    input.focus();
    renderInputHighlight();
  }
  function runSlashAction(cmd) {
    switch (cmd.action) {
      case "model":
        if (state.busy) return;
        openSettingsSubpanel(renderModelPicker);
        return;
      case "effort":
        if (state.busy || !cmd.level) return;
        state.effort = cmd.level;
        vscode.postMessage({ type: "setEffort", level: cmd.level });
        closePopovers();
        return;
      case "effortSlider":
        return;
      case "config":
        openSettingsSubpanel(renderConfigDebugPanel);
        return;
      case "toggle": {
        if (!cmd.key) return;
        if (cmd.key === "alwaysApprove") {
          // "Always approve" is YOLO mode — auto-approve every permission request.
          const turningOn = state.currentModeId !== "yolo";
          if (turningOn) state.preYoloMode = state.currentModeId || "agent";
          state.currentModeId = turningOn ? "yolo" : (state.preYoloMode || "agent");
          updateModeBtn(state.currentModeId);
          vscode.postMessage({ type: "setMode", modeId: state.currentModeId });
          const mm = slashQueryAtCursor();
          showSlashCommands(mm ? mm[1] : "");
          return;
        }
        const next = !state[cmd.key];
        state[cmd.key] = next;
        if (cmd.key === "showThinking") applyThinkingVisibility();
        const m = slashQueryAtCursor();
        showSlashCommands(m ? m[1] : "");
        return;
      }
      case "logout":
        vscode.postMessage({ type: "logout" });
        closePopovers();
        return;
      case "url":
        if (cmd.url) vscode.postMessage({ type: "openUrl", url: cmd.url });
        closePopovers();
        return;
      default:
        return;
    }
  }
  function updateSendButton() {
    sendBtn.classList.remove("stop", "initializing");
    if (!state.busy) {
      sendBtn.innerHTML = ICON.arrowUp;
      sendBtn.title = "Send";
      sendBtn.disabled = false;
    } else if (state.busyLocked) {
      sendBtn.innerHTML = ICON.spinner;
      sendBtn.title = "Initializing…";
      sendBtn.classList.add("initializing");
      sendBtn.disabled = true;
    } else {
      sendBtn.innerHTML = ICON.square;
      sendBtn.title = "Stop";
      sendBtn.classList.add("stop");
      sendBtn.disabled = false;
    }
  }
  function sendOrStop() {
    if (state.busy) {
      vscode.postMessage({ type: "cancel" });
      return;
    }
    const text = input.value.trim();
    if (!text && state.chips.every((c) => c.hidden)) return;
    state.busy = true;
    updateSendButton();
    state.activeAgentEl = null;
    state.activeAgentRaw = "";
    state.activeThoughtEl = null;
    state.activeThoughtHdrEl = null;
    state.thoughtStartTime = null;
    state.activeToolGroupEl = null;
    vscode.postMessage({ type: "send", text, chips: state.chips });
    input.value = "";
    renderInputHighlight();
    slashPopover.hidden = true;
  }
  function renderInputHighlight() {
    return;
  }
  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "initialState":
        state.effort = msg.effort || "";
        state.cwd = msg.cwd || "";
        state.extVersion = msg.extVersion || "";
        applyThinkingVisibility();
        break;
      case "initialized": {
        state.cliVersion = msg.info.version || "";
        state.startingPhase = true;
        const verEl = $("welcome-version");
        if (verEl) { verEl.classList.add("loading-dots"); verEl.textContent = "Starting"; }
        setTopStatus("Starting", "running");
        const onb = $("welcome-onboarding");
        if (onb) onb.innerHTML = "";
        break;
      }
      case "startupStatus":
        showStartupStatus(msg.text);
        break;
      case "cliUpdating": {
        const verEl = $("welcome-version");
        if (verEl) { verEl.classList.add("loading-dots"); verEl.textContent = "Updating Grok CLI Copilot"; }
        setTopStatus("Updating CLI", "running");
        break;
      }
      case "session": {
        state.currentModelId = msg.currentModelId;
        state.availableModels = msg.models || [];
        const m = state.availableModels.find((x) => x.modelId === msg.currentModelId);
        if (m?.totalContextTokens) state.contextWindow = m.totalContextTokens;
        updateDonut(0);
        if (!state.busy && !state.startingPhase) setConnectedStatus();
        break;
      }
      case "modelChanged":
        state.currentModelId = msg.modelId;
        break;
      case "modeChanged":
        state.currentModeId = msg.modeId;
        updateModeBtn(msg.modeId);
        break;
      case "openModePopover":
        openModePopover();
        break;
      case "chips":
        state.chips = msg.chips;
        renderChips();
        break;
      case "contextItems":
        ctxDir = msg.dir || "";
        ctxParent = (typeof msg.parent === "string") ? msg.parent : null;
        ctxItems = msg.items || [];
        ctxLoading = false;
        ctxActive = 0;
        if (!contextPopover.hidden) renderContextList();
        break;
      case "commandsUpdate":
        state.commands = msg.commands || [];
        if (!slashPopover.hidden) updateSlash();
        break;
      case "userMessage":
        drainPlanHistory(state.userMsgCount);
        state.userMsgCount += 1;
        addMessage("user", msg.text, msg.chips || []);
        forceScrollToBottom();
        hidePlanProcessing();
        break;
      case "agentStart":
        setTopStatus("Thinking", "running");
        showGrokking();
        break;
      case "thoughtChunk":
        appendThought(msg.text);
        break;
      case "messageChunk":
        appendAgent(msg.text);
        break;
      case "media":
        addGeneratedMedia(msg);
        break;
      case "userMessageChunk":
        appendUserChunk(msg.text);
        break;
      case "historyReplay":
        if (msg.active) {
          state.replaying = true;
          state.suppressReplayTurn = false;
        } else {
          commitAgentTurn();
          state.replaying = false;
          state.suppressReplayTurn = false;
          flushPlanHistory();
        }
        break;
      case "planHistoryQueue":
        state.planHistoryQueue = (msg.plans || []).slice();
        state.userMsgCount = 0;
        break;
      case "planProcessing":
        showPlanProcessing();
        break;
      case "toolCall":
        if (state.suppressReplayTurn) break;
        if (isQuestionTool(msg.call)) {
          if (state.replaying) {
            const el = addRestoredQuestionCard(questionsFromCall(msg.call) || [], toolUpdateText(msg.call));
            if (msg.call.toolCallId) state.restoredCardsByToolCallId.set(msg.call.toolCallId, el);
          } else {
            state.questionToolCalls.set(msg.call.toolCallId, { questions: questionsFromCall(msg.call) || [] });
          }
          break;
        }
        if (isSubagentToolCall(msg.call)) {
          addSubagentCard(msg.call);
          break;
        }
        addToToolGroup(msg.call);
        break;
      case "toolCallUpdate": {
        if (state.suppressReplayTurn) break;
        const restoredEl = state.restoredCardsByToolCallId.get(msg.call?.toolCallId);
        if (restoredEl) {
          fillRestoredAnswer(restoredEl, toolUpdateText(msg.call));
          break;
        }
        if (state.questionToolCalls.has(msg.call?.toolCallId)) {
          if (toolUpdateText(msg.call) || String(msg.call?.status).toLowerCase() === "completed") {
            state.questionToolCalls.delete(msg.call.toolCallId);
          }
          break;
        }
        if (state.replaying) {
          const t = toolUpdateText(msg.call);
          if (/answered your questions|questions responses/i.test(t)) {
            addRestoredQuestionCard([], t);
            break;
          }
        }
        updateToolGroupCall(msg.call);
        const c = msg.call?.content;
        if (Array.isArray(c)) {
          for (const item of c) {
            if (item?.type === "diff") {
              const diff = {
                path: item.path,
                oldText: item.oldText ?? "",
                newText: item.newText ?? "",
              };
              state.pendingDiffByToolCallId.set(msg.call.toolCallId, diff);
              attachDiffPreviewToToolItem(msg.call.toolCallId, diff);
            }
          }
        }
        break;
      }
      case "hostActivity":
        addHostActivity(msg.activity);
        break;
      case "permissionRequest":
        addPermissionCard(msg.req);
        break;
      case "exitPlanRequest":
        addPlanCard(msg.req);
        break;
      case "questionRequest":
        addQuestionCard(msg.req);
        break;
      case "planHistory":
        addPlanHistoryCard(msg.text, msg.verdict, msg.planPath, msg.planName);
        break;
      case "planNotice":
        addPlanNotice(msg.text);
        break;
      case "planBlocked":
        addPlanNotice(
          msg.kind === "terminal"
            ? `Plan mode blocked a command: ${msg.target}`
            : `Plan mode blocked a write to ${msg.target}`,
        );
        break;
      case "promptComplete":
        commitAgentTurn();
        if (msg.meta?.totalTokens) updateDonut(msg.meta.totalTokens);
        break;
      case "agentReset": {
        hidePlanProcessing();
        hideGrokking();
        if (state.activeAgentEl) {
          const wrapper = state.activeAgentEl.closest(".msg-wrapper") ?? state.activeAgentEl.parentElement;
          (wrapper ?? state.activeAgentEl).remove();
        }
        state.activeAgentEl = null;
        state.activeAgentRaw = "";
        state.activeThoughtEl = null;
        state.activeThoughtHdrEl = null;
        state.thoughtStartTime = null;
        state.agentRenderScheduled = false;
        break;
      }
      case "agentError":
        hideGrokking();
        setTopStatus("Error", "error");
        addError(msg.text);
        state.busy = false;
        updateSendButton();
        break;
      case "agentEnd":
        hideGrokking();
        state.busy = false;
        setConnectedStatus();
        updateSendButton();
        break;
      case "exit":
        hideGrokking();
        addError(`Grok exited (code ${msg.code}). Click the new session button to restart.`);
        setTopStatus("Exited", "error");
        state.busy = false;
        updateSendButton();
        break;
      case "setBusy":
        state.busy = !!msg.value;
        state.busyLocked = !!msg.locked;
        updateSendButton();
        if (!state.busy) {
          if (state.startingPhase) {
            state.startingPhase = false;
            const verEl = $("welcome-version");
            if (verEl) {
              const ver = state.cliVersion ? ` · v${state.cliVersion}` : "";
              verEl.classList.remove("loading-dots");
              verEl.textContent = `Connected${ver}`;
            }
            setConnectedStatus();
          } else {
            setConnectedStatus();
          }
        }
        if (!slashPopover.hidden) {
          const m = slashQueryAtCursor();
          showSlashCommands(m ? m[1] : "");
        }
        if (!settingsPopover.hidden && state.settingsView === "model") renderModelPicker(reopenSlashFromSettings);
        break;
      case "summarizing": {
        clearWelcome();
        const si = document.createElement("div");
        si.id = "summarizing-indicator";
        si.className = "session-context-banner loading-dots";
        si.textContent = "Summarizing";
        messagesEl.appendChild(si);
        scrollToBottom();
        break;
      }
      case "sessionContext":
        addSessionContextBanner();
        break;
      case "clearMessages":
        resetForNewSession();
        break;
      case "onboarding":
        showOnboarding(msg.state, { platform: msg.platform });
        break;
      case "error":
        addError(msg.text);
        break;
      case "providerNotification":
        break;
      case "sessions":
        state.sessions = msg.entries || [];
        state.activeSessionId = msg.activeId || null;
        state.dots = msg.dots || {};
        if (!historyPopover.hidden) renderHistoryList();
        break;
      case "sessionDot":
        if (msg.dot && msg.dot !== "none") state.dots[msg.id] = msg.dot;
        else delete state.dots[msg.id];
        if (!historyPopover.hidden) patchSessionDot(msg.id);
        break;
    }
  });
  sendBtn.onclick = sendOrStop;
  updateSendButton();
  newBtn.onclick = () => {
    resetForNewSession();
    vscode.postMessage({ type: "newSession" });
  };
  modeBtn.onclick = (e) => { e.stopPropagation(); openModePopover(); };
  addBtn.onclick = (e) => { e.stopPropagation(); openAddPopover(); };
  slashBtn.onclick = (e) => { e.stopPropagation(); openSlashPopover(); };
  historyBtn.onclick = (e) => { e.stopPropagation(); openHistoryPopover(); };
  modePopover.addEventListener("click", (e) => e.stopPropagation());
  settingsPopover.addEventListener("click", (e) => e.stopPropagation());
  addPopover.addEventListener("click", (e) => e.stopPropagation());
  contextPopover.addEventListener("click", (e) => e.stopPropagation());
  slashPopover.addEventListener("click", (e) => e.stopPropagation());
  historyPopover.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    const exprBtn = e.target.closest(".expr-btn");
    if (exprBtn) {
      e.preventDefault();
      e.stopPropagation();
      const host = exprBtn.closest(".math-export, .mermaid-block");
      if (host) {
        const act = exprBtn.getAttribute("data-expr-act");
        if (act === "copy") copyExprSource(host.getAttribute("data-export-src"), exprBtn);
        else if (act === "download" || act === "open") void exportExpr(host, act);
      }
      return;
    }
    const copyBtn = e.target.closest(".code-copy-btn");
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const codeEl = copyBtn.parentElement && copyBtn.parentElement.querySelector("pre code");
      const text = codeEl ? codeEl.innerText : "";
      navigator.clipboard.writeText(text).then(() => {
        const label = copyBtn.querySelector(".code-copy-label");
        const glyph = copyBtn.querySelector(".code-copy-glyph");
        const prevLabel = label ? label.textContent : "";
        const prevGlyph = glyph ? glyph.innerHTML : "";
        if (label) label.textContent = "Copied";
        if (glyph) glyph.innerHTML = ICON.check;
        copyBtn.classList.add("copied");
        setTimeout(() => {
          if (label) label.textContent = prevLabel;
          if (glyph) glyph.innerHTML = prevGlyph;
          copyBtn.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    const onbAction = e.target.closest(".onb-action");
    if (onbAction) {
      e.preventDefault();
      e.stopPropagation();
      const act = onbAction.dataset.act;
      if (act === "runInstall") vscode.postMessage({ type: "runInstallCmd" });
      else if (act === "runLogin") vscode.postMessage({ type: "runGrokLogin" });
      else if (act === "recheck") vscode.postMessage({ type: "recheckConnection" });
      return;
    }
    const onbCopy = e.target.closest(".onb-copy");
    if (onbCopy) {
      e.preventDefault();
      e.stopPropagation();
      const cmd = onbCopy.dataset.cmd || "";
      navigator.clipboard.writeText(cmd).then(() => {
        const prevHtml = onbCopy.innerHTML;
        onbCopy.innerHTML = ICON.check;
        onbCopy.classList.add("copied");
        setTimeout(() => {
          onbCopy.innerHTML = prevHtml;
          onbCopy.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    const msgCopyBtn = e.target.closest(".msg-copy-btn");
    if (msgCopyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const msgEl = msgCopyBtn.closest(".msg");
      const text = (msgEl && msgEl._copyText) || "";
      navigator.clipboard.writeText(text).then(() => {
        const glyph = msgCopyBtn.querySelector(".msg-action-glyph");
        const prevGlyph = glyph ? glyph.innerHTML : "";
        if (glyph) glyph.innerHTML = ICON.check;
        msgCopyBtn.classList.add("copied");
        setTimeout(() => {
          if (glyph) glyph.innerHTML = prevGlyph;
          msgCopyBtn.classList.remove("copied");
        }, 1500);
      });
      return;
    }
    closePopovers();
    const a = e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      vscode.postMessage({ type: "openUrl", url: href });
    } else if (/^[a-zA-Z]:[\\/]/.test(href) || href.startsWith("\\\\") || !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      vscode.postMessage({ type: "openFile", path: href });
    }
  });
  input.addEventListener("input", () => { updateSlash(); updateAtMention(); renderInputHighlight(); });
  input.addEventListener("scroll", () => {
    if (!inputHighlight) return;
    inputHighlight.scrollTop = input.scrollTop;
    inputHighlight.scrollLeft = input.scrollLeft;
  });
  renderInputHighlight();
  input.addEventListener("keydown", (e) => {
    if (!slashPopover.hidden && state.slashFiltered.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.slashActive = (state.slashActive + 1) % state.slashFiltered.length;
        renderSlash(); return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.slashActive = (state.slashActive - 1 + state.slashFiltered.length) % state.slashFiltered.length;
        renderSlash(); return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pickSlash(state.slashFiltered[state.slashActive]); return;
      }
      if (e.key === "Escape") { slashPopover.hidden = true; return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendOrStop(); }
  });
  function imageFileFromClipboard(clipboard) {
    if (!clipboard) return null;
    if (clipboard.files && clipboard.files.length > 0) {
      for (const f of Array.from(clipboard.files)) {
        if (f.type && f.type.startsWith("image/")) {
          return f;
        }
      }
    }
    const items = clipboard.items ? Array.from(clipboard.items) : [];
    const imgItem = items.find((it) => it.type && it.type.startsWith("image/"));
    if (imgItem) {
      return imgItem.getAsFile();
    }
    return null;
  }
  function postPastedImage(imageFile) {
    const reader = new FileReader();
    reader.onload = () => {
      vscode.postMessage({
        type: "pasteImage",
        data: reader.result,
        name: imageFile.name || "pasted.png"
      });
      input.focus();
    };
    reader.readAsDataURL(imageFile);
  }
  document.addEventListener("paste", (e) => {
    const imageFile = imageFileFromClipboard(e.clipboardData);
    if (imageFile) {
      e.preventDefault();
      postPastedImage(imageFile);
    }
  });
  document.addEventListener("dragenter", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    const data = e.dataTransfer?.getData("text/uri-list");
    if (data) {
      const uris = data.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
      for (const uri of uris) {
        const m = uri.match(/^file:\/\/(.+)$/);
        if (!m) continue;
        vscode.postMessage({ type: "dropFile", path: decodeURIComponent(m[1]), shift: e.shiftKey });
      }
    }
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      for (const f of Array.from(files)) {
        if (f.type && f.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            vscode.postMessage({ type: "pasteImage", data: reader.result, name: f.name });
          };
          reader.readAsDataURL(f);
        }
      }
    }
  });
  initMermaid();
  vscode.postMessage({ type: "ready" });
})();
