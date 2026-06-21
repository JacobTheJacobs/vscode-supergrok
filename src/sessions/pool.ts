import { SessionStatus } from "./session-state";

export interface ReapCandidate {
  status: SessionStatus;
  lastActiveAt: number;
  focused: boolean;
}

export interface ReapPolicy {
  maxLive: number;
  idleTtlMs: number;
  now: number;
}

function isEligible(c: ReapCandidate): boolean {
  return !c.focused && (c.status === "idle" || c.status === "done" || c.status === "error");
}

export function selectReapable<T extends ReapCandidate>(candidates: T[], policy: ReapPolicy): T[] {
  const { maxLive, idleTtlMs, now } = policy;
  const eligible = candidates.filter(isEligible);
  const reap = new Set<T>();
  for (const c of eligible) {
    if (now - c.lastActiveAt >= idleTtlMs) reap.add(c);
  }
  let liveCount = candidates.length - reap.size;
  if (liveCount > maxLive) {
    const lru = eligible
      .filter((c) => !reap.has(c))
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    for (const c of lru) {
      if (liveCount <= maxLive) break;
      reap.add(c);
      liveCount--;
    }
  }
  return candidates.filter((c) => reap.has(c));
}

export type Dot = "working" | "needs-you" | "unread" | "error" | "none";

export function computeDot(opts: {
  liveStatus?: SessionStatus;
  unread?: boolean;
  unreadError?: boolean;
}): Dot {
  if (opts.liveStatus === "working") return "working";
  if (opts.liveStatus === "needs-you") return "needs-you";
  if (opts.unread) return opts.unreadError ? "error" : "unread";
  return "none";
}
