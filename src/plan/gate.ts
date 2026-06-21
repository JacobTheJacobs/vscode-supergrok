import * as nodePath from "node:path";

export const PLAN_BLOCKED_CODE = -32010;
export const PLAN_BLOCKED_WRITE_MSG =
  "Blocked by Plan mode: approve the plan before writing files in the workspace.";
export const PLAN_BLOCKED_TERMINAL_MSG =
  "Blocked by Plan mode: approve the plan before running commands that may change the workspace.";

function canonical(p: string): { norm: string; windows: boolean } {
  let s = String(p || "").trim();
  const windows = /^[\\/]{2}\?[\\/]/.test(s) || /^[a-zA-Z]:[\\/]/.test(s) || s.includes("\\");
  s = s.replace(/^[\\/]{2}\?[\\/]/, "");
  s = s.replace(/\\/g, "/");
  s = nodePath.posix.normalize(s);
  s = s.replace(/\/+$/, "");
  if (s === "") s = "/";
  return { norm: windows ? s.toLowerCase() : s, windows };
}

function isAbsolutePath(p: string): boolean {
  const s = String(p || "").trim();
  return /^[\\/]{2}\?[\\/]/.test(s) || /^[a-zA-Z]:[\\/]/.test(s) ||
    s.startsWith("/") || s.startsWith("\\");
}

function canonicalTarget(target: string, root: string): { norm: string; windows: boolean } {
  if (isAbsolutePath(target)) return canonical(target);
  const r = canonical(root);
  const t = canonical(target);
  const norm = nodePath.posix.normalize(`${r.norm}/${t.norm}`);
  return { norm: r.windows ? norm.toLowerCase() : norm, windows: r.windows };
}

export function isInsideWorkspace(target: string, root: string): boolean {
  if (!target || !root) return false;
  const t = canonicalTarget(target, root).norm;
  const r = canonical(root).norm;
  if (r === "/" ) return t === "/" || t.startsWith("/");
  return t === r || t.startsWith(r + "/");
}

const MUTATING_KINDS = new Set(["edit", "execute", "delete", "move", "write"]);

export function isMutatingKind(kind: string | undefined): boolean {
  return MUTATING_KINDS.has(String(kind || "").toLowerCase());
}

