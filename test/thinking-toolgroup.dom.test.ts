import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

const messages = (doc: Document) => doc.getElementById("messages") as HTMLElement;
/** Rendered order of the blocks we care about, top to bottom. */
const blockOrder = (doc: Document) =>
  Array.from(messages(doc).children)
    .map((el) => {
      const c = el.className || "";
      if (c.includes("tool-group")) return "tools";
      if (c.includes("thinking")) return "thinking";
      if (c.includes("msg")) return "msg";
      return null;
    })
    .filter(Boolean);

const toolCall = (id: string, title: string) => ({
  type: "toolCall",
  call: { toolCallId: id, title, kind: "execute", status: "pending", rawInput: { command: title } },
});

describe("tool group placement", () => {
  it("keeps the tool block above the answer that follows it", () => {
    // The bug: text -> tool -> text left the final answer in the FIRST bubble,
    // which sits above the group, so "Ran N commands" trailed the response.
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "messageChunk", text: "Let me check that." });
    dispatch(h.window, toolCall("t1", "grep foo"));
    dispatch(h.window, toolCall("t2", "grep bar"));
    dispatch(h.window, { type: "messageChunk", text: "Here is the answer." });
    dispatch(h.window, { type: "promptComplete", meta: { totalTokens: 10 } });

    expect(blockOrder(h.doc)).toEqual(["msg", "tools", "msg"]);

    const blocks = Array.from(messages(h.doc).children);
    const last = blocks[blocks.length - 1] as HTMLElement;
    expect(last.textContent).toContain("Here is the answer.");
    // The answer must be the final thing on screen, not the tool block.
    expect(last.className).not.toContain("tool-group");
  });

  it("summarises the group once the turn ends", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, toolCall("t1", "grep foo"));
    dispatch(h.window, toolCall("t2", "grep bar"));
    dispatch(h.window, { type: "promptComplete", meta: {} });

    const group = messages(h.doc).querySelector(".tool-group") as HTMLElement;
    expect(group.className).not.toContain("in-progress");
    expect(group.querySelector(".tool-group-label")?.textContent || "").toMatch(/command/i);
  });

  it("does not leave a group spinning after a reset", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, toolCall("t1", "grep foo"));
    dispatch(h.window, { type: "agentReset" });

    const group = messages(h.doc).querySelector(".tool-group") as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.className).not.toContain("in-progress");
  });
});

describe("thinking indicator", () => {
  it("shows a verb with horizontal dots, not an ellipsis label", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "considering the options" });

    const hdr = messages(h.doc).querySelector(".thinking-header") as HTMLElement;
    expect(hdr).toBeTruthy();
    expect(hdr.querySelector(".thinking-verb")?.textContent).toBeTruthy();
    // Three discrete dots, so the label width never reflows mid-animation.
    expect(hdr.querySelectorAll(".thinking-dots span").length).toBe(3);
    expect(hdr.querySelector(".loading-dots")).toBeNull();
  });

  it("shows small counts exactly rather than rounding them to 0K", () => {
    // The pre-existing toK() helper renders 250 as "0K". Reusing it for the
    // token readout made a real count look like zero.
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "x".repeat(1000) }); // ~250 tokens
    const tokens = messages(h.doc).querySelector(".thinking-tokens") as HTMLElement;
    expect(tokens.textContent).not.toContain("0K");
    expect(tokens.textContent).toMatch(/~2\d\d tokens/);
  });

  it("switches to K notation only once there is a thousand", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, {
      type: "providerNotification",
      update: { usage: { totalTokens: 14261 } },
    });
    dispatch(h.window, { type: "thoughtChunk", text: "hi" });
    const tokens = messages(h.doc).querySelector(".thinking-tokens") as HTMLElement;
    expect(tokens.textContent).toContain("14K");
  });

  it("marks each step with a dot on the rail rather than a chevron", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "reasoning" });
    dispatch(h.window, toolCall("t1", "grep foo"));

    // One dot per step: the thinking row and the tool group.
    expect(messages(h.doc).querySelectorAll(".step-dot").length).toBe(2);
    // The chevron is kept for the toggle state but must not be the marker.
    const chevron = messages(h.doc).querySelector(".thinking-chevron") as HTMLElement;
    expect(chevron.hidden).toBe(true);
  });

  it("starts collapsed so the reply is not buried under reasoning", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "a long internal monologue" });

    const body = messages(h.doc).querySelector(".thinking-body") as HTMLElement;
    expect(body.hidden).toBe(true);
    const chevron = messages(h.doc).querySelector(".thinking-chevron") as HTMLElement;
    expect(chevron.textContent).toBe("▶");
  });

  it("expands on click and collapses again", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "reasoning" });

    const hdr = messages(h.doc).querySelector(".thinking-header") as HTMLElement;
    const body = messages(h.doc).querySelector(".thinking-body") as HTMLElement;
    click(h.window, hdr);
    expect(body.hidden).toBe(false);
    click(h.window, hdr);
    expect(body.hidden).toBe(true);
  });

  it("estimates tokens while working and marks them approximate", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "x".repeat(1200) });

    const tokens = messages(h.doc).querySelector(".thinking-tokens") as HTMLElement;
    expect(tokens.textContent).toMatch(/~\d/);
    expect(tokens.textContent).toContain("tokens");
  });

  it("replaces the estimate with real usage from the CLI", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "x".repeat(1200) });
    dispatch(h.window, {
      type: "providerNotification",
      update: { usage: { totalTokens: 14261, outputTokens: 46 } },
    });

    const tokens = messages(h.doc).querySelector(".thinking-tokens") as HTMLElement;
    // Exact numbers carry no tilde.
    expect(tokens.textContent).not.toContain("~");
    expect(tokens.textContent).toMatch(/14/);
  });

  it("settles into elapsed time when the turn completes", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "hmm" });
    dispatch(h.window, { type: "promptComplete", meta: { totalTokens: 100 } });

    const hdr = messages(h.doc).querySelector(".thinking-header") as HTMLElement;
    expect(hdr.querySelector(".thinking-verb")?.textContent).toMatch(/^Thought/);
    // Animation must stop, or the row keeps pulsing after the answer lands.
    expect(hdr.querySelector(".thinking-dots")).toBeNull();
  });

  it("settles the header on reset instead of animating forever", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "hmm" });
    dispatch(h.window, { type: "agentReset" });

    const hdr = messages(h.doc).querySelector(".thinking-header") as HTMLElement;
    expect(hdr.querySelector(".thinking-dots")).toBeNull();
  });

  it("does not carry tokens across turns", () => {
    const h = bootWebview();
    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "x".repeat(4000) });
    dispatch(h.window, { type: "promptComplete", meta: { totalTokens: 100 } });

    dispatch(h.window, { type: "agentStart" });
    dispatch(h.window, { type: "thoughtChunk", text: "y" });

    const headers = messages(h.doc).querySelectorAll(".thinking-header");
    const latest = headers[headers.length - 1] as HTMLElement;
    expect(latest.querySelector(".thinking-tokens")?.textContent || "").toBe("");
  });
});
