import { describe, it, expect } from "vitest";
import { GROK_PRIMER, PRIMER_MARKER, isPrimerText } from "../src/plan/primer";

const legacyPrimerProduct = ["grok", "build-vscode"].join("-");
const oldPrimer = (version: number, suffix = "") => `[${legacyPrimerProduct} primer v${version}]${suffix}`;

describe("isPrimerText (host-side replay detection)", () => {
  it("matches the current primer message", () => {
    expect(isPrimerText(GROK_PRIMER)).toBe(true);
    expect(isPrimerText(PRIMER_MARKER)).toBe(true);
  });
  it("matches any current primer version (v1, v2, … v17) for forward/back compat", () => {
    expect(isPrimerText("[vscode-supergrok primer v1]\n\nold")).toBe(true);
    expect(isPrimerText("[vscode-supergrok primer v2] whatever")).toBe(true);
    expect(isPrimerText("[vscode-supergrok primer v17] some future primer")).toBe(true);
  });
  it("still matches legacy primer markers from saved sessions", () => {
    expect(isPrimerText(oldPrimer(1, "\n\nold"))).toBe(true);
    expect(isPrimerText(oldPrimer(2, " whatever"))).toBe(true);
    expect(isPrimerText(oldPrimer(17, " some future primer"))).toBe(true);
  });
  it("tolerates leading whitespace (chunked replay can prepend a newline)", () => {
    expect(isPrimerText("\n  [vscode-supergrok primer v3] body")).toBe(true);
  });
  it("does not match a normal user message", () => {
    expect(isPrimerText("implement the login form")).toBe(false);
    expect(isPrimerText("")).toBe(false);
    expect(isPrimerText(undefined as unknown as string)).toBe(false);
  });
  it("only matches the marker at the START — a marker pasted mid-message is not a primer", () => {
    expect(isPrimerText("here is what I copied: [vscode-supergrok primer v3]")).toBe(false);
  });
  it("does not match a near-miss marker (wrong name / no version)", () => {
    expect(isPrimerText("[vscode-supergrok primer]")).toBe(false);
    expect(isPrimerText("[some-other primer v3]")).toBe(false);
  });
});

describe("GROK_PRIMER content (v5 — trimmed to stop pre-turn exploration)", () => {
  it("is marked v5 and starts with the marker", () => {
    expect(PRIMER_MARKER).toBe("[vscode-supergrok primer v5]");
    expect(GROK_PRIMER.startsWith(PRIMER_MARKER)).toBe(true);
    expect(isPrimerText(GROK_PRIMER)).toBe(true);
  });
  it("dropped the product/repo paragraph that invited workspace exploration", () => {
    expect(GROK_PRIMER).not.toMatch(/open source repo/i);
    expect(GROK_PRIMER).not.toMatch(/Grok\s+Build VS Code extension/i);
    expect(GROK_PRIMER).not.toMatch(new RegExp(legacyPrimerProduct, "i"));
    expect(GROK_PRIMER).not.toMatch(/https?:\/\//);
    expect(GROK_PRIMER).not.toMatch(/marketplace/i);
  });
  it("dropped 'Acknowledge briefly' (which licensed a verify-by-exploring turn)", () => {
    expect(GROK_PRIMER).not.toMatch(/acknowledge briefly/i);
  });
  it("adds an explicit do-NOT-act constraint and a one-word reply", () => {
    expect(GROK_PRIMER).toMatch(/do not use any tools/i);
    expect(GROK_PRIMER).toMatch(/do not read any files/i);
    expect(GROK_PRIMER).toMatch(/do not search the workspace/i);
    expect(GROK_PRIMER).toMatch(/do not take any action/i);
    expect(GROK_PRIMER).toMatch(/Reply with exactly: ok/);
  });
  it("still teaches the full plan-verdict protocol (the reason the primer exists)", () => {
    expect(GROK_PRIMER).toContain("exit_plan_mode");
    expect(GROK_PRIMER).toContain("[Plan approved]");
    expect(GROK_PRIMER).toContain("[Plan rejected]");
    expect(GROK_PRIMER).toContain("[Plan cancelled]");
    expect(GROK_PRIMER).toMatch(/Do not trust the tool result/i);
  });
  it("flags itself as a hidden system message to keep out of summaries", () => {
    expect(GROK_PRIMER).toMatch(/system message, not a user request/i);
  });
});
