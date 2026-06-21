import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/context/prompt-builder";
import { makeImplicitChip, makeExplicitChip } from "../src/context/chips";

const deps = {
  readFile: (p: string) => {
    if (p === "/a.ts") return "line1\nline2\nline3\nline4\nline5";
    if (p === "/b.ts") return "X\nY";
    throw new Error("ENOENT " + p);
  },
  extName: (p: string) => {
    const i = p.lastIndexOf(".");
    return i >= 0 ? p.slice(i) : "";
  },
};

describe("buildPrompt", () => {
  it("returns just the text when no chips", () => {
    expect(buildPrompt("hello", [], deps)).toBe("hello");
  });
  it("renders a file-only chip as @ref", () => {
    const out = buildPrompt("explain this", [makeImplicitChip("/a.ts", "src/a.ts")], deps);
    expect(out).toBe("@src/a.ts\n\nexplain this");
  });
  it("renders a selection chip as fenced code", () => {
    const chip = makeExplicitChip("/a.ts", "src/a.ts", 2, 4);
    const out = buildPrompt("what is this", [chip], deps);
    expect(out).toBe(
      "`src/a.ts` (lines 2-4):\n```ts\nline2\nline3\nline4\n```\n\nwhat is this",
    );
  });
  it("skips hidden chips", () => {
    const visible = makeImplicitChip("/a.ts", "a.ts");
    const hidden = { ...makeImplicitChip("/b.ts", "b.ts"), hidden: true };
    expect(buildPrompt("q", [visible, hidden], deps)).toBe("@a.ts\n\nq");
  });
  it("falls back to @ref when readFile throws", () => {
    const chip = makeExplicitChip("/missing.ts", "missing.ts", 1, 5);
    expect(buildPrompt("q", [chip], deps)).toBe("@missing.ts\n\nq");
  });
  it("combines multiple chips", () => {
    const a = makeImplicitChip("/a.ts", "a.ts");
    const b = makeExplicitChip("/b.ts", "b.ts", 1, 2);
    const out = buildPrompt("compare", [a, b], deps);
    expect(out).toBe(
      "@a.ts\n\n`b.ts` (lines 1-2):\n```ts\nX\nY\n```\n\ncompare",
    );
  });
  it("uses empty fence language when no extension", () => {
    const chip = makeExplicitChip("/Makefile", "Makefile", 1, 1);
    const out = buildPrompt("", [chip], {
      readFile: () => "all:\n\techo",
      extName: () => "",
    });
    expect(out).toContain("```\nall:");
  });
  it("embeds image chips as data URL markdown (for vision)", () => {
    const imgChip = {
      ...makeExplicitChip("/s/screenshot.png", "s/screenshot.png"),
      imageData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      imageMime: "image/png",
    };
    const out = buildPrompt("what is in this image?", [imgChip], deps);
    expect(out).toContain("Attached image `s/screenshot.png`");
    expect(out).toContain("data:image/png;base64,iVBORw0KGgo");
    expect(out).toContain("what is in this image?");
  });
});
