# AI Terminal

AI Terminal は Cursor / VS Code のセカンダリサイドバーに常駐する多機能ターミナル拡張です。`xterm.js` をベースに、セッション管理やテーマのプリセット選択などを提供し、IDE 内で複数シェルを素早く切り替えられるようにします。

---

## 進捗状況

- [x] Webview ベースのターミナル UI を構築し、セッションごとに `xterm.js` を描画
- [x] 独自の `SessionManager` により `node-pty` を使わずに PTY を生成（Python ブリッジ + fallback）
- [x] セッションの追加 / 削除 / ドロップダウン切り替え、出力バッファの復元、サイズ変更ハンドルを実装
- [x] `ターミナル{n}` のわかりやすい名前付けと永続化、Webview 再起動時のセッション再接続
- [x] テーマプリセット（Modern, Basic, Clear Dark ...）を追加し、UI から切り替え
- [x] README 以外の主要コード ( `src/extension.ts`, `src/webview/main.ts`, `src/terminal/sessionManager.ts` ) を TypeScript 化 & ビルド済み
- [x] イベントログ機能を削除し、UI をシンプル化（ユーザー要望対応済み）
- [ ] （今後の予定）セッションごとのステータスや自動再接続ポリシーなど高度な管理

---

## 使用方法

1. **依存関係のインストール**
   ```bash
   npm install
   ```
2. **ビルド / TypeScript コンパイル**
   ```bash
   npm run compile
   ```
3. **開発ホストでデバッグ**
   - VS Code / Cursor で `F5` を押し、Extension Development Host を起動
   - サイドバーの「AI Terminal」ビューを開くと自動的にセッションが 1 つ作成されます
4. **操作**
   - 上部のドロップダウンで既存セッションを選択
   - `+` ボタンで新しいセッションを追加
   - 🗑 ボタンでアクティブセッションを終了
   - テーマセレクトから好みのプリセットを選択（即時反映）
   - ドラッグハンドルでターミナル領域の高さを調整（設定は永続化）

---

## 改善点・既知の課題

| 項目 | 説明 |
| --- | --- |
| Windows での PTY | 現状は Python の `pty` ブリッジを使う Unix 最適化実装。Windows では単純な `spawn` fallback のため、全画面アプリやカーソル制御が不安定な可能性があります。 |
| 端末リサイズ通知 |  `script`/Python ブリッジ経由のリサイズは SIGWINCH/JSON コマンドで送信しているが、環境によって反映が遅れる場合があります。 |
| セッション永続化 | Webview リロード時に出力バッファを再描画しているものの、IDE を完全に再起動すると OS 側でプロセスが切れるため、より堅牢な復元ロジックが必要です。 |
| 設定 UI | テーマはプリセットを導入したが、ユーザー独自の配色を JSON で定義するオプションは未実装。 |
| ログ / 通知 | イベントログ機能を削除したため、今後は VS Code の通知センターや Output channel への記録を検討。 |

---

## 今後のステップ

1. **Windows 向け擬似コンソール対応**  
   - PowerShell の Pseudo Console API や `winpty` 互換レイヤーを採用し、等幅描画を改善
2. **セッション復元の強化**  
   - Extension host 側でセッション状態を永続化し、IDE 再起動後も同じシェルを再生成
3. **カスタムテーマの導入**  
   - `settings.json` で任意のテーマオブジェクトを指定できるようにする
4. **コマンド履歴 / スニペット連携**  
   - よく使うコマンドをプリセット化し、ボタン一つで送信
5. **テレメトリ / ログ出力の整備**  
   - エラー復旧を容易にするため、Output チャンネルに詳細ログを書き出す

---

## 開発メモ

- **ビルドコマンド**  
  - `npm run bundle:webview`：Webview JavaScript の IIFE バンドル
  - `npm run compile`：上記 + `tsc` による extension/server 側のビルド
- **依存関係**  
  - `@xterm/xterm` / `@xterm/addon-fit`（Webview）  
  - `python3`（Unix のみ、PTY ブリッジ用）  
  - VS Code API (`vscode`), Node.js 18+
- **出力先**  
  - Extension code: `dist/extension.js`  
  - Webview bundle: `media/webview.js`, `media/xterm.css`

開発の際は `README` に記載の手順でビルドし、Extension Development Host で確認してください。質問や改善要望があれば issue へどうぞ。
