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

### [2026-02-16] ネザーポータル進入機能がない（調査中）
- **症状**: ネザーポータルブロックの近くに移動しても、ネザーに自動転送されない
- **試行**:
  - `move_to(8, 107, -3)` でポータルブロック座標に移動
  - ポータルブロック上で6秒待機
  - 結果: テレポート発生せず、オーバーワールドに留まる
- **原因**: Mineflayerでネザーポータルに入るには、ポータルブロックの中に立ち続ける必要があるが、専用のツールが存在しない
- **推定実装**:
  1. ポータルブロックを検出
  2. ポータルの中心座標に移動
  3. `bot.setControlState('forward', true)` でポータル内に押し込む
  4. ディメンション変更イベント(`spawn`)を待つ
- **影響**: Phase 6（ネザー）でネザーに突入できない。ブレイズロッド・エンダーパール収集不可
- **次のアクション**:
  1. `src/tools/movement.ts` に `minecraft_enter_portal` ツールを追加
  2. またはBashで `/execute in minecraft:the_nether run tp @s ~ ~ ~` コマンドを使用
- **ファイル**: `src/tools/movement.ts`

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

