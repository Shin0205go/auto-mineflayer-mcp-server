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
- **原因**: `minecraft_use_item_on_block`ツールの実装でバケツのアイテム更新処理が正しく動作していない可能性。Mineflayerの`activateItem()`または`bot.inventory`の更新タイミングの問題
- **影響**: 黒曜石作成にwater_bucketが必要だが、バケツで水を汲めないため作業不可
- **回避策**: 水源と溶岩源を直接隣接させて黒曜石を生成する（バケツを使わない方法）
- **修正予定**: `src/tools/building.ts`の`minecraft_use_item_on_block`実装を調査・修正
- **ファイル**: `src/tools/building.ts`
- **ステータス**: ⚠️ 未修正（回避策で進行中）

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

