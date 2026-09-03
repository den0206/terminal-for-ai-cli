# ターミナル機能追加 7 件の実現可能性調査

調査日: 2026-09-03 / 対象バージョン: 拡張 v0.2.1、`@xterm/xterm` 6.0.0、VS Code / Cursor 1.125+

サイドバーで AI CLI を動かす体験を強くするために検討している 7 機能について、
実現可能性・実装方針・リスクを整理する。「やる / やらない」の判断材料までを目的とし、
詳細設計は各機能の着手時に別途行う。

---

## 0. サマリ

| # | 機能 | 実現可能性 | 規模 | 主なリスク |
|---|------|-----------|------|-----------|
| 3 | スクロールバック内検索 | **高** | 小（0.5–1 日） | 自前 UI が必須（`enableFindWidget` は WebviewView に無い） |
| 4 | WebGL レンダラ | **高** | 小（0.5 日） | GPU 無効環境・コンテキストロス → フォールバック必須 |
| 7 | リンクのアクション・ポップオーバー | **高** | 小（0.5–1 日） | プレーンクリックとテキスト選択の競合 |
| 1 | 再起動をまたぐスクロールバック復元 | **高** | 中（1.5–2.5 日） | 保存タイミング（強制終了耐性）、機密情報の永続化 |
| 6 | ファイルのドラッグ＆ドロップ拡張 | **中〜高** | 小〜中（1–1.5 日） | エクスプローラからの `text/uri-list` 受信を実機確認する必要 |
| 2 | kitty keyboard protocol | — | — | **不採用（2026-09-03 決定）**。判断の根拠は §2 に残す |
| 5 | エージェント使用量の表示 | **低〜中** | 中（1–2 日 + 継続コスト） | 読み取り対象のフォーマットが非公開。アカウント切替は不採用 |

推奨順: **3 → 4 → 7 → 1 → 6 → 5(限定版)**。kitty keyboard protocol とアカウント切替は不採用。

すべての機能に共通する制約として、「ネットワークアクセスしない / テレメトリなし / ローカル完結」という
現在の README の主張を壊さないこと。

---

## 1. 再起動をまたぐスクロールバック復元

### 現状

- バッファは **Webview 側**にある。`src/webview/lib/state-managers.ts:41` の `buffers`（`Map<sessionId, {chunks, length}>`）に
  受信チャンクをそのまま積み、`SHARED_CONSTANTS.MAX_BUFFER_SIZE`（2,000,000 文字）を超えたら先頭チャンクから落とす。
- Webview リロード時は `src/webview/main.ts:892` 付近で `getBuffer()` → `writeToTerminal()` で再生。
- 拡張ホストは出力を保持していない（`session-data` を中継するだけ）ため、**拡張ホストのプロセスが死ぬと消える**。
  README の Limitations「No session restore across restarts」はこの構造から来ている。

### 実装方針（案 A / 推奨）

1. `@xterm/addon-serialize@0.14.0` を webview に追加。
2. 出力が落ち着いたら（debounce 3–5 秒、変化があったときのみ）`terminal.serialize({ scrollback: N })` を取り、
   新メッセージ `session-snapshot` で拡張ホストへ送る。
3. 拡張ホストは `context.storageUri`（画像と同じワークスペース別ストレージ）配下の
   `scrollback/<slot>.json` に `{ data, cols, rows, cwd, savedAt, label }` として保存。
4. 次回起動時、`webview-ready` の後・初期セッション生成の前に `restore-scrollback` を送り、
   ペインに区切り行（例: `── 前回のセッション（復元・読み取り専用） 2026-09-03 17:05 ──`）付きで `write()`。

保存単位は **セッション ID ではなくスロット**（`TerminalSlot` = Terminal 1 / 2）。セッション ID は起動ごとに変わるため、
テーマが同じ理由でスロット単位になっている（`src/shared/types.ts` のコメント参照）のに揃える。

