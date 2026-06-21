export type PlanVerdict = "approved" | "rejected" | "abandoned";

export interface PlanEntry {
  text: string;
  verdict: PlanVerdict;
  afterUserMessage?: number;
}

export interface RestoreDecision {
  planActive: boolean;
  cliMode: "plan" | "default";
}

export function appendPlanEntry(current: PlanEntry[] | undefined, entry: PlanEntry): PlanEntry[] {
  return [...(current ?? []), entry];
}

export function decideRestoreState(saved: PlanEntry[] | undefined): RestoreDecision {
  if (!saved || saved.length === 0) return { planActive: false, cliMode: "default" };
  const lastVerdict = saved[saved.length - 1].verdict;
  if (lastVerdict === "rejected") return { planActive: true, cliMode: "plan" };
  return { planActive: false, cliMode: "default" };
}
