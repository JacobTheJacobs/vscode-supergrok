import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click, Posted } from "./webview-harness";

const $ = (doc: Document, id: string) => doc.getElementById(id) as HTMLElement;
const types = (posted: Posted[]) => posted.map((p) => p.type);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("slash command menu", () => {
  const commands = [
    { name: "compact", description: "Compress conversation history to save context window" },
    { name: "fork", description: "Fork this conversation into a new branch" },
    { name: "always-approve", description: "Toggle always-approve mode" },
    { name: "memory", description: "Open conversation memory" },
  ];
  it("opens from the toolbar slash button and shows every Grok command", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "commandsUpdate", commands });
    click(h.window, $(h.doc, "slash-btn"));
    const pop = $(h.doc, "slash-popover");
    expect((pop as any).hidden).toBe(false);
    expect(($(h.doc, "input") as HTMLTextAreaElement).value).toBe("/");
    const names = Array.from(pop.querySelectorAll(".slash-name")).map((el) => el.textContent);
    expect(names).toEqual(expect.arrayContaining([
      "/fork",
      "/compact",
      "/memory",
      "Always approve",
      "Switch model...",
      "Config & debug",
      "Log out",
      "Thinking",
    ]));
    expect(Array.from(pop.querySelectorAll(".slash-section-title")).map((el) => el.textContent))
      .toEqual(["Session", "Model", "Memory", "Settings"]);
  });
  it("inserts the selected command from the menu", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "commandsUpdate", commands });
    click(h.window, $(h.doc, "slash-btn"));
    const fork = Array.from(h.doc.querySelectorAll(".slash-item"))
      .find((el) => el.querySelector(".slash-name")?.textContent === "/fork") as HTMLElement;
    click(h.window, fork);
    expect(($(h.doc, "input") as HTMLTextAreaElement).value).toBe("/fork ");
    expect(($(h.doc, "slash-popover") as any).hidden).toBe(true);
  });
  it("exposes Always approve as a YOLO-mode toggle that drives setMode", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "commandsUpdate", commands });
    click(h.window, $(h.doc, "slash-btn"));
    const item = () => Array.from(h.doc.querySelectorAll(".slash-item"))
      .find((el) => el.querySelector(".slash-name")?.textContent === "Always approve") as HTMLElement;
    // The plain CLI /always-approve command is replaced by the local toggle.
    expect(Array.from(h.doc.querySelectorAll(".slash-name")).map((el) => el.textContent))
      .not.toContain("/always-approve");
    const toggle = item().querySelector(".slash-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.className).not.toContain("on");
    h.posted.length = 0;
    click(h.window, toggle);
    expect(h.posted).toContainEqual({ type: "setMode", modeId: "yolo" });
    // The mode button keeps showing the operating mode — never "YOLO".
    const modeBtn = $(h.doc, "mode-btn");
    expect(modeBtn.textContent).not.toContain("YOLO");
    expect(modeBtn.className).not.toContain("yolo-active");
    // Now on; toggling again returns to the prior (agent) mode.
    expect(item().querySelector(".slash-toggle")?.className).toContain("on");
    click(h.window, item().querySelector(".slash-toggle") as HTMLButtonElement);
    expect(h.posted).toContainEqual({ type: "setMode", modeId: "agent" });
  });
  it("hides command descriptions until the info icon is clicked", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "commandsUpdate", commands });
    click(h.window, $(h.doc, "slash-btn"));
    const compact = Array.from(h.doc.querySelectorAll(".slash-item"))
      .find((el) => el.querySelector(".slash-name")?.textContent === "/compact") as HTMLElement;
    const info = compact.querySelector(".slash-info-btn") as HTMLButtonElement;
    const details = compact.querySelector(".slash-info-text") as HTMLElement;
    expect(compact.querySelector(".slash-desc")).toBeNull();
    expect(info.title).toBe("Compress conversation history to save context window");
    expect(details.hidden).toBe(true);
    click(h.window, info);
    expect(details.hidden).toBe(false);
    expect(details.textContent).toBe("Compress conversation history to save context window");
    expect(($(h.doc, "input") as HTMLTextAreaElement).value).toBe("/");
    expect(($(h.doc, "slash-popover") as any).hidden).toBe(false);
  });
});

