import { describe, expect, it } from "vitest";
import { planReviewFileBaseName, sanitizePlanReviewFilePart } from "../src/plan/review";

describe("planReviewFileBaseName", () => {
  it("uses an explicit plan name prefix as the file base", () => {
    expect(planReviewFileBaseName("plan2: Simple Plan Example\n\n## Context")).toBe("plan2");
  });
  it("uses a markdown heading when no explicit prefix exists", () => {
    expect(planReviewFileBaseName("# Refactor auth helper\n\nSteps...")).toBe("refactor-auth-helper");
  });
  it("skips status lines when picking a useful title", () => {
    expect(planReviewFileBaseName("Status: Ready\n# Add tests")).toBe("add-tests");
  });
});

describe("sanitizePlanReviewFilePart", () => {
  it("creates a filesystem-friendly ascii slug", () => {
    expect(sanitizePlanReviewFilePart("Plan: Review / Copy Path!")).toBe("plan-review-copy-path");
  });
  it("falls back to plan for empty values", () => {
    expect(sanitizePlanReviewFilePart("   ")).toBe("plan");
  });
});
