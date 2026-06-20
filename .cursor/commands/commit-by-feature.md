# 機能別にコミットを分割する

現在の未コミット変更を**機能・役割ごとに分けて**、複数のコミットに分割する。

## 手順

### 1. 変更の把握

- `git status -s` と `git diff --name-only`（必要なら `git diff --name-only --cached`）で変更・未追跡ファイル一覧を取得する。
- 各ファイルの役割を考慮し、**論理的なグループ**に分類する。

#### このプロジェクトでよく使うグループの例

| グループ | 対象ディレクトリ・ファイル例 |
|----------|---------------------------|
| ターミナル・セッション管理 | `src/terminal/` |
| Webview コントローラ | `src/webview/lib/resize-controller.ts`, `theme-controller.ts`, `drag-drop-handler.ts` |
| Webview メイン | `src/webview/main.ts`, `src/webview/lib/state-managers.ts` |
| 共有型定義 | `src/shared/` |
| Extension View | `src/view/aiTerminalViewProvider.ts`, `src/view/imageManager.ts`, `src/view/htmlTemplate.ts` |
| ユーティリティ | `src/utils/` |
| テーマ | `src/theming/`, `src/view/themeSnapshot.ts` |
| テスト | `*.test.ts`, `src/__mocks__/` |
| 依存関係・設定 | `package.json`, `package-lock.json`, `tsconfig.json` |

### 2. グループ分け案の提示

- グループごとに「含めるファイル」と「コミットメッセージ案」を一覧で提示する。
- 1 コミット＝1 つの論理的な変更単位にする。
- 同じ機能の「新規ファイル」と「既存ファイルの修正」は同じグループに含める。

### 3. グループごとにコミット

各グループに対して順に以下を実行する：

1. そのグループに属するファイルだけを `git add` する。
2. 簡潔な日本語の一行コミットメッセージで `git commit` する。
3. `git_write` 権限が必要。

### 4. 完了確認

- `git log --oneline -N`（N = コミット数）で作成したコミットを一覧表示する。
- `git status --short` でワーキングツリーがクリーンであることを確認する。

## コミットメッセージのルール

- `.cursorrules` の指示に従い、**日本語**で書く。
- 一行で簡潔に「何をしたか」を書く。句点は不要。
- 必要に応じてスコープや prefix を付けてよい（例: `refactor:`, `fix:`, `test:` など）。

### コミットメッセージの例

- `作業ディレクトリ解決を utils に集約`
- `リサイズ・テーマを Webview コントローラに分離`
- `画像管理を ImageManager クラスに抽出`
- `テスト追加: workingDirectory, themeSnapshot, webview utils`
- `devDependencies のパッチバージョン更新`

## 注意

- Push は行わない（明示的に指示された場合のみ）。
- コミット前に `npx tsc --noEmit` や `npm run lint` の実行は不要（`/review-for-merge` で行う）。
- 変更がない場合は空コミットを作成しない。
