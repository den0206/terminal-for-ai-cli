# Change Log

All notable changes to the "Terminal For AI CLI" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **ターミナル別テーマ**: Terminal 1 / Terminal 2 がそれぞれ独立したテーマプリセットを持てるように変更。ビュー内のドロップダウンはフォーカス中のターミナルに適用され（対象は「Theme」ラベル横のバッジで表示）、`aiTerminal.themePreset`（Terminal 1）と新設の `aiTerminal.themePresetSecondary`（Terminal 2）に保存。`aiTerminal.themePresetSecondary` が空の場合は Terminal 1 のテーマを引き継ぐ。分割ビューでは各ペインが枠線を含めてそれぞれの配色で描画される
- **リリース自動化**: `release/Ver_X.Y.Z` ブランチの push で、全プラットフォーム対応 VSIX のビルド → `package.json` の version 反映 → `Ver_X.Y.Z` タグの GitHub Release 公開（VSIX 添付）まで `Export VSIX` ワークフローが実行。既存タグと衝突する場合は `+N` で採番し、公開済みリリースは不変
- **リリースノート生成**: `scripts/gen-release-notes.sh` が前版タグ以降の `feat:` / `fix:` コミットから骨子を生成。手書きの `docs/release-notes/X.Y.Z.md` があればそちらを優先
- **README のリリース情報自動更新**: 公開後、`scripts/update-readme-release-info.mjs` が README.md / README_JP.md の `release` ブロックを更新してコミット
- **使用状況インジケータ**: Webview ツールバー（セッション選択と `+` の間）に、保存済み画像の合計サイズと拡張ホストの RSS を表示。ビューが可視の間、30 秒ごとに更新
- **包括的なJSDocコメント**: 主要クラス（`AiTerminalViewProvider`、`ShellSession`、`extension.ts`）に詳細なドキュメンテーションを追加
- **広範なテストスイート**: `aiTerminalViewProvider.test.ts`に48個の新規テストケースを追加（合計116テスト、成功率93.1%）
- **拡張CI/CDワークフロー**:
  - 複数OS（Ubuntu、macOS、Windows）でのマトリックステスト
  - 複数Node.jsバージョン（18.x、20.x）でのテスト
  - セキュリティ監査（npm audit、TruffleHog）
  - プルリクエスト自動チェックとコメント
  - バンドルサイズチェック
- **改善されたテストカバレッジ**: 以下の機能に対する包括的なテスト
  - メッセージハンドリング（webview-ready、session管理、terminal操作）
  - セッション管理（ラベル割り当て、番号再利用、終了処理）
  - テーマ管理（プリセット選択、検証）
  - 画像処理（MIME検証、サイズ制限、ファイル名サニタイズ）
  - エラーハンドリングとパフォーマンス

### Improved

- **コード品質**: TypeScript strict mode、any型の排除、exhaustive checkの実装
- **ドキュメンテーション**:
  - クラス、メソッド、パラメータに詳細な説明を追加
  - 使用例、remarks、関連参照の追加
  - アーキテクチャ図とメッセージフローの文書化
- **テストの安定性**: 非同期処理のタイミング調整、モックの改善

### Documentation

- README.md / README_JP.md をユーザー向け構成に刷新（目次、機能一覧、ストレージとメモリ、制限事項、トラブルシューティング、開発の各セクション）
- プロジェクト品質スコア: **88点 → 93点**に向上
- テストカバレッジ: 68テスト → 116テスト（+48テスト）
- ドキュメンテーションスコア: 12/20 → 18/20に向上

## [0.0.2] - 2024-12-07

### Changed

- ターミナルバックエンドを `node-pty` に移行し、パフォーマンスと互換性を向上

## [0.0.1] - Initial Release

### Added

- セカンダリサイドバーでのターミナルビュー機能
- 複数セッションの管理機能
- セッションの分割ビュー対応
- 画像のドラッグ＆ドロップ機能
- 自動画像クリーンアップ機能
- カスタマイズ可能なテーマプリセット（modern, basic, clearDark, clearLight, grass, homebrew, manPage, ocean, pro）
- 起動時コマンドの設定
- シェルパスのカスタマイズ
- セキュアな入力検証機能
- 集中型ログシステム

