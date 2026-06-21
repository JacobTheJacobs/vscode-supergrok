import { describe, it, expect } from "vitest";
import { parseFileRef, shouldReadFileInline, MAX_INLINE_CHIP_BYTES } from "../src/context/file-ref";

describe("parseFileRef", () => {
  it("returns the bare path when there is no line suffix", () => {
    expect(parseFileRef("src/a.ts")).toEqual({ path: "src/a.ts" });
  });
  it("parses a single-line suffix", () => {
    expect(parseFileRef("src/a.ts#L10")).toEqual({ path: "src/a.ts", startLine: 10 });
  });
  it("parses a range suffix, with or without the second L", () => {
    expect(parseFileRef("src/a.ts#L10-L20")).toEqual({ path: "src/a.ts", startLine: 10, endLine: 20 });
    expect(parseFileRef("src/a.ts#L10-20")).toEqual({ path: "src/a.ts", startLine: 10, endLine: 20 });
  });
  it("keeps a literal # in the path when there is no line suffix", () => {
    expect(parseFileRef("C#/foo.ts")).toEqual({ path: "C#/foo.ts" });
  });
  it("separates a literal # in the path from a trailing line suffix", () => {
    expect(parseFileRef("C#/foo.ts#L10")).toEqual({ path: "C#/foo.ts", startLine: 10 });
    expect(parseFileRef("F#/Program.fs#L5-L8")).toEqual({ path: "F#/Program.fs", startLine: 5, endLine: 8 });
  });
  it("handles Windows paths with a # folder", () => {
    expect(parseFileRef("C:\\proj\\C#\\a.cs#L3")).toEqual({ path: "C:\\proj\\C#\\a.cs", startLine: 3 });
  });
});

describe("shouldReadFileInline", () => {
  it("allows files up to the threshold", () => {
    expect(shouldReadFileInline(0)).toBe(true);
    expect(shouldReadFileInline(MAX_INLINE_CHIP_BYTES)).toBe(true);
  });
  it("rejects files larger than the threshold", () => {
    expect(shouldReadFileInline(MAX_INLINE_CHIP_BYTES + 1)).toBe(false);
    expect(shouldReadFileInline(500 * 1024 * 1024)).toBe(false);
  });
});
