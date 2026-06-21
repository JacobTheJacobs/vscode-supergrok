export interface FileRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

export function parseFileRef(raw: string): FileRef {
  const m = raw.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/i);
  if (!m) return { path: raw };
  const startLine = m[2] ? Number(m[2]) : undefined;
  if (startLine == null) return { path: m[1] };
  const endLine = m[3] ? Number(m[3]) : undefined;
  return endLine == null ? { path: m[1], startLine } : { path: m[1], startLine, endLine };
}

export const MAX_INLINE_CHIP_BYTES = 10 * 1024 * 1024;

export function shouldReadFileInline(sizeBytes: number, maxBytes = MAX_INLINE_CHIP_BYTES): boolean {
  return sizeBytes <= maxBytes;
}
