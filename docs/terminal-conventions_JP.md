# ターミナル作法の調査 — Ghostty / cmux から借りるもの

対象: Terminal For AI CLI（VS Code / Cursor のサイドバーに常駐する Webview ターミナル拡張）
調査日: 2026-08-29

---

## 1. なぜこの調査をしたか

出発点は「Ghostty や cmux と連携できるか」という問いだった。結論としては**アプリ同士の連携は不要**で、
価値があるのは**ターミナルエミュレータとしての作法（エスケープシーケンスと環境の作り方）を借りること**だった。
この文書はその調査結果と、採否の判断根拠を残すもの。

### 連携そのものを見送った理由

| 案 | 判断 | 根拠 |
|---|---|---|
| Ghostty 本体（libghostty）を埋め込む | ❌ 不可能 | libghostty の埋め込み API は macOS/iOS/Linux ネイティブ（Metal・OpenGL + SwiftUI/GTK）専用。VS Code の Webview は HTML/JS サンドボックスで描画先が存在しない。公式も「macOS アプリ専用で汎用埋め込み向けには未安定」と明言している |
| `ghostty-web`（libghostty-vt WASM）で xterm.js を置換 | 🔶 保留 | npm・MIT・xterm.js 互換 API を名乗り、前例（`vscode-bootty`）もある。絵文字や複雑な書記素の描画精度は上がるが、+400KB で速度は上がらず、`FitAddon` / `WebLinksAddon` の互換性が未確認。**描画崩れの実バグが積み上がってから再検討** |
| cmux の socket API を叩く | ❌ 不採用 | `/tmp/cmux.sock` への JSON-RPC でワークスペース操作は容易（実装は半日）。ただし cmux は別アプリの別ウィンドウであり、「サイドバーに常駐する」という本拡張の価値提案と逆を向く。macOS 限定という制約も付く |
| 外部ターミナルとして起動する | ➖ 不要 | `open -na ghostty --args --working-directory="$(pwd)"` の 1 行で足りる。拡張に実装する意味がない |

---

## 2. 結論サマリ

借りる価値があるのは以下。上から順に費用対効果が高い。

| # | 作法 | 効果 | 規模 | 状態 |
|---|---|---|---|---|
| 1 | Shift+Enter → `\x1b\r` | 複数行プロンプトが打てるようになる | 6 行 | ✅ 実装済み |
| 2 | `macOptionIsMeta` | macOS で Option 系ショートカットが効く | 1 行 | ✅ 実装済み |
| 3 | `COLORTERM` / `TERM_PROGRAM` を PTY env に | 24bit カラーと実行環境の検出 | 2 行 | ✅ 実装済み |
| 4 | OSC 0/1/2 タイトル → ペインラベル | タブの情報密度（cmux の縦タブ相当） | 10 行 | ✅ 実装済み |
| 5 | OSC 9;4 プログレス | 進捗をツールバーに表示 | 30 行 | 未 |
| 6 | OSC 52 クリップボード | Claude Code の `/copy` が動く | アドオン | 未 |
| 7 | OSC 7（cwd 報告） | 新規セッションが同じディレクトリで開く | 中 | 未 |
| 8 | kitty keyboard protocol | #1 の恒久版。Ghostty と同じ土俵 | 依存更新 | ⏳ 待ち |
| 9 | OSC 133 シェル統合 | 長時間コマンドの完了通知 | 大 | 未 |

---

## 3. Tier 1 — 数十行、AI CLI 用途に直撃

**#1〜#4 は実装済み**。

### #1 Shift+Enter で改行

Claude Code の `/terminal-setup` は **VS Code 統合ターミナル向けの keybinding を書き込むだけ**で、
この拡張の Webview ターミナルには一切効かない。現状 Shift+Enter は送信になってしまう。

```ts
terminal.attachCustomKeyEventHandler((event) => {
  if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
    // JetBrains と同じ ESC + CR。Claude Code は改行として解釈する
    postInput('\x1b\r');
    return false;
  }
  return true;
});
```