describe("history popover (regression: popover that never closed)", () => {
  it("opens on the history button and requests the session list", () => {
    const { window, posted, doc } = bootWebview();
    const pop = $(doc, "history-popover");
    expect((pop as any).hidden).toBe(true);
    click(window, $(doc, "history-btn"));
    expect((pop as any).hidden).toBe(false);
    expect(types(posted)).toContain("listSessions");
  });
  it("handles Ctrl+V image paste anywhere in the webview without hijacking text paste", async () => {
    const { window, posted, doc } = bootWebview();
    const FileCtor = (window as any).File;
    const textPaste = new (window as any).Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", {
      value: { files: [], items: [{ type: "text/plain", getAsFile: () => null }] },
    });
    doc.dispatchEvent(textPaste);
    expect(textPaste.defaultPrevented).toBe(false);
    expect(types(posted)).not.toContain("pasteImage");
    const imagePaste = new (window as any).Event("paste", { bubbles: true, cancelable: true });
    const image = new FileCtor(["fake-png"], "shot.png", { type: "image/png" });
    (window as any).FileReader = class {
      result = "data:image/png;base64,ZmFrZS1wbmc=";
      onload: null | (() => void) = null;
      readAsDataURL() { this.onload?.(); }
    };
    Object.defineProperty(imagePaste, "clipboardData", {
      value: { files: [image], items: [] },
    });
    doc.dispatchEvent(imagePaste);
    await tick();
    expect(imagePaste.defaultPrevented).toBe(true);
    expect(posted).toContainEqual({
      type: "pasteImage",
      data: expect.stringMatching(/^data:image\/png;base64,/),
      name: "shot.png",
    });
    expect(doc.activeElement).toBe($(doc, "input"));
  });
  it("closes on an outside click but stays open on a click inside it", () => {
    const { window, doc } = bootWebview();
    const pop = $(doc, "history-popover");
    click(window, $(doc, "history-btn"));
    expect((pop as any).hidden).toBe(false);
    click(window, pop);
    expect((pop as any).hidden).toBe(false);
    click(window, $(doc, "messages"));
    expect((pop as any).hidden).toBe(true);
  });
});

