import type {ScrollbackSnapshot} from '../../shared/types';

/** 区切り線に使う文字。ペイン幅が分からないので固定長で引く。 */
const RULE = '─'.repeat(24);

function formatTimestamp(savedAt: number): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return 'an earlier session';
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 復元したスクロールバックに前置き・後置きの区切りを付ける。
 *
 * 戻ってくるのは**読める履歴だけ**で、そこに写っているプロセスは既に終了している。
 * 生きているシェルの出力と地続きに見えると誤解を生むので、必ず境界を描く。
 */
export function formatRestoredScrollback(snapshot: ScrollbackSnapshot): string {
  const label = snapshot.label ?? 'Previous session';
  const header =
    `\x1b[2m${RULE} ${label} — ${formatTimestamp(snapshot.savedAt)} ` +
    `(history only, this shell is new) ${RULE}\x1b[0m\r\n`;
  const footer = `\r\n\x1b[2m${RULE} end of restored history ${RULE}\x1b[0m\r\n`;
  return `${header}${snapshot.data}${footer}`;
}
