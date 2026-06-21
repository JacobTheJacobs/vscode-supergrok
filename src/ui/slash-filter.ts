export interface SlashCmd {
  name: string;
  description?: string;
}

export function getSlashQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\n)\/(\S*)$/);
  return m ? m[1] : null;
}

export function filterCommands(commands: SlashCmd[], query: string): SlashCmd[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.name.toLowerCase().startsWith(q));
}

export function applySlashPick(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const newBefore = before.replace(/(?:^|\n)\/(\S*)$/, (m) =>
    m.startsWith("\n") ? `\n/${name} ` : `/${name} `,
  );
  return { text: newBefore + after, caret: newBefore.length };
}
