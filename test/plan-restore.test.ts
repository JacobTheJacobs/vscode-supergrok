import { describe, it, expect } from "vitest";
import {
  PlanEntry,
  appendPlanEntry,
  decideRestoreState,
} from "../src/plan/restore";

describe("appendPlanEntry", () => {
  it("creates a new list when none exists (undefined → [entry])", () => {
    const entry: PlanEntry = { text: "P1", verdict: "rejected", afterUserMessage: 1 };
    expect(appendPlanEntry(undefined, entry)).toEqual([entry]);
  });
  it("appends to the existing list in chronological order", () => {
    const existing: PlanEntry[] = [
      { text: "P1", verdict: "rejected", afterUserMessage: 1 },
      { text: "P2", verdict: "approved", afterUserMessage: 3 },
    ];
    const next: PlanEntry = { text: "P3", verdict: "abandoned", afterUserMessage: 5 };
    expect(appendPlanEntry(existing, next)).toEqual([...existing, next]);
  });
  it("does not mutate the caller's array (pure)", () => {
    const existing: PlanEntry[] = [{ text: "P1", verdict: "rejected", afterUserMessage: 1 }];
    const frozen = JSON.stringify(existing);
    appendPlanEntry(existing, { text: "P2", verdict: "approved", afterUserMessage: 2 });
    expect(JSON.stringify(existing)).toBe(frozen);
  });
  it("preserves the exact text the caller hands in (regression: lastPlanText was being wiped)", () => {
    const entry: PlanEntry = {
      text: "# TEST PLAN\n\nSimple content for rejection testing.",
      verdict: "rejected",
      afterUserMessage: 2,
    };
    const result = appendPlanEntry([], entry);
    expect(result[0].text).toBe(entry.text);
  });
  it("tolerates entries without afterUserMessage (legacy compat)", () => {
    const entry: PlanEntry = { text: "P1", verdict: "rejected" };
    const result = appendPlanEntry(undefined, entry);
    expect(result[0].afterUserMessage).toBeUndefined();
  });
});

describe("decideRestoreState", () => {
  it("no saved plans → no plan mode, CLI in act mode", () => {
    expect(decideRestoreState([])).toEqual({ planActive: false, cliMode: "default" });
  });
  it("undefined input (legacy session, never persisted) → no plan mode", () => {
    expect(decideRestoreState(undefined)).toEqual({ planActive: false, cliMode: "default" });
  });
  it("last verdict 'rejected' → restore Plan mode (user was mid-planning)", () => {
    expect(decideRestoreState([
      { text: "P1", verdict: "rejected", afterUserMessage: 1 },
    ])).toEqual({ planActive: true, cliMode: "plan" });
  });
  it("last verdict 'approved' → do NOT restore Plan mode (user said go)", () => {
    expect(decideRestoreState([
      { text: "P1", verdict: "approved", afterUserMessage: 1 },
    ])).toEqual({ planActive: false, cliMode: "default" });
  });
  it("last verdict 'abandoned' → do NOT restore Plan mode (this was the Cancel regression)", () => {
    expect(decideRestoreState([
      { text: "P1", verdict: "abandoned", afterUserMessage: 1 },
    ])).toEqual({ planActive: false, cliMode: "default" });
  });
  it("only the LAST verdict matters — earlier ones are ignored", () => {
    expect(decideRestoreState([
      { text: "P1", verdict: "rejected",  afterUserMessage: 1 },
      { text: "P2", verdict: "rejected",  afterUserMessage: 2 },
      { text: "P3", verdict: "approved",  afterUserMessage: 3 },
    ])).toEqual({ planActive: false, cliMode: "default" });
    expect(decideRestoreState([
      { text: "P1", verdict: "approved", afterUserMessage: 1 },
      { text: "P2", verdict: "rejected", afterUserMessage: 4 },
    ])).toEqual({ planActive: true, cliMode: "plan" });
    expect(decideRestoreState([
      { text: "P1", verdict: "abandoned", afterUserMessage: 1 },
      { text: "P2", verdict: "rejected",  afterUserMessage: 2 },
    ])).toEqual({ planActive: true, cliMode: "plan" });
  });
});

describe("appendPlanEntry + decideRestoreState (full lifecycle scenarios)", () => {
  it("scenario: user rejects, then closes VS Code → restore comes back in Plan mode", () => {
    let plans: PlanEntry[] | undefined;
    plans = appendPlanEntry(plans, { text: "draft 1", verdict: "rejected", afterUserMessage: 1 });
    expect(decideRestoreState(plans).planActive).toBe(true);
  });
  it("scenario: user rejects then approves → restore comes back in Agent mode", () => {
    let plans: PlanEntry[] | undefined;
    plans = appendPlanEntry(plans, { text: "draft 1", verdict: "rejected", afterUserMessage: 1 });
    plans = appendPlanEntry(plans, { text: "draft 2", verdict: "approved", afterUserMessage: 2 });
    expect(decideRestoreState(plans).planActive).toBe(false);
  });
  it("scenario: user rejects then cancels → restore comes back in Agent mode (no plan-mode lock-in)", () => {
    let plans: PlanEntry[] | undefined;
    plans = appendPlanEntry(plans, { text: "draft 1", verdict: "rejected", afterUserMessage: 1 });
    plans = appendPlanEntry(plans, { text: "draft 2", verdict: "abandoned", afterUserMessage: 2 });
    expect(decideRestoreState(plans).planActive).toBe(false);
  });
  it("scenario: legacy session (never persisted) → restore comes back in Agent mode, no surprise gate", () => {
    expect(decideRestoreState(undefined).planActive).toBe(false);
  });
});
