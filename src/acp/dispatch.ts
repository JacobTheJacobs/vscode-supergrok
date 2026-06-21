export type DispatchEvent =
  | { kind: "response"; id: number | string; result?: any; error?: any }
  | { kind: "session-update"; update: any }
  | { kind: "server-request"; id?: number | string; method: string; params: any }
  | { kind: "non-json"; line: string };

export function parseAcpLine(line: string): DispatchEvent | null {
  if (!line.trim()) return null;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: "non-json", line };
  }
  if (msg.id != null && msg.method == null) {
    return { kind: "response", id: msg.id, result: msg.result, error: msg.error };
  }
  if (msg.method === "session/update") {
    return { kind: "session-update", update: msg.params?.update };
  }
  if (msg.method) {
    return { kind: "server-request", id: msg.id, method: msg.method, params: msg.params };
  }
  return null;
}

export type MediaKind = "image" | "video";
export type MediaRef =
  | { media: MediaKind; kind: "data"; mimeType: string; data: string }
  | { media: MediaKind; kind: "path"; path: string; mimeType?: string }
  | { media: MediaKind; kind: "uri"; uri: string; mimeType?: string };

export type UpdateRoute =
  | { event: "messageChunk"; text: string }
  | { event: "userMessageChunk"; text: string }
  | { event: "thoughtChunk"; text: string }
  | { event: "mediaContent"; media: MediaRef }
  | { event: "toolCall"; payload: any }
  | { event: "toolCallUpdate"; payload: any }
  | { event: "plan"; payload: any }
  | { event: "modeChanged"; modeId: string }
  | { event: "commandsUpdate"; commands: any[] }
  | { event: "update"; payload: any };

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)$/i;

