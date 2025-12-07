# Terminal for AI CLI

[![CI](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/ci.yml)
[![PR Check](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/pr-check.yml/badge.svg)](https://github.com/den0206/terminal-for-ai-cli/actions/workflows/pr-check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Terminal for AI CLI は Cursor / VS Code のセカンダリサイドバーに常駐するマルチセッション対応ターミナル拡張です。`xterm.js` をベースにした Webview と、`node-pty` を利用する軽量な `SessionManager` により、IDE 内で複数シェルを高速に切り替えられます。

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
- **セキュリティ強化**: シェルパスとコマンドの入力検証、暗号学的に安全なランダム生成、画像ファイルサイズ制限（10MB）を実装。
- **型安全**: Discriminated Unions によるメッセージ処理で、`any` 型を完全排除。
- **テスト済み**: Vitest による包括的なテストスイート（33以上のテストでユーティリティ、検証、ロギングをカバー）。
- **堅牢なロギング**: VS Code Output チャンネルを使用した一元化されたロギングシステムで、デバッグとトラブルシューティングが容易。
- **リソース管理**: メモリリークとストレージ圧迫を防ぐため、セッションバッファ、メッセージキュー、孤児画像の自動クリーンアップ機能を実装。
- **画像クリーンアップ**: 拡張機能起動時に孤児画像を自動削除。コマンドパレットから手動クリーンアップも可能。
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

## コマンド

| コマンド | 説明 |
| --- | --- |
| `Terminal For AI CLI: フォーカス` | ターミナルビューにフォーカスして表示します。 |
| `Terminal For AI CLI: 新しいセッション` | 新しいターミナルセッションを作成します。 |
| `Terminal For AI CLI: 画像をクリーンアップ` | グローバルストレージに保存された画像を手動で削除します。削除前に確認ダイアログを表示します。 |

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
| Windows での PTY | Windows では `node-pty`（ConPTY / winpty）を利用しており概ね安定していますが、全画面アプリや特殊なカーソル制御では OS のターミナルと挙動が異なる場合があります。 |
| リサイズ伝搬 | `node-pty` で即時にリサイズを通知しますが、Webview レイアウトの再計算により遅延が発生するケースがあります。 |
| セッション復元 | Webview の再読み込みでは出力を復元できる一方、IDE 自体を再起動すると OS 側のプロセスは終了します。永続化ロジックを強化予定です。 |
| テーマカスタム | 現状はプリセットのみ。ユーザー定義の配色を受け付ける API は今後実装予定。 |

---

## ロードマップ

1. **Windows 向け Pseudo Console / winpty 連携** による安定した描画。
2. **永続的なセッション復元**（IDE 再起動後も再生成できるようにする）。
3. **テーマ JSON のユーザー提供** を `settings.json` でサポート。
4. **コマンド履歴 / スニペット連携** によるワンクリック送信。

---

## セキュリティ

Terminal For AI CLI は、一般的な脆弱性から保護するための複数のセキュリティ対策を実装しています：

### 入力検証
- **シェルパスの検証**: プロセス起動前に、シェルパスが絶対パスであり、存在し、実行可能であることを確認します。
- **起動コマンドのサニタイズ**: 起動コマンドをフィルタリングおよび検証し、危険なパターンに対して警告を表示します。
- **作業ディレクトリの検証**: 使用前に作業ディレクトリが有効で存在することを確認します。
- **画像ファイルの検証**: 画像ファイルサイズ（10MB 制限）、Base64 データの整合性、パストラバーサル攻撃を防ぐためのファイル名サニタイズを実装。

### 暗号化セキュリティ
- **安全なランダム生成**: セッション ID と CSP nonce の生成に、`Math.random()` ではなく Node.js の `crypto` モジュールを使用します。
- **コンテンツセキュリティポリシー**: XSS 攻撃を防ぐため、nonce ベースのスクリプト実行による厳格な CSP を実装しています。

### 型安全性
- **`any` 型ゼロ**: すべてのメッセージハンドラーで、型安全なメッセージルーティングのために厳格な TypeScript Discriminated Unions を使用します。
- **厳格なコンパイル**: 包括的な型チェックで TypeScript strict モードを有効化しています。

### テスト
- **自動テスト**: 検証ロジック、ランダム生成、セキュリティ機能、ロギングをカバーする 33 以上のユニットテストを実装。
- **継続的な検証**: ESLint がコード品質を強制し、開発時に潜在的な問題を検出します。

### ロギング・デバッグ
- **一元化されたロギング**: タイムスタンプとログレベルを含む構造化ログのための VS Code Output チャンネル統合。
- **エラートラッキング**: トラブルシューティングのための詳細なログを含む包括的なエラーハンドリング。
- **リソース監視**: メモリ問題を防ぐため、セッションバッファとメッセージキューの自動クリーンアップ。

---

## 開発メモ

- `npm run bundle:webview`：`src/webview/main.ts` を IIFE 形式で `media/webview.js` に出力。
- `npm run compile`：上記 + `tsc -p ./` により `dist/extension.js` を出力。
- `npm run watch`：TypeScript のウォッチモード。
- `npm run lint`：ESLint でソースコードを検証。
- `npm test`：Vitest でテストスイートを実行。
- `npm run test:watch`：テストをウォッチモードで実行。
- `npm run test:coverage`：テストカバレッジレポートを生成。
- 主要依存: `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `esbuild`, `typescript`, `vitest`, VS Code API。
- 生成物: `dist/extension.js`, `media/webview.js`, `media/webview.js.map`, `media/xterm.css`。

### node-pty の再ビルド

VS Code / Cursor の拡張ホストでは Electron 固有の Node.js が使われるため、`node-pty` をその Electron 版に合わせて再ビルドする必要があります。`NODE_MODULE_VERSION` の不一致（例: 131 vs 136）で拡張の有効化に失敗した場合は、次の手順で解消できます。

1. VS Code の「ヘルプ > バージョン情報」（macOS は「Code > バージョン情報」）や `code --status` で Electron のバージョンを確認する。
2. リポジトリ直下で以下を実行する（例: Electron 31.4.0 の場合）。

   ```bash
   npm run rebuild:pty -- --electron 31.4.0
   ```

   Apple Silicon で x64 版 VSIX を作る場合は `--arch=x64` を追加できます。

3. VSIX の作成や CI ビルドの前にも同コマンドを実行し、生成された `node_modules/node-pty/build/Release/pty.node` を配布物に含める。

### 拡張機能アイコン

拡張機能では2つのアイコンファイルを使用しています：

- **拡張機能アイコン** (`package.json` → `icon`): `media/icon.png` (128x128 PNG 推奨、透過対応)
  - VS Code マーケットプレイスと拡張機能ビューに表示されます
  - 正方形の PNG 画像で、透過（アルファチャンネル）に対応しています

- **アクティビティバーアイコン** (`package.json` → `contributes.viewsContainers.activitybar[].icon`): `media/icon-bit.png`
  - VS Code のアクティビティバーに表示されます
  - PNG または SVG 形式に対応しています
  - Webview UI でも使用されます (`src/view/aiTerminalViewProvider.ts`)

**注意**: 最適な表示のため、両方のアイコンに透過 PNG（アルファチャンネル）を使用することを推奨します。拡張機能アイコンは VS Code マーケットプレイスでの最適な表示のために 128x128 ピクセルを推奨します。

### CI/CD

プロジェクトは継続的インテグレーションに GitHub Actions を使用しています：

- **CI ワークフロー** (`.github/workflows/ci.yml`): `feature/**`、`fix/**`、`main`、`develop` ブランチへのプッシュ時に実行
  - ESLint による lint チェック
  - TypeScript コンパイル
  - Vitest によるテスト実行
  - テストカバレッジレポート生成
  - 複数バージョンの Node.js でテスト (18.x, 20.x)

- **PR チェックワークフロー** (`.github/workflows/pr-check.yml`): すべてのプルリクエストで実行
  - フル検証スイート（lint、型チェック、テスト）
  - PR コメントとしてカバレッジレポートを投稿
  - バンドルサイズチェックと警告
  - npm audit によるセキュリティ監査
  - TruffleHog によるシークレットスキャン

プルリクエストをマージする前に、すべてのチェックに合格する必要があります。

### アーキテクチャ概要

| 領域 | ファイル | 役割 |
| --- | --- | --- |
| エントリーポイント | `src/extension.ts` | コマンド登録と Webview プロバイダーの登録。 |
| ビュープロバイダー | `src/view/aiTerminalViewProvider.ts` | メッセージ処理、セッション管理、テーマ情報の送信。 |
| Webview テンプレート | `src/view/htmlTemplate.ts` | Webview の HTML / CSS 骨格を生成。 |
| テーマ定義 | `src/theming/themePresets.ts` | プリセット配色・プレビュー・バリデーションを提供。 |
| セッション管理 | `src/terminal/sessionManager.ts` | `node-pty` でシェルを起動し、Webview との入出力・クリーンアップを調整。 |
| セキュリティ・検証 | `src/utils/validation.ts` | シェルパス、起動コマンド、作業ディレクトリの検証。 |
| ロギング | `src/utils/logger.ts` | VS Code Output チャンネルを使用した一元化されたロギングシステム。 |
| ユーティリティ | `src/utils/nonce.ts` | CSP 用の暗号学的に安全な nonce を生成。 |

### Webview アーキテクチャ (`src/webview/main.ts`)

Webview UI は保守性とテスト容易性を向上させるため、クラスベースのアーキテクチャで構築されています：

| クラス | 役割 |
| --- | --- |
| `Constants` | 設定値の一元管理（MAX_SESSIONS、BUFFER_SIZE など）。 |
| `DOMElements` | すべての DOM 要素参照を一箇所で管理。 |
| `SessionStateManager` | セッション状態の管理（activeSession、sessionIds、buffers）。 |
| `UIStateManager` | UI 状態の管理（pendingRequest、viewMode、splitRatio、paneSessions）。 |
| `ThemeStateManager` | テーマ状態の管理（currentThemeKey、availablePresets）。 |
| `TerminalManager` | xterm.js ターミナルインスタンスと DOM 操作の管理。 |
| `AppController` | イベント処理と状態調整を統括するメインコントローラー。 |

このアーキテクチャの利点：
- **カプセル化**: すべてのグローバル変数がクラスのプライベートフィールドにカプセル化。
- **単一責任**: 各クラスが明確で集中した責任を持つ。
- **テスト容易性**: 独立した状態管理によりユニットテストが容易。
- **保守性**: 状態変更の追跡とデバッグが容易。

---

## ローカライズ

- 英語版: [`README.md`](README.md)
- 日本語版: `README_JP.md`（本ファイル）

両言語で同じ内容を共有しているため、好みの言語で参照してください。
