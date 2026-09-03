/**
 * Quotes a path so the shell takes it as a single literal argument.
 *
 * POSIX single quotes are literal, so the standard `'\''` break-out is enough
 * for any byte. Windows has no such construct, and the same path has to survive
 * whichever shell the user picked: inside double quotes `cmd.exe` still expands
 * `%VAR%` and (with delayed expansion) `!VAR!`, PowerShell still expands `$VAR`
 * and runs `$(...)` and treats `` ` `` as its escape character, and a `"` cannot
 * be escaped portably across the two. Those characters are rejected instead of
 * being escaped wrongly.
 *
 * Rejection used to be unreachable for saved images (our own storage directory
 * plus a sanitized filename), but dropped workspace files are named by the user,
 * so callers must expect it and skip that path rather than assume it cannot happen.
 */
export function escapeShellPath(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    if (/["%!$`]/.test(filePath)) {
      throw new Error(
        `Path contains characters that cannot be quoted safely on Windows: ${filePath}`
      );
    }
    return `"${filePath}"`;
  }
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

/**
 * Parses a `text/uri-list` payload (RFC 2483): one URI per line, `#` comments,
 * CRLF separators. The editor sends this when a file is dragged out of the
 * explorer, and it is the only route that carries the file's real path — the
 * `File` objects of an OS drag do not expose one to a webview.
 */
export function parseUriList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((uri) => {
      if (seen.has(uri)) {
        return false;
      }
      seen.add(uri);
      return true;
    });
}
