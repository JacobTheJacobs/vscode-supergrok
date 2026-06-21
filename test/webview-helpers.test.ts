import { describe, it, expect } from "vitest";
// @ts-expect-error — plain JS module, no types
import { looksLikeFileRef, formatRelativeTime, FILE_EXTS, modelDisplayName, buildQuestionAnswers, isSubagentToolCall, subagentLabel, shouldStickToBottom, splitMath, stripUnsupportedTex } from "../media/webview/helpers.js";

describe("looksLikeFileRef", () => {
  it("accepts a bare filename with a known extension", () => {
    expect(looksLikeFileRef("package.json")).toBe(true);
    expect(looksLikeFileRef("CHANGELOG.md")).toBe(true);
    expect(looksLikeFileRef("docs/README.md")).toBe(true);
    expect(looksLikeFileRef("tsconfig.json")).toBe(true);
  });
  it("accepts a path with separators", () => {
    expect(looksLikeFileRef("src/extension/sidebar-provider.ts")).toBe(true);
    expect(looksLikeFileRef("media/webview/app.js")).toBe(true);
    expect(looksLikeFileRef("test\\sessions.test.ts")).toBe(true);
  });
  it("accepts a path with a :line suffix and strips it before checking", () => {
    expect(looksLikeFileRef("src/extension/sidebar-provider.ts:42")).toBe(true);
    expect(looksLikeFileRef("media/webview/app.js:1-100")).toBe(true);
  });
  it("accepts a path with a #Lstart-Lend anchor", () => {
    expect(looksLikeFileRef("src/extension/sidebar-provider.ts#L10-L20")).toBe(true);
  });
  it("is case-insensitive on the extension", () => {
    expect(looksLikeFileRef("Foo.TS")).toBe(true);
    expect(looksLikeFileRef("Bar.Json")).toBe(true);
  });
  it("rejects plain identifiers without an extension", () => {
    expect(looksLikeFileRef("undefined")).toBe(false);
    expect(looksLikeFileRef("null")).toBe(false);
    expect(looksLikeFileRef("foo")).toBe(false);
    expect(looksLikeFileRef("myVariable")).toBe(false);
  });
  it("rejects unknown extensions", () => {
    expect(looksLikeFileRef("foo.unknownextname")).toBe(false);
    expect(looksLikeFileRef("foo.xyz")).toBe(false);
  });
  it("rejects strings with whitespace or shell metacharacters", () => {
    expect(looksLikeFileRef("foo bar.ts")).toBe(false);
    expect(looksLikeFileRef("rm -rf foo.ts")).toBe(false);
    expect(looksLikeFileRef('"foo.ts"')).toBe(false);
    expect(looksLikeFileRef("a;b.ts")).toBe(false);
    expect(looksLikeFileRef("a|b.ts")).toBe(false);
    expect(looksLikeFileRef("a&b.ts")).toBe(false);
  });
  it("rejects empty, null-ish, or absurdly long strings", () => {
    expect(looksLikeFileRef("")).toBe(false);
    expect(looksLikeFileRef(null as unknown as string)).toBe(false);
    expect(looksLikeFileRef(undefined as unknown as string)).toBe(false);
    expect(looksLikeFileRef("a".repeat(201) + ".ts")).toBe(false);
  });
  it("rejects code-looking spans with a trailing dot only", () => {
    expect(looksLikeFileRef("obj.")).toBe(false);
    expect(looksLikeFileRef(".")).toBe(false);
  });
  it("FILE_EXTS exposes the configured set", () => {
    expect(FILE_EXTS.has("ts")).toBe(true);
    expect(FILE_EXTS.has("json")).toBe(true);
    expect(FILE_EXTS.has("lock")).toBe(true);
    expect(FILE_EXTS.has("env")).toBe(true);
    expect(FILE_EXTS.has("gitignore")).toBe(true);
    expect(FILE_EXTS.has("zzz")).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 4, 22, 12, 0, 0);
  it("returns '' for falsy timestamps", () => {
    expect(formatRelativeTime(0, now)).toBe("");
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime(null, now)).toBe("");
  });
  it("formats seconds when under a minute", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("5s ago");
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
  });
  it("formats minutes when under an hour", () => {
    expect(formatRelativeTime(now - 2 * 60_000, now)).toBe("2m ago");
    expect(formatRelativeTime(now - 45 * 60_000, now)).toBe("45m ago");
  });
  it("formats hours when under a day", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 23 * 3_600_000, now)).toBe("23h ago");
  });
  it("formats days when under a week", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatRelativeTime(now - 6 * 86_400_000, now)).toBe("6d ago");
  });
  it("falls back to localeDateString for timestamps older than a week", () => {
    const ts = now - 30 * 86_400_000;
    const out = formatRelativeTime(ts, now);
    expect(out).not.toMatch(/ago$/);
    expect(out.length).toBeGreaterThan(0);
  });
  it("uses Date.now() when no second arg is provided", () => {
    const out = formatRelativeTime(Date.now() - 2_000);
    expect(out).toMatch(/s ago$/);
  });
});

