# 日本語変換中の重複入力の調査

対象: main `13a13ed0f4889bf79df5072473077fc5a0148bfb` / xterm.js 6.0.0。
実際の OS / IME / エディタでの再現は未確認。以下はソース確認とタイマー順序を
制御した検証の結果であり、ユーザーの症状の原因を確定したものではない。

## 確認できた問題経路

1. xterm.js の CompositionHelper は compositionstart 時の textarea の文字数を
   start として保持する。compositionupdate の end 更新と compositionend の
   確定文字列送信は setTimeout(0) で遅延する。
2. 本拡張の main.ts は compositionend 後に別の setTimeout(0) を登録して
   textarea.value を無条件で空にする。次の compositionstart が先に発生しても
   このタイマーを取り消さないため、進行中の次の変換の内容まで消せる。
3. xterm.js の非 IME キーの処理は、変換中 / 確定送信待ちなら遅延処理を中断し、
   textarea.value.substring(start, end) を直ちに送信する。
   end が未更新で start より小さいと JavaScript の substring が引数を交換し、
   新しい変換文字ではなく以前の入力を送る経路がある。

## タイマーを制御した検証

xterm.js 6.0.0 の CompositionHelper.ts 本体を esbuild で変換し、setTimeout の
   コールバックをキューに入れて順序を制御した。サービスはスタブを使用。

- textarea が「前の文」の状態で compositionstart、内容を「前の文新」に更新、
  compositionupdate の位置更新タイマーより先に Enter の keydown を処理した。
  「新」ではなく「前の文」が triggerDataEvent に渡された。
- 「確定」の compositionend の直後に、本拡張と同じ textarea を空にする
  タイマーを追加。その実行前に次の compositionstart と「次の変換」の入力を
  発生させると、確定済みの「確定」の送信後、次の変換の textarea が空になった。

これらの順序が実際の IME で発生しているかは、イベント計測が必要。
単に同じ送信文字列を除外すると、意図的に同じ言葉を入力した場合も失われるため、
送信データの重複排除による修正は行っていない。

## 次の切り分けと修正方針

- OS、IME、エディタ、拡張バージョン、起動中の CLI を揃えて再現する。
- compositionstart/update/end、keydown、input とタイマー実行の順序を記録する。
  記録するのはイベント種別、isComposing、keyCode、textarea の文字数、送信文字数
  と時刻のみとし、入力本文は記録しない。
- 既存の無条件クリアを、次の変換開始や入力・右クリック用の選択があれば
  キャンセルする世代管理付きの処理へ置き換える案を検証する。
- xterm 内部の位置更新待ちに対する Enter / Shift+Enter の割り込みも確認する。
  本拡張の isShiftEnter は isComposing / keyCode 229 を確認しているが、
  compositionend 後の xterm の確定送信待ち状態は確認していない。

参考:
- https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/input/CompositionHelper.ts
- https://github.com/den0206/terminal-for-ai-cli/blob/13a13ed0f4889bf79df5072473077fc5a0148bfb/src/webview/main.ts#L244
- https://github.com/den0206/terminal-for-ai-cli/blob/13a13ed0f4889bf79df5072473077fc5a0148bfb/src/webview/lib/utils.ts#L214