Ctrl+J と `\` + Enter はどのターミナルでも動くので、これは「動くようにする」ではなく
「他のターミナルと同じ操作感にする」ための対応。

### #2 `macOptionIsMeta`

Option+Enter（改行）や Option+P（モデル切り替え）といった Claude Code のショートカットは、
macOS では Option がメタキーとして送られないと効かない。xterm.js 6.0.0 に既にオプションがある。

```ts
new Terminal({ macOptionIsMeta: true, /* ... */ });
```

VS Code 統合ターミナルの `terminal.integrated.macOptionIsMeta` に相当する。設定項目にしてもよい。

### #3 PTY の環境変数

`src/terminal/sessionManager.ts` の `buildEnv()` は `TERM` しか設定していない。

```ts
COLORTERM: 'truecolor',                    // 24bit カラーを CLI 側に伝える
TERM_PROGRAM: 'terminal-for-ai-cli',       // 実行環境の検出用
TERM_PROGRAM_VERSION: <拡張のバージョン>,
```

cmux が `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` を注入して「ツール側が検出して適応できる」ようにしているのと同じ発想。
**`TERM_PROGRAM` を `ghostty` などと詐称してはいけない** — kitty グラフィックスやキーボードプロトコルに
対応していると誤認され、かえって壊れる。

### #4 タイトル → ペインラベル

ペインのラベルは `Terminal 1` / `Terminal 2` で固定されている。xterm.js は OSC 0/1/2 を解釈して
`onTitleChange` で流しているので、それをラベルに出すだけで `claude — myproject` のような表示になる。
cmux が縦タブに git ブランチ・作業ディレクトリ・ポートを出して情報密度を上げているのの、最も安い模倣。

---

## 4. Tier 2 — 中コストだが効く

### #5 OSC 9;4 プログレス（ConEmu 形式）

Claude Code は `terminalProgressBarEnabled` 設定でプログレスバーのシーケンスを送る
（tmux の `allow-passthrough` の説明に「デスクトップ通知とプログレスバーが外側のターミナルに届かない」と明記されている）。
Ghostty も 1.3.0 で ConEmu OSC 9 のサブコマンド 1〜12 を完全対応した。

xterm.js は OSC 9 を扱わないので、`9;4` サブコマンドだけ拾うハンドラを自前で登録してツールバーにバーを出す。
cmux の `set-progress` に相当する。

### #6 OSC 52 クリップボード

`@xterm/addon-clipboard`（0.2.0）で対応できる。Claude Code の `/copy` がこれを使う
（iTerm2 で「アプリケーションがクリップボードにアクセスできる」設定を有効化させているのがこの経路）。
**Webview 内で `navigator.clipboard.writeText` が通るかは要検証。**

### #7 OSC 7（作業ディレクトリの報告）

xterm.js は OSC 7 を扱わないので自前ハンドラが要る。得られるもの:

- 2 つ目のセッションを 1 つ目と同じディレクトリで開く（Ghostty の `window-inherit-working-directory` 相当）
- ペインラベルに cwd を出す
- ドロップした画像のパス解決の精度向上

シェル側が OSC 7 を出す設定になっている必要がある（多くの zsh/bash 設定は既に出している）。

---

## 5. Tier 3 — 大きいが将来の本命

### #8 kitty keyboard protocol

**`@xterm/xterm@6.1.0-beta.303` に `vtExtensions.kittyKeyboard` オプションが入っている**
（現在使用中の 6.0.0 には存在しないことを typings の差分で確認済み）。

```ts
new Terminal({ vtExtensions: { kittyKeyboard: true } });
```

これが正式版に来れば、Shift+Enter は #1 の暫定対応ではなく本来の形（`CSI u` エンコーディング）で解決し、
Ghostty / Kitty / iTerm2 と同じ土俵に立てる。**beta 依存になるので今は待ち。**
6.1.0 の正式リリースを追うこと。

同 beta には `colorSchemeQuery`（`CSI ? 996 n` / `DECSET 2031` によるライト/ダーク通知）も入っており、
CLI 側がテーマに追従できるようになる。これも 6.1.0 で一緒に入る。

### #9 OSC 133 シェル統合

Ghostty 1.3.0 の `notify-on-command-finish`（長時間コマンドの完了通知）や jump-to-prompt の土台。
コマンドの開始・終了・終了コードが取れるようになる。

ただしシェルへの統合スクリプト注入が必要（既存の `aiTerminal.startupCommands` は使える）。
Ghostty は bash 4.4+ で PS0/PROMPT_COMMAND に移行している。**コストが大きいので後回し。**

---

## 6. 調査した結果、採用しないもの

| 項目 | 理由 |
|---|---|
| 同期出力（DECSET 2026） | **xterm.js 6.0.0 に既に実装済み**（`lib/xterm.js` 内の `synchronizedOutput` を確認）。Claude Code はクエリで自動検出するので、ちらつき対策は既に効いている |
| WebGL レンダラ（`@xterm/addon-webgl`） | Claude Code 公式が VS Code に対して `terminal.integrated.gpuAcceleration: "off"` を書き込むほどなので、わざわざ入れる理由がない |
| Sixel / kitty グラフィックス（`@xterm/addon-image`） | AI CLI ではほぼ使われない |
| cmux の socket API / ワークスペース連携 | 1 章のとおり方向性が合わない |

---

## 7. 参考

- [Configure your terminal for Claude Code](https://code.claude.com/docs/en/terminal-config)
- [Ghostty 1.3.0 Release Notes](https://ghostty.org/docs/install/release-notes/1-3-0)
- [Ghostty VT Reference](https://ghostty.org/docs/vt/reference)
- [libghostty C API Overview](https://ghostty-org-ghostty.mintlify.app/api/overview)
- [cmux CLI / Socket API Reference](https://cmux.com/docs/api)
- [coder/ghostty-web](https://github.com/coder/ghostty-web) / [0xBigBoss/vscode-bootty](https://github.com/0xBigBoss/vscode-bootty)
- [Your Terminal Can't Tell Shift+Enter from Enter](https://blog.fsck.com/agent-blog/2026/02/26/terminal-keyboard-protocol/)

### ローカルで確認した事実

- `@xterm/xterm@6.0.0` が登録している OSC ハンドラ: 0, 1, 2, 4, 8, 10, 11, 12, 104, 110, 111, 112
  （**7, 9, 52, 99, 133, 777 は未対応** — だから自前で登録する必要がある）
- 同 6.0.0 が対応する DEC モード: 1006（SGR マウス）, 1049（代替バッファ）, 2004（bracketed paste）, **2026（同期出力）**
- `6.0.0` → `6.1.0-beta.303` の typings 差分で増えたオプション:
  `kittyKeyboard`, `kittySgrBoldFaintControl`, `colorSchemeQuery`, `vtExtensions`, `win32InputMode`,
  `mouseEventsRequireAlt`, `showScrollbar`, `quirks` ほか