describe("session rows (regression: only the label was clickable)", () => {
  const entries = [
    { id: "s1", displayName: "Add subtract fn", numMessages: 4, updatedAt: Date.now() - 60000 },
    { id: "s2", displayName: "Refactor parser", numMessages: 9, updatedAt: Date.now() - 3600000 },
  ];
  function openWithSessions() {
    const h = bootWebview();
    click(h.window, $(h.doc, "history-btn"));
    h.posted.length = 0;
    dispatch(h.window, { type: "sessions", entries, activeId: null });
    return h;
  }
  it("renders one row per session with name + meta", () => {
    const { doc } = openWithSessions();
    const rows = doc.querySelectorAll(".history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".history-row-name")!.textContent).toBe("Add subtract fn");
    expect(rows[0].querySelector(".history-row-meta")!.textContent).toContain("4 msg");
  });
  it("resumes the session when the row's META area (not the label) is clicked", () => {
    const { window, posted, doc } = openWithSessions();
    const meta = doc.querySelector(".history-row .history-row-meta") as HTMLElement;
    click(window, meta);
    expect(posted).toContainEqual({ type: "resumeSession", id: "s1" });
  });
  it("delete button posts deleteSession and does NOT also resume (stopPropagation)", () => {
    const { window, posted, doc } = openWithSessions();
    const delBtn = doc.querySelector(".history-row .history-action-danger") as HTMLElement;
    click(window, delBtn);
    expect(posted).toContainEqual({ type: "deleteSession", id: "s1", name: "Add subtract fn" });
    expect(types(posted)).not.toContain("resumeSession");
  });
  it("hides the delete button for the active session, keeps it for others", () => {
    const h = bootWebview();
    click(h.window, $(h.doc, "history-btn"));
    h.posted.length = 0;
    dispatch(h.window, { type: "sessions", entries, activeId: "s1" });
    const rows = h.doc.querySelectorAll(".history-row");
    expect(rows[0].querySelector(".history-action-danger")).toBeNull();
    expect(rows[1].querySelector(".history-action-danger")).not.toBeNull();
    expect(rows[0].querySelector(".history-action-btn")).not.toBeNull();
  });
  it("rename button enters rename mode and does NOT resume", () => {
    const { window, posted, doc } = openWithSessions();
    const renameBtn = doc.querySelectorAll(".history-row .history-action-btn")[0] as HTMLElement;
    click(window, renameBtn);
    expect(doc.querySelector(".history-row input.history-rename")).not.toBeNull();
    expect(types(posted)).not.toContain("resumeSession");
  });
  it("keeps the history list scroll position when sessions refresh while open", () => {
    const h = bootWebview();
    const many = Array.from({ length: 24 }, (_, i) => ({
      id: `s${i}`,
      displayName: `Session ${i}`,
      numMessages: i + 1,
      updatedAt: Date.now() - i * 1000,
    }));
    click(h.window, $(h.doc, "history-btn"));
    dispatch(h.window, { type: "sessions", entries: many, activeId: null });
    const list = h.doc.querySelector(".history-list") as HTMLElement;
    Object.defineProperty(list, "scrollTop", { value: 180, writable: true, configurable: true });
    list.dispatchEvent(new (h.window as any).Event("scroll"));
    dispatch(h.window, {
      type: "sessions",
      entries: many.map((s, i) => i === 2 ? { ...s, numMessages: 99 } : s),
      activeId: null,
    });
    const refreshed = h.doc.querySelector(".history-list") as HTMLElement;
    expect(refreshed.scrollTop).toBe(180);
  });
});

describe("session status dots (Agent Dashboard)", () => {
  const entries = [
    { id: "s1", displayName: "Working one", numMessages: 4, updatedAt: Date.now() },
    { id: "s2", displayName: "Resting one", numMessages: 2, updatedAt: Date.now() },
    { id: "s3", displayName: "Unread one", numMessages: 1, updatedAt: Date.now() },
  ];
  function openWithDots(dots: Record<string, string>, activeId: string | null = null) {
    const h = bootWebview();
    click(h.window, $(h.doc, "history-btn"));
    h.posted.length = 0;
    dispatch(h.window, { type: "sessions", entries, activeId, dots });
    return h;
  }
  const dotOf = (doc: Document, id: string) =>
    doc.querySelector(`[data-session-dot="${id}"]`) as HTMLElement;
  it("colors each row's dot from the dots map; rows with no entry render gray (dot-none)", () => {
    const { doc } = openWithDots({ s1: "working", s2: "unread" });
    expect(dotOf(doc, "s1").className).toContain("dot-working");
    expect(dotOf(doc, "s2").className).toContain("dot-unread");
    expect(dotOf(doc, "s3").className).toContain("dot-none");
  });
  it("renders each dot value with its class (working/needs-you/unread/error)", () => {
    const { doc } = openWithDots({ s1: "needs-you", s2: "unread", s3: "error" });
    expect(dotOf(doc, "s1").className).toContain("dot-needs-you");
    expect(dotOf(doc, "s2").className).toContain("dot-unread");
    expect(dotOf(doc, "s3").className).toContain("dot-error");
  });
  it("patches a single dot incrementally on a sessionDot message (no re-render)", () => {
    const { window, doc } = openWithDots({ s1: "working", s2: "unread" });
    const before = dotOf(doc, "s1");
    dispatch(window, { type: "sessionDot", id: "s1", dot: "needs-you" });
    expect(dotOf(doc, "s1")).toBe(before);
    expect(dotOf(doc, "s1").className).toContain("dot-needs-you");
    expect(dotOf(doc, "s2").className).toContain("dot-unread");
  });
  it("drops a dot to gray when sessionDot clears it to none (opened / reaped+read)", () => {
    const { window, doc } = openWithDots({ s1: "unread" });
    dispatch(window, { type: "sessionDot", id: "s1", dot: "none" });
    expect(dotOf(doc, "s1").className).toContain("dot-none");
  });
  it("keeps an unread dot when the session is reaped but still unopened", () => {
    const { window, doc } = openWithDots({ s1: "working" });
    dispatch(window, { type: "sessionDot", id: "s1", dot: "unread" });
    expect(dotOf(doc, "s1").className).toContain("dot-unread");
  });
});

describe("top live status", () => {
  const status = (doc: Document) => doc.querySelector(".top-brand-status") as HTMLElement;
  const topBar = (doc: Document) => doc.querySelector(".top-bar") as HTMLElement;
  it("compacts startup phases into the Grok CLI Copilot header status", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "startupStatus", text: "Authenticating Grok CLI" });
    expect(status(doc).textContent).toBe("Authenticating CLI");
    expect(status(doc).className).toContain("is-running");
    expect(status(doc).className).toContain("loading-dots");
    expect(topBar(doc).className).toContain("is-running");
  });
  it("shows thinking and returns to connected after the turn ends", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "initialized", info: { version: "0.2.54" } });
    dispatch(window, { type: "setBusy", value: false });
    expect(status(doc).textContent).toBe("Connected · v0.2.54");
    dispatch(window, { type: "agentStart" });
    expect(status(doc).textContent).toBe("Thinking");
    expect(status(doc).className).toContain("is-running");
    expect(topBar(doc).className).toContain("is-running");
    dispatch(window, { type: "agentEnd" });
    expect(status(doc).textContent).toBe("Connected · v0.2.54");
    expect(status(doc).className).not.toContain("is-running");
    expect(status(doc).className).not.toContain("loading-dots");
    expect(topBar(doc).className).not.toContain("is-running");
  });
  it("shows local shell/file activity in the header", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "hostActivity",
      activity: { id: "terminal/create:1", phase: "start", kind: "terminal", title: "Running pnpm test", detail: "pnpm test" },
    });
    expect(status(doc).textContent).toBe("Running pnpm test");
    expect(status(doc).className).toContain("is-running");
    expect(topBar(doc).className).toContain("is-running");
  });
  it("switches to attention state when Grok needs approval", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "permissionRequest",
      req: {
        id: "p1",
        toolCall: { toolCallId: "t1", kind: "write", title: "Write src/app.ts" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      },
    });
    expect(status(doc).textContent).toBe("Needs approval");
    expect(status(doc).className).toContain("is-attention");
    expect(status(doc).className).not.toContain("loading-dots");
    expect(topBar(doc).className).toContain("is-attention");
  });
});

