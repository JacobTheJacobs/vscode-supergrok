import type { FileChip } from "./chips";

export interface PromptBuilderDeps {
  readFile: (path: string) => string;
  extName: (path: string) => string;
}

export function buildPrompt(
  text: string,
  chips: FileChip[],
  deps: PromptBuilderDeps,
): string {
  const refs: string[] = [];
  for (const chip of chips) {
    if (chip.hidden) continue;
    let imgData = chip.imageData;
    let imgMime = chip.imageMime;
    if (!imgData && chip.dataUrl) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(chip.dataUrl);
      if (m) { imgMime = m[1]; imgData = m[2]; }
    }
    if (imgData && imgMime) {
      const url = `data:${imgMime};base64,${imgData}`;
      const cleanName = (chip.relPath || '').split(/[\\/]/).pop() || chip.relPath;
      refs.push(`Attached image \`${cleanName}\` (at ${chip.relPath}):\n![${cleanName}](${url})`);
      continue;
    }
    if (chip.selectionStart && chip.selectionEnd) {
      let content = "";
      try {
        content = deps.readFile(chip.path);
      } catch {
        refs.push(`@${chip.relPath}`);
        continue;
      }
      const lines = content
        .split("\n")
        .slice(chip.selectionStart - 1, chip.selectionEnd);
      const ext = deps.extName(chip.path).replace(/^\./, "");
      refs.push(
        `\`${chip.relPath}\` (lines ${chip.selectionStart}-${chip.selectionEnd}):\n\`\`\`${ext}\n${lines.join("\n")}\n\`\`\``,
      );
    } else {
      refs.push(`@${chip.relPath}`);
    }
  }
  return [refs.join("\n\n"), text].filter(Boolean).join("\n\n");
}
