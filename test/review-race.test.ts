import { describe, it, expect, vi } from "vitest";

const shown: string[] = [];
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: (m: string) => {
      shown.push(m);
      return Promise.resolve(undefined);
    },
  },
  env: { openExternal: () => {} },
  Uri: { parse: (s: string) => s },
}));

const { noteCompletedTurn, _reset, _internals } = await import("../src/extension/review-prompt");

/**
 * globalState.update returns a Thenable. VS Code does not promise the value is
 * readable before it resolves, so model a deferred write — that is where a
 * "once, ever" guarantee usually breaks.
 */
function asyncContext() {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
      update: (k: string, v: unknown) =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            store.set(k, v);
            resolve();
          }, 5)
        ),
    },
  } as any;
}

async function reachThreshold(ctx: any, stopShortBy = 1) {
  for (let i = 0; i < _internals.TURNS_BEFORE_ASKING - stopShortBy; i++) {
    noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 6));
  }
}

describe("review prompt: concurrent turns", () => {
  it("asks once when two turns finish before the flag is written", async () => {
    shown.length = 0;
    const ctx = asyncContext();
    _reset(ctx);
    await reachThreshold(ctx);
    // Two sessions complete in the same tick — neither write has landed yet.
    noteCompletedTurn(ctx);
    noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 60));
    expect(shown).toHaveLength(1);
  });

  it("asks once when several turns land at once", async () => {
    shown.length = 0;
    const ctx = asyncContext();
    _reset(ctx);
    await reachThreshold(ctx);
    for (let i = 0; i < 5; i++) noteCompletedTurn(ctx);
    await new Promise((r) => setTimeout(r, 60));
    expect(shown).toHaveLength(1);
  });

  it("survives a globalState that rejects", async () => {
    shown.length = 0;
    const ctx = {
      globalState: {
        get: () => 0,
        update: () => Promise.reject(new Error("storage unavailable")),
      },
    } as any;
    // Must not throw into the turn that called it.
    expect(() => noteCompletedTurn(ctx)).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});
