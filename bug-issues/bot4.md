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

## [2026-02-15] minecraft_use_item_on_block water bucket bug

- **症状**: `minecraft_use_item_on_block`で水源から水を汲んでも、インベントリに`water_bucket`ではなく空の`bucket`のまま残る。メッセージは「Collected water with bucket → now holding bucket. Block at (-69, 62, -52) cleared.」と表示されるが、実際には水が入っていない
- **原因**: `bot.activateBlock(block)`の後、待機時間が300msと短く、インベントリ更新が間に合わなかった。また、`bot.heldItem`ではなくインベントリ全体から`water_bucket`を探す必要があった
- **影響**: 黒曜石作成にwater_bucketが必要だが、バケツで水を汲めないため作業不可
- **修正内容**:
  1. 待機時間を300ms→500msに延長
  2. インベントリ全体から`water_bucket`または`lava_bucket`を検索して確認
  3. バケツが正しく変換されていない場合、明示的にバグメッセージを返す
- **ファイル**: `src/bot-manager/bot-blocks.ts:1210-1236`
- **ステータス**: ✅ 修正完了・ビルド成功

## [2026-02-15] minecraft_take_from_chest timeout error

- **症状**: `minecraft_take_from_chest`で「Event windowOpen did not fire within timeout of 20000ms」エラーが発生。`minecraft_open_chest`は成功してチェスト内容を表示できるが、その直後の`minecraft_take_from_chest`がタイムアウトする
- **再現手順**:
  1. `minecraft_open_chest(x, y, z)` → 成功（チェスト内容表示）
  2. `minecraft_take_from_chest(item_name, count)` → タイムアウトエラー
- **原因**: `minecraft_take_from_chest`がチェストを再度開こうとしているが、既に開いているウィンドウの処理が正しくない可能性
- **影響**: チェストからアイテムを取得できないため、拠点の共有リソースにアクセス不可
- **回避策**: 調査中
- **修正予定**: `src/tools/crafting.ts`の`minecraft_take_from_chest`実装を調査
- **ファイル**: `src/tools/crafting.ts`
- **ステータス**: ⚠️ 未修正（調査中）

