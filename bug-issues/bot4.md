# Bot4 - Bug & Issue Report

このファイルはBot4専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

## [2026-02-15] buildSystemPromptFromConfig missing export

- **症状**: エージェント起動時に`Export named 'buildSystemPromptFromConfig' not found in module`エラー
- **原因**: `claude-agent.ts`がインポートしようとしたが`claude-client.ts`にエクスポートされていなかった
- **修正**:
  1. `buildSystemPromptFromConfig`関数を`claude-client.ts`に追加・エクスポート
  2. `updateSystemPrompt`メソッドを`ClaudeClient`に追加
  3. `callMCPTool`メソッドを`ClaudeClient`に追加
  4. `AgentResult`に`toolCalls`フィールド追加
- **ファイル**: `src/agent/claude-client.ts`
- **ステータス**: ✅ 修正完了