const MEDIA_PATH_IN_TEXT_RE =
  /(?:\\\\\?\\)?(?:[A-Za-z]:[\\/]|\/|\\\\)[^\r\n"'<>|?*]*?\.(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v)(?=$|[\s.,;:)"'\]])/gi;

function cleanMediaPath(p: string): string {
  return p.replace(/^\\\\\?\\/, "");
}

function isImageMime(m: unknown): boolean {
  return typeof m === "string" && m.toLowerCase().startsWith("image/");
}

function mediaKindForPath(p: string): MediaKind | null {
  if (IMAGE_EXT_RE.test(p)) return "image";
  if (VIDEO_EXT_RE.test(p)) return "video";
  return null;
}

function refFromUri(media: MediaKind, uri: string, mimeType?: string): MediaRef {
  if (uri.startsWith("file://")) {
    try {
      return { media, kind: "path", path: decodeURIComponent(new URL(uri).pathname), mimeType };
    } catch {
      return { media, kind: "path", path: uri.replace(/^file:\/\//, ""), mimeType };
    }
  }
  if (/^[a-z]+:\/\//i.test(uri)) return { media, kind: "uri", uri, mimeType };
  return { media, kind: "path", path: uri, mimeType };
}

export function extractImageContent(block: any): MediaRef | null {
  if (!block || typeof block !== "object") return null;
  if (block.type === "image" && typeof block.data === "string") {
    return { media: "image", kind: "data", mimeType: block.mimeType || "image/png", data: block.data };
  }
  if (block.type === "resource" && block.resource && typeof block.resource === "object") {
    const r = block.resource;
    if (typeof r.blob === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(String(r.uri ?? "")))) {
      return { media: "image", kind: "data", mimeType: isImageMime(r.mimeType) ? r.mimeType : "image/png", data: r.blob };
    }
    if (typeof r.uri === "string" && (isImageMime(r.mimeType) || IMAGE_EXT_RE.test(r.uri))) {
      return refFromUri("image", r.uri, isImageMime(r.mimeType) ? r.mimeType : undefined);
    }
  }
  if (block.type === "resource_link" && typeof block.uri === "string" &&
      (isImageMime(block.mimeType) || IMAGE_EXT_RE.test(block.uri))) {
    return refFromUri("image", block.uri, isImageMime(block.mimeType) ? block.mimeType : undefined);
  }
  return null;
}

export function collectToolImages(payload: any): MediaRef[] {
  const arr = payload?.content;
  if (!Array.isArray(arr)) return [];
  const out: MediaRef[] = [];
  for (const item of arr) {
    const ref = extractImageContent(item?.type === "content" ? item.content : item);
    if (ref) out.push(ref);
  }
  return out;
}

export function isMediaGenToolCall(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  const title = String(payload.title ?? "");
  if (/^imagine(-video|-edit)?:/i.test(title)) return true;
  if (/^(image_gen|image_edit|video_gen|image_to_video|reference_to_video)\b/i.test(title)) return true;
  if (/^(image-to-video:|reference-to-video:)/i.test(title)) return true;
  const ri = payload.rawInput;
  return !!(ri && typeof ri === "object" && typeof ri.variant === "string" &&
    /imagegen|imageedit|videogen|imagetovideo|referencetovideo/i.test(ri.variant));
}

export function extractGeneratedMediaPaths(payload: any): MediaRef[] {
  const arr = payload?.content;
  if (!Array.isArray(arr)) return [];
  const out: MediaRef[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const p = cleanMediaPath(raw);
    const media = mediaKindForPath(p);
    if (media && !seen.has(p)) { seen.add(p); out.push({ media, kind: "path", path: p }); }
  };
  for (const item of arr) {
    const block = item?.type === "content" ? item.content : item;
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    let parsed: any;
    try { parsed = JSON.parse(block.text); } catch {  }
    if (parsed && typeof parsed.path === "string") {
      add(parsed.path);
    } else if (parsed === undefined) {
      for (const m of block.text.matchAll(MEDIA_PATH_IN_TEXT_RE)) add(m[0]);
    }
  }
  return out;
}

export function routeSessionUpdate(u: any): UpdateRoute | null {
  if (!u) return null;
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const c = u.content;
      if (c && c.type && c.type !== "text") {
        const media = extractImageContent(c);
        if (media) return { event: "mediaContent", media };
      }
      return { event: "messageChunk", text: c?.text ?? "" };
    }
    case "user_message_chunk":
      return { event: "userMessageChunk", text: u.content?.text ?? "" };
    case "agent_thought_chunk":
      return { event: "thoughtChunk", text: u.content?.text ?? "" };
    case "tool_call":
      return { event: "toolCall", payload: u };
    case "tool_call_update":
      return { event: "toolCallUpdate", payload: u };
    case "plan":
      return { event: "plan", payload: u };
    case "current_mode_update":
      return { event: "modeChanged", modeId: u.currentModeId };
    case "available_commands_update":
      return { event: "commandsUpdate", commands: u.availableCommands ?? [] };
    default:
      return { event: "update", payload: u };
  }
}

export interface PromptResultMeta {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelId?: string;
}

export function extractPromptMeta(result: any): PromptResultMeta {
  const m = result?._meta ?? {};
  return {
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cachedReadTokens: m.cachedReadTokens,
    reasoningTokens: m.reasoningTokens,
    modelId: m.modelId,
  };
}

export function makePermissionResponse(id: number | string, optionId: string) {
  return {
    jsonrpc: "2.0",
    id,
    result: { outcome: { outcome: "selected", optionId } },
  };
}

export function makeExitPlanResponse(
  id: number | string,
  verdict: "approved" | "abandoned" | "rejected",
) {
  if (verdict === "approved") {
    return { jsonrpc: "2.0", id, result: { outcome: "approved" } };
  }
  const message = verdict === "rejected" ? "User rejected the plan" : "User abandoned the plan";
  return { jsonrpc: "2.0", id, error: { code: -32000, message } };
}

export function makeQuestionResponse(
  id: number | string,
  answers: Record<string, string>,
  annotations: Record<string, { notes?: string; preview?: string }> = {},
) {
  return { jsonrpc: "2.0", id, result: { outcome: "accepted", answers, annotations } };
}

export function makeQuestionCancelledResponse(id: number | string) {
  return { jsonrpc: "2.0", id, result: { outcome: "cancelled" } };
}

export function makeAckResponse(id: number | string, result: any = {}) {
  return { jsonrpc: "2.0", id, result };
}

export function makeRequest(id: number, method: string, params: any) {
  return { jsonrpc: "2.0", id, method, params };
}

export function isIncompatibleAgentError(err: any): boolean {
  if (err?.data?.code === "MODEL_SWITCH_INCOMPATIBLE_AGENT") return true;
  return /requires agent .+ but the active agent/i.test(err?.message ?? "");
}
