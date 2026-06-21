import { describe, expect, it } from "vitest";
import { isCliAuthRequiredOutput } from "../src/extension/auth-state";

describe("isCliAuthRequiredOutput", () => {
  it("detects unauthenticated CLI output", () => {
    expect(isCliAuthRequiredOutput("You are not authenticated.")).toBe(true);
    expect(isCliAuthRequiredOutput("please log in to continue")).toBe(true);
    expect(isCliAuthRequiredOutput("reauth required")).toBe(true);
  });
  it("ignores unrelated startup failures", () => {
    expect(isCliAuthRequiredOutput("ACP request timed out: initialize")).toBe(false);
    expect(isCliAuthRequiredOutput("grok CLI not found")).toBe(false);
    expect(isCliAuthRequiredOutput("MODEL_SWITCH_INCOMPATIBLE_AGENT")).toBe(false);
  });
});
