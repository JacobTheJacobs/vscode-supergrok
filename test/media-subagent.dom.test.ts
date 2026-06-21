import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

const messages = (doc: Document) => doc.getElementById("messages") as HTMLElement;

const IMG_DATA = "data:image/jpeg;base64,/9j/AAAQSkZJRg==";
const VIDEO_DATA = "data:video/mp4;base64,AAAAIGZ0eXBpc29t";

describe("addGeneratedMedia (/imagine image)", () => {
  it("inlines a generated image as a clickable <img> with the data: src", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, {
      type: "media",
      media: "image",
      src: IMG_DATA,
      path: "/sessions/abc/images/cat.jpg",
    });
    const wrap = messages(doc).querySelector(".generated-image");
    expect(wrap).not.toBeNull();
    expect(wrap!.classList.contains("generated-video")).toBe(false);
    const img = wrap!.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(IMG_DATA);
    click(window, img);
    expect(posted).toContainEqual({ type: "openFile", path: "/sessions/abc/images/cat.jpg" });
  });
});

describe("addGeneratedMedia (/imagine-video video)", () => {
  it("inlines a generated video as <video controls>, not an <img>", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "media",
      media: "video",
      src: VIDEO_DATA,
      path: "/sessions/abc/videos/clip.mp4",
    });
    const wrap = messages(doc).querySelector(".generated-image.generated-video");
    expect(wrap).not.toBeNull();
    const video = wrap!.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe(VIDEO_DATA);
    expect(video.controls).toBe(true);
    expect(wrap!.querySelector("img")).toBeNull();
  });
});

describe("addGeneratedMedia hover actions (copy path / open in VS Code)", () => {
  const btnByTitle = (wrap: Element, title: string) =>
    [...wrap.querySelectorAll(".generated-media-btn")].find(
      (b) => b.getAttribute("title") === title,
    ) as HTMLButtonElement | undefined;
  it("an image exposes copy-path + open icons; the open icon posts openFile", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, { type: "media", media: "image", src: IMG_DATA, path: "/sessions/abc/images/cat.jpg" });
    const wrap = messages(doc).querySelector(".generated-image")!;
    expect(btnByTitle(wrap, "Copy path")).toBeTruthy();
    const openBtn = btnByTitle(wrap, "Open in VS Code")!;
    expect(openBtn).toBeTruthy();
    click(window, openBtn);
    expect(posted).toContainEqual({ type: "openFile", path: "/sessions/abc/images/cat.jpg" });
  });
  it("a video — which has no click-to-open — still exposes the open icon", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, { type: "media", media: "video", src: VIDEO_DATA, path: "/sessions/abc/videos/clip.mp4" });
    const wrap = messages(doc).querySelector(".generated-image.generated-video")!;
    const openBtn = btnByTitle(wrap, "Open in VS Code")!;
    expect(openBtn).toBeTruthy();
    click(window, openBtn);
    expect(posted).toContainEqual({ type: "openFile", path: "/sessions/abc/videos/clip.mp4" });
  });
  it("copy-path writes the on-disk path to the clipboard", () => {
    const { window, doc } = bootWebview();
    let copied = "";
    Object.defineProperty((window as any).navigator, "clipboard", {
      value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } },
      configurable: true,
    });
    dispatch(window, { type: "media", media: "image", src: IMG_DATA, path: "/sessions/abc/images/cat.jpg" });
    const wrap = messages(doc).querySelector(".generated-image")!;
    click(window, btnByTitle(wrap, "Copy path")!);
    expect(copied).toBe("/sessions/abc/images/cat.jpg");
  });
  it("the remote-link fallback (no on-disk path) has no hover actions", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "media", media: "image", url: "https://x.ai/generated/cat.jpg" });
    const wrap = messages(doc).querySelector(".generated-image")!;
    expect(wrap.querySelector(".generated-media-actions")).toBeNull();
  });
});

describe("addGeneratedMedia (remote link fallback)", () => {
  it("renders an open-link button (not an <img>) when only a url is supplied", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, { type: "media", media: "image", url: "https://x.ai/generated/cat.jpg" });
    const wrap = messages(doc).querySelector(".generated-image")!;
    expect(wrap.querySelector("img")).toBeNull();
    const link = wrap.querySelector(".preview-link") as HTMLButtonElement;
    expect(link).not.toBeNull();
    click(window, link);
    expect(posted).toContainEqual({ type: "openUrl", url: "https://x.ai/generated/cat.jpg" });
  });
});

describe("addSubagentCard (spawn_subagent tool call)", () => {
  it("renders a 'Subagent: <type>' card and skips the generic tool group", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "sa-1",
        title: "spawn_subagent",
        rawInput: { subagent_type: "general-purpose", prompt: "investigate the parser" },
      },
    });
    const card = messages(doc).querySelector(".subagent-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Subagent: general-purpose");
    expect(messages(doc).querySelector(".tool-group")).toBeNull();
  });
  it("renders a card for grok 0.2.x's background-task delegation (real subagent mechanism)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "bg-1",
        title: "run_terminal_command",
        rawInput: { variant: "Bash", command: "investigate the parser", is_background: true },
      },
    });
    const card = messages(doc).querySelector(".subagent-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Subagent: investigate the parser");
    expect(messages(doc).querySelector(".tool-group")).toBeNull();
  });
  it("an ordinary (foreground) tool call still goes to the tool group, not a subagent card", () => {
    const { window, doc } = bootWebview();
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "t-1", title: "read_file", kind: "read", rawInput: { path: "a.ts" } },
    });
    expect(messages(doc).querySelector(".tool-group")).not.toBeNull();
    expect(messages(doc).querySelector(".subagent-card")).toBeNull();
  });
});