案 B として「拡張ホスト側で生バイトのリングバッファを保存する」方法もある。実装は軽いが、
サイズ効率と ANSI 状態の整合性でシリアライズ方式に劣る。

### 決めるべきこと

- **PTY は復活しない**。復元されるのは「読める履歴」だけ。この誤解を招かない UI 表現（区切り行 + ペインラベルの `(restored)` バッジ）が必須。
- 保存先は **memento ではなくファイル**。`workspaceState` は state DB（SQLite）に載るキー・バリューで、
  1MB 級の文字列を毎回書く用途ではない。
- 保存タイミングは **定期 debounce が主、`deactivate()` は従**。`src/extension.ts:60` の `deactivate` は既に
  画像削除の Thenable を返しているが、VS Code は deactivate の非同期完了を保証しない。強制終了で落とさないためには
  走行中に書いておく必要がある。
- 上限は既存の 2MB キャップに合わせ、スロットごとに独立。3000 行 × 実測平均で 0.5–1.5MB 程度に収まる想定。

### リスク・注意

- **機密情報**: スクロールバックにはトークン・パス・エラーメッセージが写り得る。画像と同じ扱い
  （ワークスペース別ストレージ、`Clear all` で削除、起動時 TTL 掃除）を必ずセットにする。TTL は画像の 24h より長く 7 日程度が実用的。
- serialize アドオンは xterm の内部（`_core`）に依存する。xterm 更新時は addon も同じリリース系列に合わせて上げる。
- 1MB 規模の一括メッセージが増えるため、既存の `messageQueue` / `queuedDataChars` によるフロー制御と
  干渉しない経路（優先度の低い別キュー、または直接 `postMessage`）にする。
- 復元テキストをそのまま `write()` するとき、保存時と現在の桁数が違うと折り返しが崩れる。`cols` も一緒に保存し、
  差がある場合は「折り返し済みテキストである」旨を許容する。

---

## 2. kitty keyboard protocol（不採用）

> **2026-09-03 決定: 実装しない。** 現行の Shift+Enter → `\x1b\r` 変換で実用上困っていないため。
> 以下は将来の再検討用の判断根拠。

### 現状

`src/webview/main.ts:131-143` で `attachCustomKeyEventHandler` により **Shift+Enter を `\x1b\r` に固定変換**している。
相手アプリがどのキーボードモードを要求しているかは見ていない。

### 見送りの根拠

- **xterm.js 6.0.0 に kitty keyboard protocol の実装は無い**（`grep -c kitty node_modules/@xterm/xterm/lib/xterm.js` → `0`）。
  フラグのスタック管理、CSI-u エンコード、問い合わせ応答、リセット処理をすべて自前で書くことになる。
- フック自体は存在する（`parser.registerCsiHandler` / `registerEscHandler` / `terminal.modes`、
  `node_modules/@xterm/xterm/typings/xterm.d.ts:1817,1847,863`）ので、
  「モード交渉 + 非印字キー（Enter / Tab / Backspace + 修飾）だけ」なら 1–2 日で収まる。
- ただし「全キーをエスケープコードで報告する」段階（kitty フラグ bit3）まで行くと費用が跳ね上がる。
  印字可能文字は xterm 内部の textarea の `input` / `compositionend` から `onData` に流れるため、
  `attachCustomKeyEventHandler` では捕まえられず、`onData` の手前に自前の入力層が必要になる。
  さらに**日本語 IME の確定文字列を CSI-u へ再エンコードする実装**が必須セットになる
  （macOS では Shift が先に離れ、確定後の keyup が unshifted・`shiftKey: false` で来るため、
  押下時の値で離鍵イベントを組み立てると、既に押されていない修飾キーを報告してしまう）。
- `TERM` の変更は不要。kitty プロトコルは terminfo ではなく実行時の問い合わせで判定される。

再検討のトリガーは「実際に Shift+Enter / Ctrl+Enter が届かない CLI が出てきたとき」。

---

## 3. スクロールバック内検索

### 実装方針

