import { describe, it, expect } from "vitest";
import {
  clearImplicitChips,
  makeExplicitChip,
  makeImplicitChip,
  removeChip,
  toggleChip,
} from "../src/context/chips";

describe("chips", () => {
  it("creates an implicit chip with a stable id", () => {
    const c = makeImplicitChip("/abs/path/foo.ts", "foo.ts");
    expect(c.id).toBe("implicit:/abs/path/foo.ts");
    expect(c.hidden).toBe(false);
    expect(c.selectionStart).toBeUndefined();
  });
  it("creates an explicit chip with a unique id and selection range", () => {
    const c1 = makeExplicitChip("/a.ts", "a.ts", 1, 10);
    const c2 = makeExplicitChip("/a.ts", "a.ts", 1, 10);
    expect(c1.selectionStart).toBe(1);
    expect(c1.selectionEnd).toBe(10);
    expect(c1.id).not.toBe(c2.id);
  });
  it("removeChip removes by id", () => {
    const a = makeImplicitChip("/a", "a");
    const b = makeImplicitChip("/b", "b");
    const result = removeChip([a, b], a.id);
    expect(result).toEqual([b]);
  });
  it("toggleChip flips hidden without mutating", () => {
    const a = makeImplicitChip("/a", "a");
    const result = toggleChip([a], a.id);
    expect(result[0].hidden).toBe(true);
    expect(a.hidden).toBe(false);
    const back = toggleChip(result, a.id);
    expect(back[0].hidden).toBe(false);
  });
  it("toggleChip leaves other chips alone", () => {
    const a = makeImplicitChip("/a", "a");
    const b = makeImplicitChip("/b", "b");
    const result = toggleChip([a, b], a.id);
    expect(result[0].hidden).toBe(true);
    expect(result[1].hidden).toBe(false);
  });
  it("clearImplicitChips removes only implicit ones", () => {
    const imp = makeImplicitChip("/a", "a");
    const exp = makeExplicitChip("/b", "b");
    const result = clearImplicitChips([imp, exp]);
    expect(result).toEqual([exp]);
  });
});
