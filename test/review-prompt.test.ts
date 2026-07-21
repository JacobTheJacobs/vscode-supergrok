import { describe, it, expect, vi } from "vitest";

/** Minimal ExtensionContext stand-in: only globalState is used. */
function fakeContext() {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
      update: async (k: string, v: unknown) => void store.set(k, v),
    },
    _store: store,
  } as any;
}

const shown: string[] = [];
const opened: string[] = [];
let answer: string | undefined;

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: (msg: string, ...items: string[]) => {
      shown.push(msg);
      return Promise.resolve(answer);
    },
  },
  env: { openExternal: (u: any) => void opened.push(String(u)) },
  Uri: { parse: (s: string) => s },
}));

const { noteCompletedTurn, _internals } = await import("../src/extension/review-prompt");

describe("review prompt", () => {
  it("stays quiet until the user has actually used it", () => {
    shown.length = 0;
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING - 1; i++) noteCompletedTurn(ctx);
    expect(shown).toHaveLength(0);
  });

  it("asks once at the threshold", () => {
    shown.length = 0;
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING; i++) noteCompletedTurn(ctx);
    expect(shown).toHaveLength(1);
  });

  it("never asks a second time, whatever the answer", () => {
    shown.length = 0;
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING * 4; i++) noteCompletedTurn(ctx);
    expect(shown).toHaveLength(1);
  });

  it("counts turns rather than sessions", () => {
    const ctx = fakeContext();
    noteCompletedTurn(ctx);
    noteCompletedTurn(ctx);
    expect(ctx.globalState.get(_internals.TURNS_KEY)).toBe(2);
  });

  it("opens the review page only when asked to", async () => {
    opened.length = 0;
    shown.length = 0;
    answer = "Write a review";
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING; i++) noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(opened[0]).toContain("marketplace.visualstudio.com");
  });

  it("sends an unhappy user to the issue tracker instead", async () => {
    opened.length = 0;
    shown.length = 0;
    answer = "Report a problem";
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING; i++) noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(opened[0]).toContain("github.com");
    expect(opened[0]).not.toContain("marketplace");
  });

  it("opens nothing when declined", async () => {
    opened.length = 0;
    shown.length = 0;
    answer = "No thanks";
    const ctx = fakeContext();
    for (let i = 0; i < _internals.TURNS_BEFORE_ASKING; i++) noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toHaveLength(0);
  });
});