- `@xterm/addon-search@0.16.0`（xterm 6.0.0 と同日リリースの対応版）を追加。
  `findNext()` / `findPrevious()`、`decorations` オプションでハイライト、`onDidChangeResults` でヒット件数を取得できる。
- **自前 UI が必須**: `enableFindWidget` は `WebviewPanelOptions` のオプションで、`WebviewView` には存在しない。
  ペインラベル行またはフッターに、入力欄 + 件数 + ↑↓ + `Aa` / `.*` トグルを置く。
- CSP 変更は不要（既に `style-src ${cspSource} 'unsafe-inline'`、スクリプトは nonce 付きバンドルに同梱）。

### 注意

- キーバインド: Webview にフォーカスがある間の `Cmd/Ctrl+F` を `document` の `keydown` で `preventDefault` して拾う。
  xterm の textarea にフォーカスがある状態でも document まで上がることを実機で確認する。
- `Esc` で閉じるとき、その `Esc` をターミナルに転送しないこと（AI CLI では Esc が中断キー）。
- 検索対象は**フォーカス中のペインのみ**。テーマと同じく「フォーカス中の端末に作用する」既存の考え方に揃える。

---

## 4. WebGL レンダラ

### 実装方針

`@xterm/addon-webgl@0.19.0` を `terminal.open()` の直後にロード。WebGL2 が必要。

```
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => { webgl.dispose(); /* DOM レンダラへ戻す */ });
  terminal.loadAddon(webgl);
} catch {
  // DOM レンダラのまま続行
}
```

### 得られるもの

- **罫線・ブロック文字の描画品質**。`customGlyphs`（既定 true）は
  「ブロック要素と罫線文字をフォントではなく自前で描く。行間や字間を指定していても線が繋がる。
  **DOM レンダラでは機能しない**」と型定義に明記されている
  （`node_modules/@xterm/xterm/typings/xterm.d.ts:81-87`）。AI CLI の TUI は枠線を多用するので、
  狭いサイドバー幅ではここが一番わかりやすい変化になる。
- 同じく DOM レンダラでは無効な `rescaleOverlappingGlyphs`（同 225-231 行、既定 false）が使えるようになり、
  Nerd Font / Powerline / 絵文字がセル幅からはみ出す問題を潰せる。
- 大量出力・毎フレーム再描画する TUI での CPU 低減と描画の滑らかさ。
  ただしサイドバー幅（80 桁 × 30 行程度）ではフルスクリーン端末ほどの差は出ない。

### リスク・対策

- **GPU 無効環境**（`--disable-gpu`、一部の Linux / リモート環境）では初期化が例外になる → try/catch で DOM 継続。
- **コンテキストロス**は現実に起きる。`retainContextWhenHidden: true`（`src/extension.ts:28`）で非表示中も GL コンテキストを
  保持するため、同一ウィンドウ内の他 webview と合わせてブラウザのコンテキスト上限に当たる可能性がある。
  `onContextLoss` → dispose → DOM フォールバックを必ず実装する。省くと画面が黒くなる事故になる。
- **テーマ切替**: `terminal.options.theme` の更新で反映されるが、グリフのテクスチャアトラスが残る場合があるため
  `theme-controller.ts` の適用処理で `clearTextureAtlas()` を呼ぶ。
- macOS ではサブピクセルアンチエイリアスが効かなくなり、**文字がわずかに細く見える**ことがある。
  9 種のテーマプリセットで見比べて判断する。
- メモリは端末ごとにテクスチャアトラス分（数 MB 程度）増える。
- 逃げ道として設定 `aiTerminal.rendererType: 'auto' | 'webgl' | 'dom'`（既定 `auto`）を用意する。

VSIX サイズ増は数十 KB オーダー（esbuild で webview バンドルに同梱、ネイティブ依存なし）。

### 効果測定

