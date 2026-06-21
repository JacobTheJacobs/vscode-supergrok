const AUTH_REQUIRED_RE = /you are not authenticated|not authenticated|reauth|sign.?in|login required|please log in/i;

export function isCliAuthRequiredOutput(value: unknown): boolean {
  if (!value) return false;
  return AUTH_REQUIRED_RE.test(String(value));
}
