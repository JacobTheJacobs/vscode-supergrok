export function planReviewFileBaseName(plan: string): string {
  const firstLine = String(plan || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !/^status\s*:/i.test(line));
  if (!firstLine) return "plan";
  const namedPrefix = firstLine.match(/^([a-z0-9][a-z0-9._ -]{0,60})\s*:/i);
  return sanitizePlanReviewFilePart(namedPrefix ? namedPrefix[1] : firstLine).slice(0, 80) || "plan";
}

export function sanitizePlanReviewFilePart(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "plan";
}