describe("mode picker (the plan-gate entry path)", () => {
  it("offers Agent / Plan (YOLO lives in the Always-approve toggle) and posts setMode with the chosen mode id", () => {
    const { window, posted, doc } = bootWebview();
    const pop = $(doc, "mode-popover");
    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(false);
    const labels = [...pop.querySelectorAll(".mode-item-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Agent mode", "Plan mode"]);
    const planItem = [...pop.querySelectorAll(".mode-popover-item")]
      .find((el) => el.querySelector(".mode-item-label")!.textContent === "Plan mode") as HTMLElement;
    click(window, planItem);
    expect(posted).toContainEqual({ type: "setMode", modeId: "plan" });
    expect((pop as any).hidden).toBe(true);
  });
  it("toggles the mode popover closed when the button is clicked again", () => {
    const { window, doc } = bootWebview();
    const pop = $(doc, "mode-popover");
    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(false);
    click(window, $(doc, "mode-btn"));
    expect((pop as any).hidden).toBe(true);
  });
});

describe("slash settings actions (model + effort disabled while busy / priming)", () => {
  const models = [
    { modelId: "grok-build", name: "Grok CLI Copilot" },
    { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
  ];
  function bootWithModels(busy?: { value: boolean; locked?: boolean }) {
    const h = bootWebview();
    dispatch(h.window, { type: "session", sessionId: "s1", models, currentModelId: "grok-build" });
    if (busy) dispatch(h.window, { type: "setBusy", ...busy });
    h.posted.length = 0;
    return h;
  }
  const slashItem = (doc: Document, label: string) =>
    [...doc.querySelectorAll(".slash-item")]
      .find((el) => el.querySelector(".slash-name")?.textContent === label) as HTMLElement;
  it("shows the user-facing model name in slash command info, not the raw id", () => {
    const { window, doc } = bootWithModels();
    click(window, $(doc, "slash-btn"));
    const switchModel = slashItem(doc, "Switch model...");
    const info = switchModel.querySelector(".slash-info-btn") as HTMLButtonElement;
    expect(info.title).toContain("Grok CLI Copilot");
    expect(info.title).not.toContain("grok-build");
  });
  it("when idle, the slash model action opens the picker and a pick posts setModel", () => {
    const { window, posted, doc } = bootWithModels();
    click(window, $(doc, "slash-btn"));
    click(window, slashItem(doc, "Switch model..."));
    const composer = [...doc.querySelectorAll("#settings-popover .toolbar-popover-item")]
      .find((el) => el.textContent!.includes("Composer 2.5 Fast")) as HTMLElement;
    click(window, composer);
    expect(posted).toContainEqual({ type: "setModel", modelId: "grok-composer-2.5-fast" });
  });
  it("while priming, the slash model action is disabled and clicking it neither opens the picker nor posts", () => {
    const { window, posted, doc } = bootWithModels({ value: true, locked: true });
    click(window, $(doc, "slash-btn"));
    const switchModel = slashItem(doc, "Switch model...");
    expect(switchModel.className).toContain("disabled");
    click(window, switchModel);
    expect(doc.querySelector("#settings-popover .popover-back")).toBeNull();
    expect(types(posted)).not.toContain("setModel");
  });
  it("while busy, slash effort slider is disabled and does not post setEffort", () => {
    const { window, posted, doc } = bootWithModels({ value: true });
    click(window, $(doc, "slash-btn"));
    const effort = slashItem(doc, "Effort (Minimal)");
    const slider = effort.querySelector(".slash-effort-slider") as HTMLInputElement;
    expect(effort.className).toContain("disabled");
    expect(slider.disabled).toBe(true);
    slider.value = "5";
    slider.dispatchEvent(new (window as any).Event("change", { bubbles: true }));
    expect(types(posted)).not.toContain("setEffort");
  });
  it("while idle, moving the slash effort slider posts the selected Grok effort", () => {
    const { window, posted, doc } = bootWithModels();
    click(window, $(doc, "slash-btn"));
    const labels = [...doc.querySelectorAll(".slash-name")].map((el) => el.textContent || "");
    expect(labels).toContain("Effort (Minimal)");
    expect(labels).not.toContain("Effort: Extra high");
    const slider = doc.querySelector(".slash-effort-slider") as HTMLInputElement;
    const control = doc.querySelector(".slash-effort-control") as HTMLElement;
    expect(control).not.toBeNull();
    expect(doc.querySelector(".slash-effort-value")).toBeNull();
    slider.value = "5";
    slider.dispatchEvent(new (window as any).Event("input", { bubbles: true }));
    expect([...doc.querySelectorAll(".slash-name")].map((el) => el.textContent || "")).toContain("Effort (Extra high)");
    slider.dispatchEvent(new (window as any).Event("change", { bubbles: true }));
    expect(posted).toContainEqual({ type: "setEffort", level: "xhigh" });
  });
  it("re-renders an open slash menu to unlock actions once busy clears", () => {
    const { window, doc } = bootWithModels({ value: true, locked: true });
    click(window, $(doc, "slash-btn"));
    expect(slashItem(doc, "Switch model...").className).toContain("disabled");
    dispatch(window, { type: "setBusy", value: false });
    expect(($(doc, "slash-popover") as any).hidden).toBe(false);
    expect(slashItem(doc, "Switch model...").className).not.toContain("disabled");
  });
});

describe("reasoning trace (regression: thinking traces no longer visible)", () => {
  it("renders a visible thinking block whose header toggles the body open/closed", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "thoughtChunk", text: "considering the approach…" });
    const block = doc.querySelector(".msg.thinking")!;
    const hdr = block.querySelector(".thinking-header") as HTMLElement;
    const body = block.querySelector(".thinking-body") as HTMLElement;
    const chevron = block.querySelector(".thinking-chevron") as HTMLElement;
    expect(body.hidden).toBe(false);
    expect(chevron.textContent).toBe("▼");
    expect(body.textContent).toContain("considering the approach");
    click(window, hdr);
    expect(body.hidden).toBe(true);
    expect(chevron.textContent).toBe("▶");
    click(window, hdr);
    expect(body.hidden).toBe(false);
    expect(chevron.textContent).toBe("▼");
  });
  it("renders XML-ish tool thoughts as structured steps instead of raw tags", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "thoughtChunk",
      text:
        `The user query is: "read the extensions files"\n` +
        `<tool_call name="list_dir">\n` +
        `<parameter name="target_directory">extensions</parameter>\n` +
        `</tool_call>\n` +
        `<tool_call name="grep">\n` +
        `<parameter name="pattern">extension</parameter>\n` +
        `<parameter name="target_file">package.json</parameter>\n` +
        `</tool_call>`,
    });
    const body = doc.querySelector(".thinking-body") as HTMLElement;
    expect(body.textContent).toContain("Request");
    expect(body.textContent).toContain("read the extensions files");
    expect(body.textContent).toContain("List directory");
    expect(body.textContent).toContain("Search text");
    expect(body.textContent).toContain("dir: extensions");
    expect(body.textContent).toContain("pattern: extension");
    expect(body.textContent).not.toContain("<tool_call");
    expect(body.querySelectorAll(".thinking-step")).toHaveLength(2);
  });
});

