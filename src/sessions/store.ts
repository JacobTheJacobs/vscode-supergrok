import * as nodeFs from "node:fs";
import * as path from "node:path";
import { isPrimerText } from "../plan/primer";

export interface SessionListEntry {
  id: string;
  cwd: string;
  displayName: string;
  rawSummary: string;
  customName?: string;
  updatedAt: number;
  createdAt: number;
  numMessages: number;
  modelId?: string;
}

export interface SessionMetaOverride {
  customName?: string;
  pinnedAt?: number;
  lastPlanVerdict?: "approved" | "rejected" | "abandoned";
  plans?: { text: string; verdict: "approved" | "rejected" | "abandoned"; afterUserMessage?: number }[];
  unread?: boolean;
  unreadError?: boolean;
}
export type SessionMetaOverrides = Record<string, SessionMetaOverride>;

export interface FsLike {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: "utf8"): string;
  statSync(p: string): { isDirectory(): boolean };
  rmSync?(p: string, opts?: { recursive?: boolean; force?: boolean }): void;
  rmdirSync(p: string, opts?: { recursive?: boolean }): void;
}

export interface ListDeps {
  fs: FsLike;
  grokHome: string;
  cwd: string;
  overrides: SessionMetaOverrides;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface DeleteDeps {
  fs: FsLike;
  grokHome: string;
  cwd: string;
  id: string;
}

export function sessionsDirFor(grokHome: string, cwd: string): string {
  return path.join(grokHome, "sessions", encodeURIComponent(cwd));
}

export function fallbackName(summary: string, updatedAt: number): string {
  const s = (summary || "").trim();
  if (s) return s.length > 60 ? s.slice(0, 57) + "…" : s;
  const d = new Date(updatedAt || Date.now());
  if (isNaN(d.getTime())) return "Untitled";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `Untitled (${yyyy}-${mm}-${dd} ${hh}:${mi})`;
}

export function isInternalPrimerSummary(summary: string): boolean {
  const s = (summary || "").trim();
  if (!s) return false;
  if (isPrimerText(s)) return true;
  const compact = s.replace(/\s+/g, " ").toLowerCase();
  if (/^super\s*grok primer v\d+/.test(compact)) return true;
  if (/^supergrok primer v\d+/.test(compact)) return true;
  return /\bprimer\b/.test(compact) &&
    /\bplan mode\b/.test(compact) &&
    /\b(super\s*grok|supergrok|vscode-supergrok|grok-build|hidden)\b/.test(compact);
}

function parseTimestamp(s: unknown, fallback: number): number {
  if (typeof s !== "string") return fallback;
  const t = Date.parse(s);
  return isNaN(t) ? fallback : t;
}

export function listSessions(deps: ListDeps): SessionListEntry[] {
  const { fs, grokHome, cwd, overrides, log } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const dir = sessionsDirFor(grokHome, cwd);
  if (!fs.existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    log?.(`[sessions] failed to read ${dir}: ${(e as Error).message}`);
    return [];
  }
  const out: SessionListEntry[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const summaryPath = path.join(full, "summary.json");
    if (!fs.existsSync(summaryPath)) continue;
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    } catch (e) {
      log?.(`[sessions] malformed summary.json in ${full}: ${(e as Error).message}`);
      continue;
    }
    const id = (raw?.info?.id as string) ?? name;
    const sessCwd = (raw?.info?.cwd as string) ?? cwd;
    const rawSummary = typeof raw?.session_summary === "string" ? raw.session_summary : "";
    const displaySummary = isInternalPrimerSummary(rawSummary) ? "" : rawSummary;
    const updatedAt = parseTimestamp(raw?.updated_at, now);
    const createdAt = parseTimestamp(raw?.created_at, updatedAt);
    const numMessages = typeof raw?.num_messages === "number" ? raw.num_messages : 0;
    const modelId = typeof raw?.current_model_id === "string" ? raw.current_model_id : undefined;
    const override = overrides[id];
    const customName = override?.customName?.trim() || undefined;
    const displayName = customName || fallbackName(displaySummary, updatedAt);
    out.push({
      id,
      cwd: sessCwd,
      displayName,
      rawSummary: displaySummary,
      customName,
      updatedAt,
      createdAt,
      numMessages,
      modelId,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function deleteSessionDir(deps: DeleteDeps): void {
  const { fs, grokHome, cwd, id } = deps;
  const dir = path.join(sessionsDirFor(grokHome, cwd), id);
  if (!fs.existsSync(dir)) return;
  if (fs.rmSync) {
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    fs.rmdirSync(dir, { recursive: true });
  }
}

export const defaultFs: FsLike = {
  existsSync: nodeFs.existsSync,
  readdirSync: (p) => nodeFs.readdirSync(p) as string[],
  readFileSync: (p, enc) => nodeFs.readFileSync(p, enc),
  statSync: (p) => nodeFs.statSync(p),
  rmSync: (nodeFs as any).rmSync
    ? (p, opts) => (nodeFs as any).rmSync(p, opts)
    : undefined,
  rmdirSync: (p, opts) => nodeFs.rmdirSync(p, opts as any),
};

export function resolveGrokHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || "";
  return path.join(home, ".grok");
}