describe("modelDisplayName", () => {
  const models = [
    { modelId: "grok-build", name: "Grok CLI Copilot" },
    { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
  ];
  it("resolves a model ID to its user-facing name", () => {
    expect(modelDisplayName("grok-build", models)).toBe("Grok CLI Copilot");
    expect(modelDisplayName("grok-composer-2.5-fast", models)).toBe("Composer 2.5 Fast");
  });
  it("normalizes the old CLI display name to the Grok CLI Copilot brand", () => {
    expect(modelDisplayName("grok-build", [{ modelId: "grok-build", name: ["Grok", "Build"].join(" ") }])).toBe("Grok CLI Copilot");
  });
  it("falls back to the ID when the model is unknown or unnamed", () => {
    expect(modelDisplayName("grok-mystery", models)).toBe("grok-mystery");
    expect(modelDisplayName("grok-build", [{ modelId: "grok-build" }])).toBe("grok-build");
    expect(modelDisplayName("grok-build", [])).toBe("grok-build");
    expect(modelDisplayName("grok-build", undefined)).toBe("grok-build");
  });
  it("returns '' for a falsy model ID", () => {
    expect(modelDisplayName("", models)).toBe("");
    expect(modelDisplayName(undefined, models)).toBe("");
  });
});

describe("buildQuestionAnswers", () => {
  it("keys the answer map by question text → chosen label", () => {
    const questions = [{ question: "Pick a color?", options: [{ label: "Red" }, { label: "Blue" }] }];
    const { answers, allAnswered } = buildQuestionAnswers(questions, [["Blue"]]);
    expect(answers).toEqual({ "Pick a color?": "Blue" });
    expect(allAnswered).toBe(true);
  });
  it("joins multi-select labels with ', '", () => {
    const questions = [{ question: "Which?", options: [], multiSelect: true }];
    const { answers } = buildQuestionAnswers(questions, [["A", "C"]]);
    expect(answers).toEqual({ "Which?": "A, C" });
  });
  it("flags allAnswered=false while any question is unanswered", () => {
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const r = buildQuestionAnswers(questions, [["A"], []]);
    expect(r.allAnswered).toBe(false);
    expect(r.answers).toEqual({ Q1: "A", Q2: "" });
  });
  it("handles empty / missing inputs", () => {
    expect(buildQuestionAnswers([], [])).toEqual({ answers: {}, allAnswered: true });
    expect(buildQuestionAnswers(undefined, undefined)).toEqual({ answers: {}, allAnswered: true });
  });
});

describe("isSubagentToolCall", () => {
  it("matches grok's confirmed spawn_subagent shape", () => {
    expect(isSubagentToolCall({
      title: "spawn_subagent",
      rawInput: { subagent_type: "general-purpose", prompt: "investigate" },
    })).toBe(true);
  });
  it("matches by tool name", () => {
    expect(isSubagentToolCall({ tool: "task" })).toBe(true);
    expect(isSubagentToolCall({ name: "spawn_agent" })).toBe(true);
    expect(isSubagentToolCall({ name: "run_subagent" })).toBe(true);
    expect(isSubagentToolCall({ title: "Delegate" })).toBe(true);
  });
  it("matches by kind", () => {
    expect(isSubagentToolCall({ kind: "subagent" })).toBe(true);
    expect(isSubagentToolCall({ kind: "agent" })).toBe(true);
  });
  it("matches by rawInput shape", () => {
    expect(isSubagentToolCall({ tool: "x", rawInput: { subagent_type: "tester" } })).toBe(true);
    expect(isSubagentToolCall({ tool: "x", input: { agentType: "reviewer" } })).toBe(true);
  });
  it("does not match ordinary tools", () => {
    expect(isSubagentToolCall({ tool: "read_file", kind: "read" })).toBe(false);
    expect(isSubagentToolCall({ tool: "bash", kind: "execute" })).toBe(false);
    expect(isSubagentToolCall(null)).toBe(false);
    expect(isSubagentToolCall({})).toBe(false);
  });
  it("does NOT match grok's get_command_or_subagent_output poller", () => {
    expect(isSubagentToolCall({ title: "get_command_or_subagent_output", rawInput: { task_id: "t1" } })).toBe(false);
    expect(isSubagentToolCall({ title: "Get task output: t1", rawInput: { variant: "TaskOutput", task_id: "t1", block: true } })).toBe(false);
  });
  it("matches grok 0.2.x's background-task delegation (its real subagent mechanism)", () => {
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "Spawn background subagent to investigate", is_background: true } })).toBe(true);
    expect(isSubagentToolCall({ title: "[bg] Background task t1 started", rawInput: { variant: "Bash" } })).toBe(true);
  });
  it("does NOT match a foreground run_terminal_command", () => {
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "git status", is_background: false } })).toBe(false);
    expect(isSubagentToolCall({ title: "run_terminal_command", rawInput: { variant: "Bash", command: "git status" } })).toBe(false);
  });
});