describe("Grokking… indicator (waiting placeholder)", () => {
  const grokking = (doc: Document) => doc.querySelector(".grokking") as HTMLElement | null;
  it("mounts on agentStart with the Thinking-style animated label and no chevron", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    const el = grokking(doc);
    expect(el).not.toBeNull();
    const label = el!.querySelector(".grokking-label") as HTMLElement;
    expect(label.textContent).toBe("Grokking");
    expect(label.className).toContain("loading-dots");
    expect(el!.querySelector(".thinking-chevron")).toBeNull();
    expect(el!.querySelector(".thinking-body")).toBeNull();
    expect(el!.classList.contains("thinking")).toBe(false);
  });
  it("is replaced in place by the Thinking block on the first thought chunk", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    expect(grokking(doc)).not.toBeNull();
    dispatch(window, { type: "thoughtChunk", text: "considering…" });
    expect(grokking(doc)).toBeNull();
    expect(doc.querySelector(".msg.thinking")).not.toBeNull();
  });
  it("is replaced by the agent bubble when the turn streams text without thinking", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    dispatch(window, { type: "messageChunk", text: "Here is the answer." });
    expect(grokking(doc)).toBeNull();
    expect(doc.querySelector(".msg.agent")).not.toBeNull();
  });
  it("is replaced when the first content of the turn is a tool call", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "t1", title: "read foo.ts", kind: "read", status: "in_progress" },
    });
    expect(grokking(doc)).toBeNull();
    expect(doc.querySelector(".tool-group")).not.toBeNull();
  });
  it("is replaced when local host activity starts before a Grok tool call", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    dispatch(window, {
      type: "hostActivity",
      activity: { id: "fs/read_text_file:1", phase: "start", kind: "read", title: "Reading src/extension/sidebar-provider.ts" },
    });
    expect(grokking(doc)).toBeNull();
    expect(doc.querySelector(".tool-group")?.textContent).toContain("Reading src/extension/sidebar-provider.ts");
  });
  it("shows on every turn, not just the first (a general typing indicator)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    dispatch(window, { type: "messageChunk", text: "first" });
    dispatch(window, { type: "agentEnd" });
    expect(grokking(doc)).toBeNull();
    dispatch(window, { type: "agentStart" });
    expect(grokking(doc)).not.toBeNull();
  });
  it("clears on agentEnd even if the turn produced no content", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    expect(grokking(doc)).not.toBeNull();
    dispatch(window, { type: "agentEnd" });
    expect(grokking(doc)).toBeNull();
  });
  it("coexists with the user's own bubble, below it (message shows as sent while waiting)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "userMessage", text: "do the thing", chips: [] });
    dispatch(window, { type: "agentStart" });
    expect(doc.querySelectorAll(".msg.user").length).toBe(1);
    const el = grokking(doc);
    expect(el).not.toBeNull();
    const user = doc.querySelector(".msg.user") as HTMLElement;
    expect(user.compareDocumentPosition(el!) & 4 ).toBeTruthy();
  });
  it("is mutually exclusive with the plan-processing indicator (one waiting indicator at a time)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "planProcessing" });
    expect(doc.querySelector(".plan-processing")).not.toBeNull();
    dispatch(window, { type: "agentStart" });
    expect(doc.querySelector(".plan-processing")).toBeNull();
    expect(grokking(doc)).not.toBeNull();
    dispatch(window, { type: "planProcessing" });
    expect(grokking(doc)).toBeNull();
    expect(doc.querySelector(".plan-processing")).not.toBeNull();
  });
  it("does not duplicate when agentStart fires twice without content", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "agentStart" });
    dispatch(window, { type: "agentStart" });
    expect(doc.querySelectorAll(".grokking").length).toBe(1);
  });
});

