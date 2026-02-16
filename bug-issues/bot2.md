# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] minecraft_move_to が目標座標に到達しない
- **症状**: `minecraft_move_to(x, y, z)`を呼んでも、実際の位置が変わらない、または目標と異なる座標に移動する
- **例**: `move_to(-71, 89, -49)` → 実際はY=90に移動。`move_to(-69, 62, -52)` → 実際はY=63に移動し、その後同じコマンドで位置が変わらない
- **原因**: `src/tools/movement.ts`の`minecraft_move_to`実装に問題がある可能性
- **影響**: 正確な位置への移動が必要な作業（チェスト操作、ブロック設置等）で支障
- **修正**: 未対応（要調査）
- **ファイル**: `src/tools/movement.ts`

### [2026-02-15] minecraft_open_chest / store_in_chest / list_chest がタイムアウト
- **症状**: チェスト操作系のツールが全て「Event windowOpen did not fire within timeout of 20000ms」でエラー
- **試行**: `open_chest`, `store_in_chest`, `list_chest`の全てで発生
- **原因**: チェストの近くにいても発生するため、`minecraft_move_to`の不具合でチェストから離れている可能性、またはチェスト操作自体のバグ
- **影響**: チームの共有チェストにアクセスできず、資源の預け入れ・取り出しができない
- **修正**: 未対応（要調査）
- **ファイル**: `src/tools/crafting.ts` または関連ファイル

### [2026-02-15] minecraft_use_item_on_block で水・溶岩バケツ取得失敗（未解決）
- **症状**: `use_item_on_block(bucket, x, y, z)`で水源・溶岩源に対して使用しても、water_bucket/lava_bucketがインベントリに反映されない
- **試行**:
  - 水源(-84, 64, -42): ⚠️ water_bucket not found
  - 溶岩源(-91, 63, -32): ⚠️ lava_bucket not found
  - 溶岩源(-90, 63, -32): ⚠️ lava_bucket not found
- **現在の実装**: `bot.activateBlock(block)`を使用、待機時間1000ms、インベントリ検証あり
- **影響**: 水バケツ・溶岩バケツが取得できず、黒曜石作成（水+溶岩）ができない
- **推定原因**:
  1. `activateBlock`が正しく動作していない
  2. 待機時間が不足（1000msでも足りない？）
  3. Mineflayerのバージョンや設定の問題
  4. ボットの位置が遠すぎる（3ブロック以内が必要？）
- **次のアクション**:
  1. ボットを水源/溶岩源の1ブロック隣に正確に移動
  2. `bot.equip(bucket)`で手に装備してから`activateBlock`
  3. イベントリスナー(`itemDrop`, `windowOpen`)で状態変化を監視
  4. 別のAPIメソッド（`bot.useOn`, `bot.activateItem`）を試す
- **ファイル**: `src/bot-manager/bot-blocks.ts`(Line 1215-1243)

---

### [2026-02-16] stick クラフトバグ（✅解決）
- **症状**: `minecraft_craft(item_name="stick")` で birch_planks x5 所持も "missing ingredient" エラー
- **原因**: `src/bot-manager/bot-crafting.ts` の `compatibleRecipe` 検索ロジック（line 496-525）で、manual recipe が除外されていた
  - stick の manual recipe は planks のみを使用（sticks は不要）
  - 検索ロジックは `needsPlanks || needsSticks` をチェックするが、stick recipe は `needsSticks = false` となり、条件にマッチしなかった
- **影響**: stick が作れず、石ツール（Phase 3 目標）が作成できない
- **修正**: ✅完了（line 496-530）
  - stick/crafting_table の場合は `needsPlanks && !needsSticks` の条件を追加
  - planks の数だけチェックするように修正
- **ファイル**: `src/bot-manager/bot-crafting.ts`

---

### [2026-02-16] Claudeエージェント起動直後にシャットダウン（未解決）
- **症状**: `npm run start:claude`でエージェント起動後、Loop 1開始→MCP接続→イベント購読→即座にシャットダウン
- **ログ**:
  ```
  [Agent] === Loop 1 ===
  [MCP-WS] Connected to MCP server
  [Claude] MCP hook connection ready
  [Claude] Subscribed to events for Claude2
  [Agent] Shutting down...
  ```
- **推定原因**:
  1. Claude SDK の `query()` 関数が Claude Code 環境で正常に動作しない
  2. OAuth認証に問題がある
  3. `runQuery()` がエラーをスローせずにプロセスを終了させている
- **調査内容**:
  - エラーログなし（例外は発生していない）
  - `cleanup()` が呼ばれている（SIGINT/SIGTERM または fatal error）
  - `runQuery()` が実行される前にシャットダウンしている可能性
- **次のアクション**:
  1. `claude-client.ts` の `runQuery` にデバッグログ追加
  2. Claude SDK のバージョンとClaude Code互換性確認
  3. 別の認証方法を試す（API キー直接指定）
  4. フォアグラウンドで実行してすべての出力をキャプチャ