describe("subagentLabel", () => {
  it("prefers the named agent type", () => {
    expect(subagentLabel({ title: "spawn_subagent", rawInput: { subagent_type: "general-purpose" } })).toBe("general-purpose");
    expect(subagentLabel({ tool: "task", rawInput: { subagent_type: "tester" } })).toBe("tester");
    expect(subagentLabel({ tool: "task", input: { agentType: "Explore" } })).toBe("Explore");
    expect(subagentLabel({ tool: "task", rawInput: { description: "Fix the build" } })).toBe("Fix the build");
  });
  it("derives a label from the backgrounded command, truncating if long", () => {
    expect(subagentLabel({ title: "run_terminal_command", rawInput: { command: "investigate the parser", is_background: true } })).toBe("investigate the parser");
    const long = subagentLabel({ rawInput: { command: "x".repeat(80), is_background: true } });
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(48);
  });
  it("falls back to a generic label", () => {
    expect(subagentLabel({ tool: "task" })).toBe("Subagent");
    expect(subagentLabel({ rawInput: { is_background: true } })).toBe("background task");
    expect(subagentLabel(null)).toBe("Subagent");
  });
});

describe("shouldStickToBottom", () => {
  it("is pinned when scrolled exactly to the bottom", () => {
    expect(shouldStickToBottom(900, 1000, 100)).toBe(true);
  });
  it("is pinned when within the default threshold of the bottom", () => {
    expect(shouldStickToBottom(870, 1000, 100)).toBe(true);
  });
  it("is NOT pinned once scrolled up past the threshold", () => {
    expect(shouldStickToBottom(700, 1000, 100)).toBe(false);
  });
  it("is pinned when content fits without scrolling", () => {
    expect(shouldStickToBottom(0, 80, 100)).toBe(true);
  });
  it("honors a custom threshold", () => {
    expect(shouldStickToBottom(750, 1000, 100, 200)).toBe(true);
    expect(shouldStickToBottom(750, 1000, 100, 50)).toBe(false);
  });
});

describe("splitMath", () => {
  it("returns the whole string as one text segment when there is no math", () => {
    expect(splitMath("just plain prose with no tex")).toEqual([
      { type: "text", value: "just plain prose with no tex" },
    ]);
  });
  it("extracts inline \\(...\\) math with display:false", () => {
    expect(splitMath("the value \\(x^2\\) here")).toEqual([
      { type: "text", value: "the value " },
      { type: "math", value: "x^2", display: false },
      { type: "text", value: " here" },
    ]);
  });
  it("extracts display \\[...\\] math with display:true", () => {
    expect(splitMath("before\n\\[E = mc^2\\]\nafter")).toEqual([
      { type: "text", value: "before\n" },
      { type: "math", value: "E = mc^2", display: true },
      { type: "text", value: "\nafter" },
    ]);
  });
  it("treats $$...$$ as display math", () => {
    expect(splitMath("$$a+b$$")).toEqual([
      { type: "math", value: "a+b", display: true },
    ]);
  });
  it("handles multiple math spans in one string", () => {
    const segs = splitMath("\\(a\\) and \\(b\\) then \\[c\\]");
    expect(segs.map((s) => s.type)).toEqual(["math", "text", "math", "text", "math"]);
    expect(segs.filter((s) => s.type === "math").map((s) => s.display)).toEqual([
      false,
      false,
      true,
    ]);
  });
  it("supports multi-line display math (e.g. matrices)", () => {
    const src = "\\[\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\\]";
    const segs = splitMath(src);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("math");
    expect(segs[0].display).toBe(true);
    expect(segs[0].value).toContain("\\begin{pmatrix}");
  });
  it("does NOT treat bare dollar amounts as math", () => {
    expect(splitMath("it costs $5 and then $10 total")).toEqual([
      { type: "text", value: "it costs $5 and then $10 total" },
    ]);
  });
  it("leaves empty delimiters as literal text", () => {
    expect(splitMath("a \\(\\) b")).toEqual([
      { type: "text", value: "a \\(\\) b" },
    ]);
  });
  it("coerces null/undefined to an empty result", () => {
    expect(splitMath(null)).toEqual([]);
    expect(splitMath(undefined)).toEqual([]);
  });
});

describe("stripUnsupportedTex", () => {
  it("removes \\label{...} because it has no visible output in rendered math", () => {
    expect(stripUnsupportedTex("f(x) = x^2 \\label{eq:quadratic} + 1")).toBe(
      "f(x) = x^2  + 1",
    );
  });
  it("strips every \\label in an align block, leaving the equations intact", () => {
    const src =
      "\\begin{align} a &= b \\label{one} \\\\ c &= d \\label{two} \\end{align}";
    const out = stripUnsupportedTex(src);
    expect(out).not.toContain("\\label");
    expect(out).toContain("\\begin{align}");
    expect(out).toContain("a &= b");
    expect(out).toContain("c &= d");
  });
  it("tolerates whitespace before the brace", () => {
    expect(stripUnsupportedTex("x \\label {foo} y")).toBe("x  y");
  });
  it("leaves math without \\label unchanged", () => {
    const src = "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}";
    expect(stripUnsupportedTex(src)).toBe(src);
  });
  it("coerces null/undefined to an empty string", () => {
    expect(stripUnsupportedTex(null)).toBe("");
    expect(stripUnsupportedTex(undefined)).toBe("");
  });
});