describe("activity log", () => {
  it("keeps completed tool rows visible with result text", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "t1", name: "read_file", kind: "read", rawInput: { path: "src/extension/sidebar-provider.ts" } },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "t1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "loaded 42 lines" } }],
      },
    });
    const item = doc.querySelector(".tool-item") as HTMLElement;
    expect(item.textContent).toContain("Read sidebar-provider.ts");
    expect(item.className).toContain("done");
    expect(item.textContent).toContain("loaded 42 lines");
  });
  it("updates local host activity rows from running to done", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "hostActivity",
      activity: { id: "terminal/create:7", phase: "start", kind: "terminal", title: "Running pnpm test", detail: "pnpm test" },
    });
    dispatch(window, {
      type: "hostActivity",
      activity: { id: "terminal/create:7", phase: "complete", kind: "terminal", title: "Running pnpm test", result: "terminal 1" },
    });
    const item = doc.querySelector(".host-activity") as HTMLElement;
    expect(item.textContent).toContain("Running pnpm test");
    expect(item.className).toContain("done");
    expect(item.textContent).toContain("terminal 1");
  });
});

describe("user message (regression: doubled on grok 0.2.33)", () => {
  const users = (doc: Document) => doc.querySelectorAll(".msg.user");
  it("does not render a second bubble when a live prompt is echoed back as a user chunk", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "userMessage", text: "/imagine a rocket", chips: [] });
    expect(users(doc).length).toBe(1);
    dispatch(window, { type: "userMessageChunk", text: "/imagine a rocket" });
    expect(users(doc).length).toBe(1);
  });
  it("still renders the user bubble from chunks during a session replay", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, { type: "userMessageChunk", text: "resumed prompt" });
    expect(users(doc).length).toBe(1);
    expect(users(doc)[0].textContent).toContain("resumed prompt");
  });
});

describe("welcome version line (session-start lifecycle)", () => {
  const verEl = (doc: Document) => $(doc, "welcome-version");
  const ver = (doc: Document) => verEl(doc).textContent;
  const animating = (doc: Document) => verEl(doc).classList.contains("loading-dots");
  it("flips to connected only when priming finishes, not at the handshake", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "initialized", info: { version: "0.2.33" } });
    expect(ver(doc)).toBe("Starting");
    expect(animating(doc)).toBe(true);
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");
    expect(animating(doc)).toBe(false);
  });
  it("shows the silent-update hint, then starting, then the new version", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "cliUpdating" });
    expect(ver(doc)).toBe("Updating Grok CLI Copilot");
    expect(animating(doc)).toBe(true);
    dispatch(window, { type: "initialized", info: { version: "0.2.40" } });
    expect(ver(doc)).toBe("Starting");
    expect(animating(doc)).toBe(true);
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.40");
    expect(animating(doc)).toBe(false);
  });
  it("shows explicit startup phases while Grok CLI is still opening", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "startupStatus", text: "Authenticating Grok CLI" });
    expect(ver(doc)).toBe("Authenticating Grok CLI");
    expect(animating(doc)).toBe(true);
  });
  it("does not overwrite the version on later (post-priming) busy toggles", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "initialized", info: { version: "0.2.33" } });
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");
    dispatch(window, { type: "setBusy", value: true });
    dispatch(window, { type: "setBusy", value: false });
    expect(ver(doc)).toBe("Connected · v0.2.33");
  });
});

