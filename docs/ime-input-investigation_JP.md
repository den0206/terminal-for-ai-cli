# 日本語変換中の重複入力の調査

対象: main `13a13ed0f4889bf79df5072473077fc5a0148bfb` / xterm.js 6.0.0。
申告された環境: macOS 標準の日本語入力 / Cursor / Codex・Claude Code。発生タイミングは変換中。
この作業環境から macOS 上での実機再現は未確認。以下はソース確認とタイマー順序を
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

## 今回の修正

- compositionstart/end を捕捉して変換中を追跡し、変換中の keydown/keypress を
  xterm に渡さない。preventDefault は呼ばず、OS の変換候補操作は継続する。
  isComposing が false のイベントでも変換開始・終了の状態で保護する。
- 無条件のクリアを ImeController に置き換え、xterm の確定送信後にだけ空にする。
  次の変換開始、追加入力、内容の変更、textarea の選択があればクリアしない。
- xterm.js 6 の CompositionHelper 本体を読み込む回帰テストで、修正前は
  「前の文」が変換中に送信され、修正後は確定時に「新」だけが送られることを確認。
- 入力文字列の重複排除は使用していない。

## 実機での確認事項

- OS、IME、エディタ、拡張バージョン、起動中の CLI を揃えて再現する。
- compositionstart/update/end、keydown、input とタイマー実行の順序を記録する。
  記録するのはイベント種別、isComposing、keyCode、textarea の文字数、送信文字数
  と時刻のみとし、入力本文は記録しない。
- 変換候補の変更、Enter 確定、連続変換、確定後の Shift+Enter、
  候補選択の中止と意図的な同じ文の繰り返し入力を確認する。
- xterm 内部の位置更新待ちに対する Enter / Shift+Enter の割り込みも確認する。
  本拡張の isShiftEnter は isComposing / keyCode 229 を確認しているが、
  compositionend 後の xterm の確定送信待ち状態は確認していない。

参考:
- https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/input/CompositionHelper.ts
- https://github.com/den0206/terminal-for-ai-cli/blob/13a13ed0f4889bf79df5072473077fc5a0148bfb/src/webview/main.ts#L244
- https://github.com/den0206/terminal-for-ai-cli/blob/13a13ed0f4889bf79df5072473077fc5a0148bfb/src/webview/lib/utils.ts#L214

## 0.7.0 の入力停止（2026-10-22）

症状: 変換中の文字が反転表示のまま残り、以後のキー入力を受け付けなくなる。
新しいセッションを作っても直らず、IDE の再起動が必要になる。

原因:
- 0.7.0 の `ownsKey` は、自前の変換中フラグが立っている間はすべてのキーを xterm に渡さない。
  フラグは compositionstart で立ち、compositionend で下りる。
- compositionend が届かないとフラグが下りず、そのペインのキーがすべて捨てられる。
- xterm の CompositionHelper には、229 以外のキーで変換を確定して立ち直る経路がある。
  捨てられたキーは xterm に届かないため、この経路も動かない。反転表示が残るのはこのため。
- ペインの Terminal は webview の起動時に一度だけ作られ、セッションを切り替えても作り直さない。
  そのため webview を作り直すまで直らない。

修正:
- 渡さないキーは、イベント自体が変換中を示すもの（`isComposing` または keyCode 229）だけにした。
- 変換中フラグが残ったまま変換中でないキーが届いたら、compositionend を取りこぼしたとみなす。
  フラグを下ろし、直前 12 件のイベント（compositionstart / compositionend / focus / blur と時刻）を
  `IME compositionend was not received` として warn に出す。入力した文字は記録しない。
- 前回の「前の文」再送のテストは、変換中のキーが実機と同じく isComposing として届く前提に改めた。
  compositionend が来ないときに xterm 6 の CompositionHelper が立ち直るテストを追加した。

未確定:
- compositionend が抜けるきっかけ。Chrome は blur 時に compositionend を出すとされるが、
  VS Code / Cursor の webview（iframe）で同じか確認できていない。上記 warn のイベント列で確かめる。
- 外した保護（isComposing が false のキーでも変換中は渡さない）は、実機で起きるか確かめられていない
  想定への対策だった。warn が「変換中に通常キーが来た」ケースとして出るので、再発の有無もここで分かる。
