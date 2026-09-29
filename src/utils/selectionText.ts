/** Formats selected editor text as a code block for a CLI prompt. */
export function formatSelection(
  path: string,
  line: number,
  language: string,
  selected: string,
): string {
  // ESC などが残ると bracketed paste の囲みを抜けて入力が確定されうる
  selected = selected.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
  const longestFence = (selected.match(/`+/g) ?? []).reduce(
    (length, run) => Math.max(length, run.length),
    2,
  );
  const fence = '`'.repeat(longestFence + 1);
  return `${path}:${line}\n${fence}${language}\n${selected}\n${fence}`;
}