const UNSAFE_SHELL = /[>&;`{}\r\n]|\$\(|\|\||<\(/;

const READONLY_HEADS = new Set([
  "ls", "dir", "pwd", "cd", "echo", "cat", "type", "head", "tail", "less", "more",
  "grep", "rg", "ag", "ack", "find", "fd", "tree", "wc", "stat", "file", "which",
  "where", "whereis", "basename", "dirname", "realpath", "readlink", "du", "df",
  "printenv", "date", "whoami", "hostname", "uname", "sort", "uniq", "cut",
  "get-childitem", "gci", "get-content", "gc", "get-item", "gi",
  "get-itemproperty", "gp", "test-path", "resolve-path", "rvpa", "get-location", "gl",
  "select-object", "select", "format-table", "ft", "format-list", "fl", "format-wide", "fw",
  "sort-object", "measure-object", "measure", "select-string", "sls", "out-string",
  "get-command", "gcm", "get-help", "get-member", "gm", "compare-object",
]);

const GIT_READONLY = new Set([
  "status", "diff", "log", "show", "ls-files", "ls-tree",
  "rev-parse", "blame", "describe", "shortlog", "cat-file", "name-rev",
  "whatchanged",
]);

const PKG_READONLY = new Set(["ls", "list", "view", "info", "outdated", "why", "show", "audit"]);

const GIT_BRANCH_READONLY_FLAGS = new Set([
  "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--list",
  "--show-current", "--merged", "--no-merged", "--contains", "--no-contains",
  "--points-at", "--color", "--no-color", "--column", "--no-column",
]);
const GIT_BRANCH_READONLY_PREFIXES = ["--format=", "--sort=", "--color=", "--column="];

const GIT_TAG_READONLY_FLAGS = new Set([
  "-l", "--list", "-n", "--contains", "--no-contains", "--points-at",
  "--merged", "--no-merged", "--color", "--no-color", "--column", "--no-column",
]);
const GIT_TAG_READONLY_PREFIXES = ["-n", "--format=", "--sort=", "--color=", "--column="];

const GIT_WRITE_OUTPUT_OPTIONS = [
  "--output=", "--output-directory=",
];

function hasToken(tokens: string[], ...blocked: string[]): boolean {
  return tokens.some((t) => blocked.includes(t));
}

function hasTokenPrefix(tokens: string[], ...prefixes: string[]): boolean {
  return tokens.some((t) => prefixes.some((p) => t.startsWith(p)));
}

function hasGitWriteOption(tokens: string[]): boolean {
  return hasToken(tokens, "--output", "--output-directory", "--ext-diff") ||
    hasTokenPrefix(tokens, ...GIT_WRITE_OUTPUT_OPTIONS);
}

function allReadOnlyOptionTokens(tokens: string[], exact: Set<string>, prefixes: string[]): boolean {
  return tokens.every((t) => exact.has(t) || prefixes.some((p) => t.startsWith(p)));
}

function hasSedInPlace(tokens: string[]): boolean {
  return tokens.some((t) => /^-[a-z]*i([a-z]|\b)/i.test(t) || t.startsWith("--in-place"));
}

function hasOutputOption(tokens: string[]): boolean {
  return hasToken(tokens, "-o", "--output") || hasTokenPrefix(tokens, "--output=");
}

function isReadOnlyGit(tokens: string[]): boolean {
  const sub = (tokens[1] || "").toLowerCase();
  const args = tokens.slice(2).map((t) => t.toLowerCase());
  if (hasGitWriteOption(args)) return false;
  if (sub === "tag") return args.length === 0 ||
    allReadOnlyOptionTokens(args, GIT_TAG_READONLY_FLAGS, GIT_TAG_READONLY_PREFIXES);
  if (sub === "branch") return args.length === 0 ||
    allReadOnlyOptionTokens(args, GIT_BRANCH_READONLY_FLAGS, GIT_BRANCH_READONLY_PREFIXES);
  if (sub === "remote") {
    if (args.length === 0 || allReadOnlyOptionTokens(args, new Set(["-v", "--verbose"]), [])) return true;
    const action = args.find((a) => !a.startsWith("-"));
    return action === "show" || action === "get-url";
  }
  if (sub === "reflog") {
    if (args.length === 0) return true;
    const action = args.find((a) => !a.startsWith("-")) || "show";
    return action === "show";
  }
  if (sub === "config") {
    if (args.length === 0) return false;
    if (args.length === 1 && !args[0].startsWith("-")) return true;
    return hasToken(args, "-l", "--list") ||
      hasTokenPrefix(args, "--get", "--get-regexp", "--show-origin", "--show-scope");
  }
  return GIT_READONLY.has(sub);
}

function isReadOnlyPackageCommand(tokens: string[]): boolean {
  const sub = (tokens[1] || "").toLowerCase();
  const args = tokens.slice(2).map((t) => t.toLowerCase());
  if (!PKG_READONLY.has(sub)) return false;
  if (sub === "audit" && (hasToken(args, "fix") || hasTokenPrefix(args, "--fix"))) return false;
  return true;
}

function isReadOnlyStage(stage: string): boolean {
  const tokens = stage.trim().split(/\s+/);
  if (!tokens[0]) return false;
  const head = tokens[0].toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
  const lowerTokens = tokens.map((t) => t.toLowerCase());
  if (head === "git") {
    return isReadOnlyGit(lowerTokens);
  }
  if (head === "npm" || head === "pnpm" || head === "yarn" || head === "bun") {
    return isReadOnlyPackageCommand(lowerTokens);
  }
  if (head === "node" || head === "python" || head === "python3" || head === "deno") {
    return tokens.length >= 2 && /^(-v|--version|--help|-h)$/.test(tokens[1]);
  }
  if (head === "sed" && hasSedInPlace(lowerTokens.slice(1))) return false;
  if (head === "find" && hasToken(lowerTokens.slice(1), "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls")) return false;
  if (head === "fd" && hasToken(lowerTokens.slice(1), "-x", "--exec", "--exec-batch")) return false;
  if ((head === "sort" || head === "tree") && hasOutputOption(lowerTokens.slice(1))) return false;
  return READONLY_HEADS.has(head);
}

export function isReadOnlyCommand(command: string): boolean {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  if (UNSAFE_SHELL.test(cmd)) return false;
  return cmd.split("|").every(isReadOnlyStage);
}

export interface PlanGateContext {
  active: boolean;
  workspaceRoot: string;
  grokHome?: string;
}

export function shouldBlockWrite(path: string, ctx: PlanGateContext): boolean {
  const isOwnPlanFile = isPlanFileWrite(path) &&
    (!ctx.grokHome || isInsideWorkspace(path, ctx.grokHome));
  return ctx.active && !isOwnPlanFile && isInsideWorkspace(path, ctx.workspaceRoot);
}

export function shouldBlockTerminal(command: string, ctx: PlanGateContext): boolean {
  return ctx.active && !isReadOnlyCommand(command);
}

export function shouldRejectPermission(toolKind: string | undefined, ctx: PlanGateContext): boolean {
  return ctx.active && isMutatingKind(toolKind);
}

export interface PermissionOptionLike {
  optionId: string;
  kind: string;
  name?: string;
}

export function pickRejectOption(options: PermissionOptionLike[]): string | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const exact = options.find((o) => o.kind === "reject_once");
  if (exact) return exact.optionId;
  const anyReject = options.find((o) => /reject|deny|cancel|no/i.test(o.kind));
  return anyReject?.optionId;
}

export function isPlanFileWrite(path: string): boolean {
  return /[\\/]\.grok[\\/]sessions[\\/].*[\\/]plan\.md$/i.test(String(path || ""));
}
