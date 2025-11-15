# Terminal for AI CLI

Terminal for AI CLI は Cursor / VS Code のセカンダリサイドバーに常駐するマルチセッション対応ターミナル拡張です。`xterm.js` をベースにした Webview と、Node.js + Python ブリッジで構成された `SessionManager` により、IDE 内で複数シェルを高速に切り替えられます。

> 🇺🇸 英語版はこちら: [`README.md`](README.md)。内容は両ファイルで同期されています。

---

## 特徴

- Webview 内で複数のシェルを同時に管理し、ドロップダウンから瞬時に切り替え可能。
- セッションごとのスクロールバックを保持し、Webview を再読み込みしても出力を復元。
- `Terminal 1` など連番ラベルは空いた番号を再利用するため、順序が崩れません。
- Modern / Basic / Homebrew などのテーマプリセットを即時適用、VS Code の配色と連動。
- ドラッグで端の高さを変更し、値は永続化。
- 「Clear all sessions」セクションで、確認ダイアログを挟んで全セッションを安全に終了。
- 既定シェル・起動時コマンド・テーマプリセットを VS Code 設定からカスタマイズ可能。
- 主要コードは TypeScript (`src/extension.ts`, `src/webview/main.ts`, `src/terminal/sessionManager.ts`) で統一し、`dist/` と `media/` にビルド成果物を出力。

---

## 使用方法

1. **依存関係をインストール**
   ```bash
   npm install
   ```
2. **ビルド / バンドル**
   ```bash
   npm run compile
   ```
3. **Extension Development Host で起動**
   - VS Code / Cursor で `F5` を押し、Extension Development Host を立ち上げます。
   - Activity Bar から「Terminal For AI CLI」ビューを開くと、自動的に最初のセッションが生成されます。
4. **UI 操作**
   - **ドロップダウン**: 任意のセッションを選択。
   - **`+` / 🗑**: 新規セッション作成 / アクティブセッション終了。
   - **Clear all sessions**: Theme セクション下の確認 UI から、全シェルをまとめて終了。
   - **テーマセレクタ**: プリセットのテーマを即時適用。
   - **リサイズハンドル**: ドラッグでターミナル高さを変更（設定は保存）。

---

## 設定項目 (VS Code Settings)

| 項目 | キー | 説明 |
| --- | --- | --- |
| 既定シェル | `aiTerminal.defaultShell` | 起動時に使用するシェルのパス。空の場合はユーザーのデフォルトシェル。 |
| 起動コマンド | `aiTerminal.startupCommands` | セッション作成直後に順に送信するコマンド配列。 |
| テーマプリセット | `aiTerminal.themePreset` | `modern` / `basic` / `clearDark` / `clearLight` / `grass` / `homebrew` / `manPage` / `ocean` / `pro` のいずれか。Webview からも同じプリセットを選択できます。 |

---

## 既知の課題 / 制限

| 項目 | 説明 |
| --- | --- |
| Windows での PTY | Windows では Python PTY ブリッジの代わりに単純な `spawn` fallback を使用するため、全画面アプリやカーソル制御が不安定になる場合があります。 |
| リサイズ伝搬 | Python ブリッジ経由で JSON / SIGWINCH 事件を送るため、環境によっては反映がわずかに遅れることがあります。 |
| セッション復元 | Webview の再読み込みでは出力を復元できる一方、IDE 自体を再起動すると OS 側のプロセスは終了します。永続化ロジックを強化予定です。 |
| テーマカスタム | 現状はプリセットのみ。ユーザー定義の配色を受け付ける API は今後実装予定。 |
| ログ出力 | 旧イベントログを廃止したため、今後は VS Code の Output チャンネル等を検討中。 |

---

## ロードマップ

1. **Windows 向け Pseudo Console / winpty 連携** による安定した描画。
2. **永続的なセッション復元**（IDE 再起動後も再生成できるようにする）。
3. **テーマ JSON のユーザー提供** を `settings.json` でサポート。
4. **コマンド履歴 / スニペット連携** によるワンクリック送信。
5. **Telemetry / ログ改善**（Output channel・通知センターとの統合）。

---

## 開発メモ

- `npm run bundle:webview`：`src/webview/main.ts` を IIFE 形式で `media/webview.js` に出力。
- `npm run compile`：上記 + `tsc -p ./` により `dist/extension.js` を出力。
- `npm run watch`：TypeScript のウォッチモード。
- 主要依存: `@xterm/xterm`, `@xterm/addon-fit`, `esbuild`, `typescript`, VS Code API, Python 3 (Unix での PTY ブリッジ用)。
- 生成物: `dist/extension.js`, `media/webview.js`, `media/webview.js.map`, `media/xterm.css`。

---

## ローカライズ

- 英語版: [`README.md`](README.md)
- 日本語版: `README_JP.md`（本ファイル）

両言語で同じ内容を共有しているため、好みの言語で参照してください。
