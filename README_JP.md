<p align="center">
  <img src="media/icon.png" alt="Terminal for AI CLI icon" width="128" height="128">
</p>

<h1 align="center">Terminal for AI CLI</h1>

<p align="center">
  <strong>サイドバーに本物のターミナルを。AI CLI の隣で。</strong><br>
  マルチセッション・分割ビュー・画像のドラッグ&ドロップを、エディタを離れずに。
</p>

<p align="center">
  <a href="https://github.com/den0206/terminal-for-ai-cli/releases/latest"><img alt="Download VSIX" src="https://img.shields.io/badge/Download-.vsix-2f7bff?style=for-the-badge&labelColor=111111"></a>
</p>

<p align="center">
  <img alt="VS Code 1.125+" src="https://img.shields.io/badge/VS%20Code%20%2F%20Cursor-1.125%2B-2f7bff?style=flat-square&labelColor=111111">
  <img alt="Cross platform" src="https://img.shields.io/badge/Platform-macOS%20%2F%20Linux%20%2F%20Windows-2f7bff?style=flat-square&labelColor=111111">
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-2f7bff?style=flat-square&labelColor=111111"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 日本語
</p>

<p align="center">
  <!-- BEGIN:release -->
  <!-- END:release -->
</p>

---

**Terminal for AI CLI** は、VS Code / Cursor のサイドバーに `xterm.js` のフルターミナルを常駐させる拡張機能です。
バックエンドは実 PTY プロセス（`node-pty`）。AI CLI を片側で走らせながら、もう片側で作業を続けるワークフローのために作られています。

> 「AI エージェントはサイドバーで走り続け、エディタは自分のもののまま。」

エディタ下部のターミナルパネルはコードの縦幅を奪います。このビューは代わりに Activity Bar に置かれます。
最大 2 つのシェルを、上下分割で、常に見える位置に、独立した高さとテーマで。

## 目次

