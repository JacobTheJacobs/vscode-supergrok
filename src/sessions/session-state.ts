import { AcpClient } from "../acp/client";

export type SessionStatus = "idle" | "working" | "needs-you" | "done" | "error";

export class Session {
  client?: AcpClient;
  autoApprove = false;
  planActive = false;
  afterTurn?: () => Promise<void>;
  hasHistory = false;
  priming = false;
  primed = false;
  primingPromise?: Promise<void>;
  suppressContent = false;
  suppressPlanReject = false;
  lastPlanText = "";
  pendingPlanText = "";
  userMessageCount = 0;
  inUserMessage = false;
  replaying = false;
  activeSessionId?: string;
  titleGenerated = false;
  firstUserMessageForTitle?: string;
  gen = 0;
  status: SessionStatus = "idle";
  lastActiveAt = 0;
  buffer: unknown[] = [];
}
