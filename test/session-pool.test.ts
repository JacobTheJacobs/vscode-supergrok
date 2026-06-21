import { describe, it, expect } from "vitest";
import { selectReapable, computeDot, ReapCandidate } from "../src/sessions/pool";

type C = ReapCandidate & { id: string };
const c = (id: string, status: C["status"], lastActiveAt: number, focused = false): C => ({
  id,
  status,
  lastActiveAt,
  focused,
});

const HOUR = 60 * 60 * 1000;
const ids = (out: C[]) => out.map((x) => x.id).sort();

describe("selectReapable — TTL", () => {
  it("reaps an eligible session idle past the TTL", () => {
    const now = 10 * HOUR;
    const pool = [c("old", "idle", now - 2 * HOUR), c("fresh", "idle", now - 1000)];
    expect(ids(selectReapable(pool, { maxLive: 8, idleTtlMs: HOUR, now }))).toEqual(["old"]);
  });
  it("treats done and error sessions as eligible for the TTL", () => {
    const now = 10 * HOUR;
    const pool = [c("d", "done", now - 2 * HOUR), c("e", "error", now - 2 * HOUR)];
    expect(ids(selectReapable(pool, { maxLive: 8, idleTtlMs: HOUR, now }))).toEqual(["d", "e"]);
  });
  it("never reaps a working or needs-you session, however stale", () => {
    const now = 100 * HOUR;
    const pool = [c("w", "working", 0), c("n", "needs-you", 0)];
    expect(selectReapable(pool, { maxLive: 8, idleTtlMs: HOUR, now })).toEqual([]);
  });
  it("never reaps the focused session, however stale + idle", () => {
    const now = 100 * HOUR;
    const pool = [c("focused", "idle", 0, true)];
    expect(selectReapable(pool, { maxLive: 8, idleTtlMs: HOUR, now })).toEqual([]);
  });
});

describe("selectReapable — LRU cap", () => {
  it("evicts the least-recently-used eligible sessions to get under the cap", () => {
    const now = HOUR;
    const pool = [
      c("a", "idle", now - 5000),
      c("b", "idle", now - 4000),
      c("c", "idle", now - 3000),
      c("d", "idle", now - 2000),
      c("e", "idle", now - 1000),
    ];
    expect(ids(selectReapable(pool, { maxLive: 3, idleTtlMs: 10 * HOUR, now }))).toEqual(["a", "b"]);
  });
  it("does not reap when at or under the cap", () => {
    const now = HOUR;
    const pool = [c("a", "idle", now - 5000), c("b", "idle", now - 4000)];
    expect(selectReapable(pool, { maxLive: 3, idleTtlMs: 10 * HOUR, now })).toEqual([]);
  });
  it("skips busy + focused sessions when choosing LRU victims (cap may be exceeded)", () => {
    const now = HOUR;
    const pool = [
      c("focused", "idle", 0, true),
      c("busy", "working", 1),
      c("idle1", "idle", now - 3000),
      c("idle2", "idle", now - 2000),
    ];
    expect(ids(selectReapable(pool, { maxLive: 1, idleTtlMs: 10 * HOUR, now }))).toEqual([
      "idle1",
      "idle2",
    ]);
  });
  it("combines TTL and LRU: TTL-expired plus enough LRU to reach the cap", () => {
    const now = 10 * HOUR;
    const pool = [
      c("stale", "idle", now - 2 * HOUR),
      c("a", "idle", now - 5000),
      c("b", "idle", now - 4000),
      c("c", "idle", now - 1000),
    ];
    expect(ids(selectReapable(pool, { maxLive: 2, idleTtlMs: HOUR, now }))).toEqual(["a", "stale"]);
  });
});

describe("computeDot — the dashboard dot color", () => {
  it("live status wins: working → working, needs-you → needs-you", () => {
    expect(computeDot({ liveStatus: "working" })).toBe("working");
    expect(computeDot({ liveStatus: "needs-you" })).toBe("needs-you");
    expect(computeDot({ liveStatus: "working", unread: true })).toBe("working");
    expect(computeDot({ liveStatus: "needs-you", unread: true, unreadError: true })).toBe("needs-you");
  });
  it("unread (no blocking live state) → unread, or error if it errored", () => {
    expect(computeDot({ liveStatus: "done", unread: true })).toBe("unread");
    expect(computeDot({ liveStatus: "done", unread: true, unreadError: true })).toBe("error");
    expect(computeDot({ unread: true })).toBe("unread");
    expect(computeDot({ unread: true, unreadError: true })).toBe("error");
  });
  it("everything at rest collapses to none (gray)", () => {
    expect(computeDot({})).toBe("none");
    expect(computeDot({ liveStatus: "idle" })).toBe("none");
    expect(computeDot({ liveStatus: "done" })).toBe("none");
    expect(computeDot({ liveStatus: "error" })).toBe("none");
    expect(computeDot({ unread: false })).toBe("none");
  });
});