- 罫線: Claude Code / Codex を起動して枠線のスクリーンショットを before / after で比較。
- 速度: 大きめのログを `cat` して「Developer: Open Webview Developer Tools」の Performance タブでフレーム時間を比較。
- ツールバーの `🧠 RSS` には改善が出ない（拡張ホストのプロセスの値であり、Webview は別プロセス）。

---

## 5. エージェント使用量の表示

### 狙い

各エージェント CLI（Claude Code / Codex など）はレート制限や使用量の状態をローカルに持つ。
これを**読み取るだけ**なら、ネットワークアクセスなしで「残り使用量」「5 時間 / 日次 / 週次のリセットまでの時間」を
ツールバーに出せる可能性がある。現在の `🧠 RSS` 表示は README 自身が
「拡張ホスト全体の値でこの拡張に帰属できない」と断っている数値なので、置き換え候補としても筋が良い。

### 本調査で確認できたこと / できなかったこと

- ✅ 方針としてローカルファイル読み取りだけで完結させられる（ネットワーク不使用の原則を壊さない）。
- ❌ **安定した公開フォーマットは確認できなかった**:
  - 実機の `~/.claude` 直下に使用量 / レート制限を持つファイルは見当たらない
    （`policy-limits.json` はポリシー設定であって使用量ではない）。
  - `~/.codex/state_5.sqlite` のスキーマにも rate / usage / limit に相当するテーブルは無い。
  - Codex はセッションの rollout JSONL に `rate_limits` スナップショットを含む実装が知られているが、
    本調査では個人データ領域の走査を避けたため中身は未確認。
- ⇒ 読み取り対象は**非公開かつバージョン依存**。エージェント側の更新で黙って壊れる前提で作る必要がある。

### 実装するなら

- agent ごとの provider インターフェースに分離し、**見つからない / パースできない場合は静かに非表示**。
- 既定 OFF の設定（例 `aiTerminal.showAgentUsage`）。ワークスペースから有効化されたくないので
  machine スコープ + `restrictedConfigurations` 入り。
- 監視は `fs.watch` ではなく既存の 30 秒ポーリング（`USAGE_POLL_INTERVAL_MS`）に相乗り。

### アカウント切替は不採用

`~/.claude.json` / `~/.codex/auth.json`（認証情報）への**書き込み**が必要になる。
ローカル完結・低権限という現在のセキュリティ姿勢に対して、得られる価値が釣り合わない。

---

## 6. ファイルのドラッグ＆ドロップ拡張

### 現状

`src/webview/lib/drag-drop-handler.ts` は `Shift` + ドロップで `dataTransfer.files` を受け、`image/*` のみを
base64 で拡張ホストへ送り、ストレージに保存してから**保存先のパス**をシェルへ書き込む
（`aiTerminalViewProvider.ts` の `handleImageDrop` → `imageManager.escapeShellPath`）。

### 2 系統あり、性質が違う

**(a) OS（Finder / Explorer）からのドロップ**
`dataTransfer.files` に `File` が入るが、**元のパスは webview から取得できない**
（Electron の `File.path` は廃止方向、`webUtils.getPathForFile` は webview から使えない）。
したがって現状どおり「コピーを保存してそのパスを渡す」しかない。画像なら妥当だが、
リポジトリ内のソースファイルを「コピーのパス」でエージェントに渡すのは意味が薄い
（エージェントが編集しても元ファイルに反映されない）。非画像は別扱いの設計が要る。