describe("slash settings menu — Config & debug", () => {
  function boot() {
    const h = bootWebview();
    dispatch(h.window, { type: "initialState", effort: "", cwd: "/x", extVersion: "1.4.0" });
    dispatch(h.window, { type: "initialized", info: { version: "0.2.33" } });
    dispatch(h.window, { type: "session", sessionId: "s1", models: [], currentModelId: "grok-build" });
    h.posted.length = 0;
    return h;
  }
  const items = (doc: Document) => [...doc.querySelectorAll("#settings-popover .toolbar-popover-item")] as HTMLElement[];
  const itemByText = (doc: Document, text: string) =>
    items(doc).find((el) => el.textContent!.includes(text)) as HTMLElement;
  const slashItem = (doc: Document, label: string) =>
    [...doc.querySelectorAll(".slash-item")]
      .find((el) => el.querySelector(".slash-name")?.textContent === label) as HTMLElement;
  it("shows settings actions in slash without a settings button or version-details entry", () => {
    const h = boot();
    expect(h.doc.getElementById("settings-btn")).toBeNull();
    click(h.window, $(h.doc, "slash-btn"));
    const labels = [...h.doc.querySelectorAll(".slash-name")].map((el) => el.textContent || "");
    expect(labels.some((l) => l.includes("Version panel"))).toBe(false);
    expect(labels).toContain("Config & debug");
    expect(labels).toContain("Log out");
    expect(labels).toContain("Thinking");
    expect(labels.some((l) => l.includes("Show extension logs"))).toBe(false);
    expect(types(h.posted)).not.toContain("checkGrokUpdate");
    const thinking = slashItem(h.doc, "Thinking");
    expect(thinking.querySelector(".slash-toggle")?.className).toContain("on");
    click(h.window, thinking);
    expect(h.doc.body.className).toContain("hide-thinking");
    expect((h.doc.getElementById("slash-popover") as any).hidden).toBe(false);
  });
  it("Config & debug exposes the config links and posts the right message", () => {
    const h = boot();
    click(h.window, $(h.doc, "slash-btn"));
    click(h.window, slashItem(h.doc, "Config & debug"));
    const labels = items(h.doc).map((el) => el.textContent || "");
    expect(labels.some((l) => l.includes("Open global config"))).toBe(true);
    expect(labels.some((l) => l.includes("Open project config"))).toBe(true);
    expect(labels.some((l) => l.includes("MCP servers"))).toBe(true);
    expect(labels.some((l) => l.includes("Skills folder"))).toBe(true);
    expect(labels.some((l) => l.includes("Show extension logs"))).toBe(false);
    click(h.window, itemByText(h.doc, "Skills folder"));
    expect(types(h.posted)).toContain("openSkillsFolder");
  });
});

describe("LaTeX math rendering", () => {
  const renderAgent = (text: string) => {
    const { doc, window } = bootWebview();
    dispatch(window, { type: "messageChunk", text });
    dispatch(window, { type: "promptComplete" });
    return doc.querySelector(".msg.agent") as HTMLElement;
  };
  it("renders inline \\(...\\) math as a math node, not raw delimiters", () => {
    const el = renderAgent("The area is \\(\\pi r^2\\) exactly.");
    const math = el.querySelector(".math-raw");
    expect(math).not.toBeNull();
    expect(math!.textContent).toBe("\\pi r^2");
    expect(el.textContent).not.toContain("\\(");
    expect(el.textContent).not.toContain("\\)");
  });
  it("renders display \\[...\\] math as a block", () => {
    const el = renderAgent("Result:\n\\[E = mc^2\\]\ndone");
    const math = el.querySelector(".math-raw.math-display");
    expect(math).not.toBeNull();
    expect(math!.textContent).toBe("E = mc^2");
  });
  it("preserves a matrix (backslashes + braces) through the markdown pipeline", () => {
    const el = renderAgent("\\[\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\\]");
    const math = el.querySelector(".math-raw.math-display") as HTMLElement;
    expect(math).not.toBeNull();
    expect(math.textContent).toContain("\\begin{pmatrix}");
    expect(math.textContent).toContain("&");
  });
  it("leaves prose with bare dollar amounts untouched", () => {
    const el = renderAgent("it costs $5 and then $10");
    expect(el.querySelector(".math-raw")).toBeNull();
    expect(el.textContent).toContain("it costs $5 and then $10");
  });
  it("strips \\label{...} so an align block does not render a visible label marker", () => {
    const el = renderAgent(
      "\\[\\begin{align} f(x) &= x^2 \\label{eq:quadratic} \\\\ f'(x) &= 2x \\end{align}\\]",
    );
    const math = el.querySelector(".math-raw.math-display") as HTMLElement;
    expect(math).not.toBeNull();
    expect(math.textContent).not.toContain("\\label");
    expect(math.textContent).not.toContain("eq:quadratic");
    expect(math.textContent).toContain("\\begin{align}");
    expect(math.textContent).toContain("f(x) &= x^2");
  });
});