- **影響**: Claude2エージェントが自律動作できない。手動でMCPツールを呼び出す必要あり
- **ファイル**: `src/agent/claude-agent.ts`, `src/agent/claude-client.ts`

---

### [2026-02-16] ネザーポータル進入機能がない（✅解決）
- **症状**: ネザーポータルブロックの近くに移動しても、ネザーに自動転送されない
- **試行**:
  - `move_to(8, 107, -3)` でポータルブロック座標に移動
  - ポータルブロック上で6秒待機
  - 結果: テレポート発生せず、オーバーワールドに留まる
- **原因**: `minecraft_enter_portal` ツール定義は存在するが、ハンドラーが未実装だった
  - `src/bot-manager/bot-movement.ts` に `enterPortal` 関数は存在
  - `src/bot-manager/index.ts` でインポート・エクスポートされていない
  - `src/tools/movement.ts` の `handleMovementTool` にケースが未追加
- **影響**: Phase 6（ネザー）でネザーに突入できない。ブレイズロッド・エンダーパール収集不可
- **修正**: ✅完了
  1. `src/bot-manager/index.ts`: `enterPortal` をインポート（line 28）
  2. `src/bot-manager/index.ts`: `BotManager.enterPortal` メソッド追加（line 166-170）
  3. `src/tools/movement.ts`: `minecraft_enter_portal` ケース追加（line 109-112）
  4. ビルド成功
- **ファイル**: `src/tools/movement.ts`, `src/bot-manager/index.ts`

---

### [2026-02-16] ネザーからオーバーワールドへ勝手に転送される
- **症状**: `/tp execute in minecraft:the_nether run tp Claude2 290 80 -97`でネザーに転送された後、数秒でオーバーワールドに戻される
- **詳細**:
  - ネザーのブレイズスポナー(290, 78, -97)真上にTP成功
  - ブレイズ1体を倒した直後、アイテム回収を試みたが何も見つからず
  - 5秒待機後、entity確認でzombie/spider/skeleton等のオーバーワールド敵が出現
  - 位置確認でオーバーワールド(5.5, 102, -5.5)に戻っていた
- **推定原因**:
  1. ネザーポータルのリンクが正しく設定されていない
  2. スポナー真上にいたため、ポータルブロックの影響範囲内だった可能性
  3. サーバー側のネザー/オーバーワールド同期の問題
- **影響**: ブレイズ狩りができず、Phase 6が進まない
- **次のアクション**:
  1. スポナーから離れた場所（5-10ブロック）にTPしてもらう
  2. ネザー要塞内の別の安全な場所で待機
  3. ポータルを再構築してリンクを修正
- **ファイル**: サーバー設定またはポータル構造の問題

---

### [2026-02-16] throwItem / tillSoil インポートエラー（✅解決）
- **症状**: MCPサーバー起動時に `SyntaxError: The requested module './bot-blocks.js' does not provide an export named 'throwItem'` で起動失敗
- **原因**: `src/bot-manager/index.ts` で `throwItem`, `tillSoil` をインポートしているが、`bot-blocks.ts` に関数が定義されていなかった
- **影響**: MCPサーバーが起動できない
- **修正**: ✅完了
  - `src/bot-manager/bot-blocks.ts` に `throwItem` 関数を実装（line 1296-1323）
  - `src/bot-manager/bot-blocks.ts` に `tillSoil` 関数を実装（line 1267-1293）
  - `src/bot-manager/index.ts` の `digBlock` 呼び出しで不要な `force` 引数を削除
  - `src/tools/building.ts` の `digBlock` 呼び出しで不要な `force` 引数を削除
  - ビルド成功
- **ファイル**: `src/bot-manager/bot-blocks.ts`, `src/bot-manager/index.ts`, `src/tools/building.ts`

---

### [2026-02-16] crafting_table クラフト後にインベントリから消失
- **症状**: `minecraft_craft(item_name="crafting_table")` 成功後、"Crafted 1x crafting_table"メッセージが表示されるが、その直後のインベントリには存在しない
- **試行**:
  - 1回目: クラフト成功 → `place_block(crafting_table)` で "No crafting_table in inventory" エラー
  - 2回目: 再度クラフト成功 → またインベントリから消失
- **影響**: 鉄ツール（iron_pickaxe等）が作成できず、石ブロックが掘れない。ネザーから脱出不可
- **推定原因**:
  1. `minecraft_craft` のインベントリ同期問題（アイテムが実際には追加されていない）
  2. クラフト成功メッセージとインベントリ状態に乖離がある
  3. `bot.inventory.items()` の取得タイミングが早すぎる
- **次のアクション**:
  1. `src/bot-manager/bot-crafting.ts` の `craft` 関数を調査
  2. クラフト後の待機時間を追加
  3. インベントリ同期を確認するデバッグログ追加
- **ファイル**: `src/bot-manager/bot-crafting.ts`

---