**(b) VS Code エクスプローラからのドロップ ← 本命**
`text/uri-list` に**実パス**が入る。長らく webview へのドロップが効かないバグ
（[microsoft/vscode#182449](https://github.com/microsoft/vscode/issues/182449)）があったが、
**2024 年 6 月マイルストーンで修正済み・closed**。エディタ 1.125 なら
`event.dataTransfer.getData('text/uri-list')` で受け取れる見込み。

### 実装方針

- drop ハンドラを分岐: `text/uri-list` があれば → パスをシェルエスケープして挿入（複数なら空白区切り）。
  無ければ → 従来の画像処理。
- `Shift` 必須の現仕様は維持（エディタ本体のドロップ処理と競合するため。README にも明記済み）。
- **エスケープ処理の切り出しが必要**: 現在の `escapeShellPath` は `ImageManager` の private メソッドで、
  「Windows で `"` `%` `!` を含むパスは（自前ストレージなので出ないはずという前提で）拒否する」設計になっている。
  任意のワークスペースパスを扱うならこの前提が崩れるので、共有ユーティリティへ切り出したうえで
  Windows の扱いを再検討する。

### 要検証（実機）

1. VS Code 1.125 のエクスプローラから WebviewView へのドロップで `text/uri-list` が実際に届くか。
2. Cursor（VS Code フォーク）でも同じか。
3. 複数ファイル選択時の区切り（CRLF 区切りの URI リスト）と `file://` の URL デコード。

---

## 7. リンクのアクション・ポップオーバー

### 現状

`Cmd`(macOS) / `Ctrl` + クリックで `open-link` を送信 → 拡張ホストの `handleOpenLink`
（`src/view/aiTerminalViewProvider.ts:627`）が `normalizeExternalUrl` でスキームを検証し、
`aiTerminal.confirmOpenLink` が true ならモーダル確認してから `vscode.env.openExternal`。
プレーンクリックは意図的に無反応（リンクをまたぐテキスト選択を壊さないため）。

### 変更案

- **プレーンクリック** → その場にポップオーバー（`ブラウザで開く` / `URL をコピー` / `キャンセル`）。
- **Cmd/Ctrl + クリック** → 現行どおり即座に開く（確認設定は維持）。
- **ダウンロードは実装しない**。拡張がネットワークアクセスしないという方針に反する。

### 注意

- プレーンクリックを奪うと選択操作と競合する。`mousedown` → `mouseup` の移動量がしきい値（数 px）以下で、
  かつ選択範囲が空のときだけポップオーバーを出す。
- コピーは webview の `navigator.clipboard`（権限で失敗し得る）ではなく、
  メッセージで拡張ホストに委譲して `vscode.env.clipboard.writeText` を使うほうが確実。
- ポップオーバーはペイン内に収める（サイドバーは狭いので画面外に出やすい）。`Esc` で閉じ、その `Esc` は端末に送らない。

---

## 8. 共通の作業

- **依存追加**: `@xterm/addon-serialize` / `@xterm/addon-search` / `@xterm/addon-webgl`（いずれも devDependencies、
  esbuild で webview バンドルに同梱。`node-pty` のようなネイティブ依存ではないのでクロスプラットフォーム配布に影響しない）。
  3 つとも `@xterm/xterm@6.0.0` と同一リリース（2025-12-22）の stable 系列: serialize 0.14.0 / search 0.16.0 / webgl 0.19.0。
  xterm を上げるときは 4 つまとめて上げる。
- **ドキュメント**: README / README_JP の Feature Overview・Settings・Security・Limitations、CHANGELOG、
  `package.nls*.json`（設定・コマンド名）、`l10n/bundle.l10n.*.json`（実行時メッセージ）。英語がソース、日本語併記。
- **設定キーのスコープ**: スクロールバック復元と使用量読み取りは、ワークスペース側から勝手に有効化されたくない。
  machine スコープ + `capabilities.untrustedWorkspaces.restrictedConfigurations` への追加を検討する。
- **テスト**: 既存の vitest 構成に合わせ、純ロジック（uri-list のパース、スナップショットの上限処理、
  シェルエスケープ）はユニットテストに落とす。DOM / GL 依存部分は実機確認。

## 9. 参考

- xterm.js アドオン: <https://github.com/xtermjs/xterm.js/tree/master/addons>
- VS Code Webview API: <https://code.visualstudio.com/api/extension-guides/webview>
- エクスプローラ → webview のドロップ: <https://github.com/microsoft/vscode/issues/182449>（closed / 2024-06 マイルストーン）