describe("Mermaid diagram rendering", () => {
  const renderAgent = (text: string) => {
    const { doc, window } = bootWebview();
    dispatch(window, { type: "messageChunk", text });
    dispatch(window, { type: "promptComplete" });
    return doc.querySelector(".msg.agent") as HTMLElement;
  };
  it("turns a ```mermaid fence into a .mermaid-block, not a plain code block", () => {
    const el = renderAgent(
      "Here:\n```mermaid\nflowchart TD\n    A[Start] --> B[End]\n```\ndone",
    );
    const block = el.querySelector(".mermaid-block");
    expect(block).not.toBeNull();
    expect(block!.getAttribute("data-mermaid-state")).toBeNull();
  });
  it("keeps the diagram source readable in the fallback", () => {
    const el = renderAgent("```mermaid\nsequenceDiagram\n    A->>B: hi\n```");
    const src = el.querySelector(".mermaid-block .mermaid-src") as HTMLElement;
    expect(src).not.toBeNull();
    expect(src.textContent).toContain("sequenceDiagram");
    expect(src.textContent).toContain("A->>B: hi");
  });
  it("leaves a non-mermaid fenced block as a normal code block", () => {
    const el = renderAgent("```js\nconst x = 1;\n```");
    expect(el.querySelector(".mermaid-block")).toBeNull();
    const code = el.querySelector(".code-block") as HTMLElement;
    expect(code).not.toBeNull();
    expect(code.textContent).toContain("const x = 1;");
  });
  it("does not treat a half-streamed (unclosed) mermaid fence as a diagram", () => {
    const el = renderAgent("```mermaid\nflowchart TD\n    A --> B");
    expect(el.querySelector(".mermaid-block")).toBeNull();
    expect(el.textContent).toContain("flowchart TD");
  });
});

describe("math / diagram export actions (step b)", () => {
  const renderAgent = (window: any, text: string) => {
    dispatch(window, { type: "messageChunk", text });
    dispatch(window, { type: "promptComplete" });
    return window.document.querySelector(".msg.agent") as HTMLElement;
  };
  it("wraps display math in an export host offering Copy only (KaTeX is HTML, not SVG)", () => {
    const { window } = bootWebview();
    const el = renderAgent(window, "Result:\n\\[E = mc^2\\]\ndone");
    const host = el.querySelector(".math-export") as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.getAttribute("data-export-kind")).toBe("latex");
    expect(host.getAttribute("data-export-src")).toBe("E = mc^2");
    const acts = [...host.querySelectorAll(".expr-btn")].map((b) => b.getAttribute("data-expr-act"));
    expect(acts).toEqual(["copy"]);
  });
  it("does NOT add export actions to inline math", () => {
    const { window } = bootWebview();
    const el = renderAgent(window, "area is \\(\\pi r^2\\) ok");
    expect(el.querySelector(".math-export")).toBeNull();
    expect(el.querySelector(".expr-actions")).toBeNull();
  });
  it("Copy writes the original source TeX to the clipboard", () => {
    const { window } = bootWebview();
    let copied: string | null = null;
    Object.defineProperty((window as any).navigator, "clipboard", {
      value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } },
      configurable: true,
    });
    const el = renderAgent(window, "\\[a^2 + b^2 = c^2\\]");
    const copyBtn = el.querySelector('.expr-btn[data-expr-act="copy"]') as HTMLElement;
    click(window, copyBtn);
    expect(copied).toBe("a^2 + b^2 = c^2");
  });
  it("Download on a rendered diagram posts an exportExpr with transparent dark + light SVG variants", async () => {
    const { window, posted } = bootWebview();
    const doc = (window as any).document;
    const host = doc.createElement("div");
    host.className = "mermaid-block";
    host.setAttribute("data-export-kind", "mermaid");
    host.setAttribute("data-export-src", "graph TD; A-->B");
    host.appendChild(doc.createElementNS("http://www.w3.org/2000/svg", "svg"));
    const btn = doc.createElement("button");
    btn.className = "expr-btn";
    btn.setAttribute("data-expr-act", "download");
    host.appendChild(btn);
    doc.body.appendChild(host);
    click(window, btn);
    await new Promise((r) => setTimeout(r, 0));
    const msg = posted.find((p) => p.type === "exportExpr");
    expect(msg).toBeTruthy();
    expect(msg!.action).toBe("download");
    expect(msg!.kind).toBe("mermaid");
    expect(typeof msg!.svgDark).toBe("string");
    expect(typeof msg!.svgLight).toBe("string");
    expect(msg!.svgDark as string).not.toContain("background:");
  });
});