- [できること](#できること)
- [クイックスタート](#クイックスタート)
- [使い方](#使い方)
- [機能一覧](#機能一覧)
- [設定項目](#設定項目)
- [コマンド](#コマンド)
- [ストレージとメモリ](#ストレージとメモリ)
- [セキュリティ](#セキュリティ)
- [制限事項](#制限事項)
- [トラブルシューティング](#トラブルシューティング)
- [開発](#開発) / [リリース手順](#リリース手順)
- [リンク](#リンク)

## できること

- **サイドバーに 2 つのシェル** — ツールバーのドロップダウンから追加・切り替え・終了。
- **分割ビュー** — 2 セッションを同時表示。間の仕切りはドラッグでリサイズ可能。
- **リロードしてもスクロールバックが残る** — セッションごとに出力をバッファし、Webview 再読み込み時に再生。
- **安定した名前** — `Terminal 1`, `Terminal 2`, … 空いた番号は再利用。
- **画像をドラッグで投入** — `Shift` を押しながらドロップすると、保存された画像のエスケープ済みパスがシェルに入力されます。
- **使用状況表示** — 保存画像のサイズと拡張ホストのメモリをツールバーに常時表示。
- **テーマプリセット** — 9 種類の配色（Modern, Basic, Homebrew, …）を即時適用。
- **高さの調整** — 下端のハンドルをドラッグ。値は保存されます。
- **Clear all sessions** — インラインの確認を挟んで全シェルを終了。

テレメトリなし、ネットワークアクセスなし、アカウント不要。すべて拡張ホスト内でローカルに動作します。

## クイックスタート

### 動作要件

| 項目 | 内容 |
|------|------|
| エディタ | **VS Code / Cursor 1.125 以降** |
| プラットフォーム | macOS / Linux / Windows（Apple Silicon, x64, arm64） |
| Node.js | 20 以降（ソースからビルドする場合のみ） |
| 依存 | `node-pty`（ネイティブ。VSIX にはビルド済みバイナリを同梱） |

### インストール

Marketplace 未公開です。[**Releases**](https://github.com/den0206/terminal-for-ai-cli/releases/latest) から
`terminal-for-ai-cli-X.Y.Z.vsix` をダウンロードしてインストールしてください：

```bash
code --install-extension terminal-for-ai-cli-X.Y.Z.vsix
```

エディタからでも可能です：拡張機能ビュー → `…` メニュー →「VSIX からのインストール…」。

リリース版の VSIX には **全プラットフォーム** の `node-pty` prebuild が同梱されています。
ローカルビルド（`npm install && npm run package`）も可能ですが、その VSIX はビルドしたマシンでしか動きません。
詳細は [node-pty と全プラットフォーム対応パッケージ](#node-pty-と全プラットフォーム対応パッケージ) を参照。

### 初回起動

Activity Bar から **Terminal For AI** を開きます。ログインシェル（または `aiTerminal.defaultShell`）で
最初のセッションがワークスペースルート（フォルダ未オープン時はホームディレクトリ）に自動生成されます。

## 使い方

### ツールバー

```
[ Terminal 1 ▾ ]  💾 0.0MB · 🧠 312MB  [ + ]  [ ▢ ]  [ 🗑 ]
```

| コントロール | 動作 |
|--------------|------|
| ドロップダウン | アクティブセッションの切り替え |
| 使用状況表示 | 保存画像 / 拡張ホストの RSS → [ストレージとメモリ](#ストレージとメモリ) |
| `+` | 新規セッション（上限 2 セッションで無効化） |
| `▢` / `▦` | 分割ビューの切り替え（2 セッション必要） |
| `🗑` | アクティブセッションを終了 |

ヘッダー右側にはステータス（「Registered sessions: 2」やエラーなど）が表示されます。

### 分割ビュー

2 つ目のセッションを作成してから `▢` を押します。両ペインが同時に描画され、間の仕切りはドラッグでリサイズできます
（比率は 20〜80% に制限され、保存されます）。フォーカス中のペインは枠線で示され、クリックでアクティブになります。

### 画像のドロップ

画像をドラッグする際は **`Shift` を押したまま** ドロップします。押さない場合はエディタ側のドロップ処理が優先されるため、これは意図的な仕様です。
ファイルは拡張機能のグローバルストレージに保存され、**エスケープ済みの絶対パスがシェルに書き込まれます**。
画像パスを読む AI CLI にそのまま渡せます。

対象は `image/*` かつ 10MB 以下。画像以外は無視されます。

### 高さとテーマ

ターミナル下のハンドルをドラッグしてリサイズ（220〜1000px、保存されます）。
テーマのドロップダウンはプリセットを即時適用し、`aiTerminal.themePreset` に書き戻すため再起動後も維持されます。

### すべて閉じる

一番下の「Clear all sessions」は確認を挟んだ後、全シェルを終了し（`SIGTERM` → 2 秒後に `SIGKILL`）、
保存済み画像もすべて削除します。

## 機能一覧

| 機能 | 説明 |
|------|------|
| マルチセッション | 最大 2 つの PTY セッション。ドロップダウンで切り替え |
| 分割ビュー | 2 セッション同時表示。分割比はドラッグ可能で永続化 |
| セッション名 | `Terminal N` 形式。空き番号を再利用 |
| スクロールバック | xterm 側 3000 行 + セッションごと 2MB のバッファ（Webview 再読み込み時に再生） |
| 画像ドラッグ&ドロップ | `Shift` + ドロップ → グローバルストレージに保存し、エスケープ済みパスをシェルに入力 |
| 画像クリーンアップ | セッション終了時・拡張の deactivate 時・起動時（孤児と 24 時間 TTL）に削除 |
| 使用状況表示 | 保存画像の合計と拡張ホストの RSS。可視時に 30 秒ごと更新 |
| テーマプリセット | `modern`, `basic`, `clearDark`, `clearLight`, `grass`, `homebrew`, `manPage`, `ocean`, `pro` |
| 高さ調整 | ドラッグハンドル、220〜1000px、Webview state に永続化 |
| 起動コマンド | セッション作成直後に順番送信 |
| 作業ディレクトリ | ワークスペースルート（無ければホーム）。使用前に検証 |
| プロセス後始末 | プロセスツリー全体を終了。`SIGTERM` → 2 秒後に `SIGKILL` |
| ロギング | VS Code の `LogOutputChannel`（Output パネルの "Terminal For AI CLI"） |

## 設定項目

| 項目 | キー | 説明 |
|------|------|------|
| 既定シェル | `aiTerminal.defaultShell` | シェルの絶対パス。空ならログインシェル。不正なパスは警告のうえ既定にフォールバック。 |
| 起動コマンド | `aiTerminal.startupCommands` | セッション作成直後に順に送信するコマンド配列。不正な要素は除外されます。 |
| テーマプリセット | `aiTerminal.themePreset` | 9 プリセットのいずれか。Webview のドロップダウンも同じ設定を書き換えます。 |

## コマンド

| コマンド | 説明 |
|----------|------|
| `Terminal For AI CLI: フォーカス` | ターミナルビューにフォーカスして表示します。 |
| `Terminal For AI CLI: 新しいセッション` | 新しいターミナルセッションを作成します。 |
| `Terminal For AI CLI: 画像をクリーンアップ` | グローバルストレージの保存画像を削除します（確認あり）。 |

## ストレージとメモリ

ツールバーの表示は `💾 <保存画像> · 🧠 <RSS>` で、ビューが可視の間 30 秒ごとに更新されます。

**💾 保存画像** — `<globalStorage>/terminal-for-ai-cli/images/` 以下のファイルの合計サイズ。
ドロップした画像の実体です。削除タイミングは次のとおり：

| タイミング | 削除対象 |
|------------|----------|
| セッションを閉じた / シェルが終了した | そのセッションにドロップされた画像 |
| 「Clear all sessions」 | すべての画像 |
| 拡張の deactivate（ウィンドウを閉じた） | すべての画像 |
| 拡張の起動時 | クラッシュで残った孤児ファイルと、24 時間より古いファイル |

通常利用ではほぼ 0 のままです。増え続ける場合はクリーンアップが効いていないサインで、
追跡はメモリ上のため、エディタを強制終了すると次回起動時の掃除までファイルが残ります。

**🧠 RSS** — **拡張ホストプロセス** の `process.memoryUsage().rss`。このプロセスは共有で、
Node ランタイム・インストール済みの他の全拡張機能・`node-pty` などのネイティブモジュールを含みます。
この拡張単体の値ではありません。

含まれないもの：Webview（別のレンダラープロセス。xterm のスクロールバックはこちら）と、
起動したシェル本体（拡張ホストの子プロセス）。リークを察知するための傾向値として使ってください。

## セキュリティ

- **シェルパス検証** — プロセス起動前に、絶対パス・存在・実行可能を確認。
- **起動コマンドのサニタイズ** — 危険なパターンを警告しつつフィルタリング・検証。
- **作業ディレクトリ検証** — 使用前に存在を確認。
- **画像の検証** — MIME タイプ、10MB のサイズ上限、Base64 の整合性、パストラバーサル対策のファイル名サニタイズ。
- **シェルエスケープ** — ドロップ画像のパスはプラットフォーム別にクォートしてからシェルに書き込み。
- **厳格な CSP** — nonce ベースのスクリプト実行。nonce とセッション ID は `Math.random()` ではなく Node の `crypto` で生成。
- **`any` 型ゼロ** — Webview 境界をまたぐメッセージはすべて Discriminated Union + exhaustive check。
- **ネットワークアクセスなし** — 拡張機能は一切通信しません。

## 制限事項

| 項目 | 説明 |
|------|------|
| セッション上限 2 | サイドバーの実用性を保つための設計判断（`MAX_SESSIONS`）。 |
| 再起動をまたぐ復元は不可 | Webview リロードならバッファを再生できますが、IDE 再起動では OS プロセスが終了します。 |
| Windows の PTY 挙動 | ConPTY / winpty は概ね安定していますが、全画面 TUI やカーソル制御が重いアプリでは OS のターミナルと差が出ます。 |
| リサイズの遅延 | リサイズは即時通知されますが、Webview のレイアウト再計算でわずかに遅れることがあります。 |
| プリセットのみ | ユーザー定義の配色は未対応。 |
| Alpine / musl 非対応 | `linux-x64-musl` はパッケージングのマトリクスに含まれていません。 |

## トラブルシューティング

### 「Failed to create session」/ シェルが起動しない

`aiTerminal.defaultShell` を確認してください。**実行可能ファイルの絶対パス** である必要があり、
`zsh` のような名前だけの指定は拒否され、警告のうえログインシェルにフォールバックします。
詳細は Output パネルの「Terminal For AI CLI」に出ます。

### 画像をドロップしても何も起きない

**`Shift`** を押しながらドラッグしてください。加えて、`image/*` かつ 10MB 以下であること、
アクティブなセッションが存在することを確認してください（ドロップはアクティブセッションに送られます）。

### 分割ビューのボタンが効かない

分割ビューには **2 つ** のセッションが必要です。ステータスに
「Add a second session to enable split view.」と表示されます。

### 保存画像のサイズが増え続ける

エディタの強制終了などで、メモリ上の追跡から外れた孤児ファイルが残っている可能性が高いです。
`Terminal For AI CLI: 画像をクリーンアップ` を実行するか、再起動してください（起動時に孤児と 24 時間超のファイルを削除します）。

### RSS が大きく見える

拡張ホスト全体の値で、他の全拡張機能と共有です。[ストレージとメモリ](#ストレージとメモリ) を参照。
絶対値ではなく傾向を見てください。

### 他のマシンで VSIX が読み込めない

ローカルビルドの VSIX にはビルドしたプラットフォーム用の `node-pty` しか含まれません。
全プラットフォーム対応が必要な場合は `Export VSIX` ワークフローの artifact を使ってください。

## 開発

```bash
npm install
npm run compile        # bundle:webview + tsc -> dist/ と media/
npm run watch          # TypeScript ウォッチモード
npm run typecheck      # tsc --noEmit（以前の ESLint 工程の代替）
npm test               # Vitest
npm run test:coverage  # カバレッジレポート
npm run package        # vsix/ に VSIX を出力
```

VS Code / Cursor で `F5` を押すと Extension Development Host が起動します。

生成物: `dist/extension.js`（拡張ホスト）、`media/webview.js` + `media/webview.js.map` +
`media/xterm.css`（Webview）。
主要依存: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `esbuild`, `typescript`, `vitest`。

### アーキテクチャ

| 領域 | ファイル | 役割 |
|------|----------|------|
| エントリーポイント | `src/extension.ts` | コマンドと Webview プロバイダーの登録。 |
| ビュープロバイダー | `src/view/aiTerminalViewProvider.ts` | メッセージ処理、セッション管理、テーマ・使用状況の送信。 |
| Webview テンプレート | `src/view/htmlTemplate.ts` | Webview の HTML / CSS 骨格を生成。 |
| 画像ストレージ | `src/view/imageManager.ts` | ドロップ画像の保存、セッション単位の追跡、孤児の削除。 |
| テーマ定義 | `src/theming/themePresets.ts` | プリセット配色・プレビュー・検証。 |
| セッション管理 | `src/terminal/sessionManager.ts` | `node-pty` でシェルを起動し、入出力を中継、プロセスツリーを終了。 |
| 検証 | `src/utils/validation.ts` | シェルパス、起動コマンド、作業ディレクトリの検証。 |
| ロギング | `src/utils/logger.ts` | VS Code の `LogOutputChannel`。 |
| nonce | `src/utils/nonce.ts` | CSP 用の暗号学的に安全な nonce。 |

Webview（`src/webview/main.ts`）はクラスベース構成です。`DOMElements`（要素参照）、
`SessionStateManager` / `UIStateManager` / `ThemeStateManager`（状態）、`TerminalManager`（xterm インスタンス）、
`AppController`（イベント統括）。双方向のメッセージ型は `src/shared/types.ts` に定義されています。

### node-pty と全プラットフォーム対応パッケージ

`node-pty` はネイティブモジュールですが、1.1.0 は Node-API（`node-addon-api` 7）ビルドで ABI が安定しています。
そのため **エディタの Electron バージョンに合わせた再ビルドは不要** で、`npm install` で作ったバイナリが
VS Code / Cursor のどのバージョンでも動きます。差異は OS と CPU アーキテクチャだけです。

`Export VSIX` ワークフロー（`.github/workflows/export-vsix.yml`）はランナーマトリクスでビルドし、
**全プラットフォームで動く単一の VSIX** を組み立てます：

| ターゲット | `node_modules/node-pty/prebuilds/<target>/` に配置するファイル |
|------------|----------------------------------------------------------------|
| `darwin-arm64`, `darwin-x64` | `pty.node`, `spawn-helper` |
| `linux-x64`, `linux-arm64` | `pty.node` |
| `win32-x64`, `win32-arm64` | `pty.node`, `conpty.node`, `conpty_console_list.node`, `winpty.dll`, `winpty-agent.exe` |

ローダー（`lib/utils.js`）が実行時に `prebuilds/${process.platform}-${process.arch}/` を解決するため、
拡張側のコード変更は不要です。ローダーは `prebuilds/` より先に `build/Release` を探すため、
`node_modules/node-pty/build/**` は `.vscodeignore` で除外しています（同梱するとビルドしたマシンでしか動かない VSIX になります）。

パッケージ前に `node scripts/verify-prebuilds.mjs` を実行すると、全ターゲットが揃っているか、
`spawn-helper` の実行ビットが残っているかを確認できます。`npm run package` は、そのスロットが空のときだけ
現在の OS の `build/Release` を `prebuilds/` にコピーします。

### リリース手順

`release/Ver_X.Y.Z` ブランチを push します。`Export VSIX` ワークフローが以下を行います：

1. 各 OS/arch で `node-pty` をビルドし、全プラットフォーム対応の VSIX を 1 つ作成
2. `package.json` の version を `X.Y.Z` に設定（バージョンの正はブランチ名）
3. `Ver_X.Y.Z` タグで GitHub Release を公開し、`terminal-for-ai-cli-X.Y.Z.vsix` を添付
4. [Open VSX](https://open-vsx.org/extension/yuukisakai/terminal-for-ai-cli) に公開（`OVSX_TOKEN` 設定時。`+N` 再ビルドは対象外）
5. version の変更と更新後の `<!-- BEGIN:release -->` ブロックを **main に直接コミット**（release ブランチを手で main へマージする必要はありません）

**公開済みリリースは不変です。** `Ver_X.Y.Z` が既に存在する場合、`X.Y.Z` は保ったまま再ビルド番号を付けます
（`Ver_X.Y.Z+1`、次は `+2`）。`+N` はタグと資産名にだけ現れ、`package.json` には VS Code が要求する
数値3成分の `X.Y.Z` が入ります。

リリースノートは次の優先順で決まります：

| 優先 | 参照元 |
|------|--------|
| 1 | 手書きの `docs/release-notes/X.Y.Z.md`（同じ版の `+N` 再ビルドで共有） |
| 2 | 前版の `Ver_*` タグ以降のコミットから自動生成（`feat:` と `fix:` のみ） |
| 3 | `gh release create --generate-notes` へフォールバック |

リリース前に骨子を生成し、人間向けの文言に整えてください：

```bash
scripts/gen-release-notes.sh 0.0.3            # -> docs/release-notes/0.0.3.md
scripts/gen-release-notes.sh 0.0.3 --stdout   # 表示のみ
```

`release/**` の他のブランチへの push や手動実行では、Release は作らず VSIX を artifact として出力するだけです。

### アイコン

- **拡張機能アイコン**（`package.json` → `icon`）: `media/icon.png`、128×128 の透過 PNG。
- **アクティビティバーアイコン**（`contributes.viewsContainers.activitybar[].icon`）: `media/icon-bit.png`。Webview ヘッダーでも使用。

### CI/CD

| ワークフロー | トリガー | 内容 |
|--------------|----------|------|
| `ci.yml` | `feature/**`, `fix/**`, `main`, `develop` への push | 型チェック、コンパイル、Vitest、カバレッジ（Node 20.x） |
| `pr-check.yml` | すべての PR | フル検証、カバレッジコメント、バンドルサイズ、`npm audit`、TruffleHog |
| `export-vsix.yml` | `release/**` への push、手動実行 | 全プラットフォームの `node-pty` ビルド + VSIX artifact。`release/Ver_X.Y.Z` なら GitHub Release も公開 → [リリース手順](#リリース手順) |

マージ前にすべてのチェックに合格する必要があります。

## リンク

| | |
|---|---|
| ダウンロード | [Releases](https://github.com/den0206/terminal-for-ai-cli/releases/latest) |
| English README | [README.md](README.md) |
| 変更履歴 | [CHANGELOG.md](CHANGELOG.md) |
| バグ報告・要望 | [Issues](https://github.com/den0206/terminal-for-ai-cli/issues) |
| ライセンス | [MIT](LICENSE.md) |
