# Bot5 - Bug & Issue Report

このファイルはBot5専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] use_item_on_block でバケツが水/溶岩を汲めない ✅ **FIXED**
- **症状**: `minecraft_use_item_on_block(item_name="bucket", x, y, z)` で水源や溶岩源を右クリックしても、`water_bucket` や `lava_bucket` にならず、空の `bucket` のままになる。ツール出力は "Collected water/lava with bucket → now holding bucket" と表示されるが、実際にはアイテムが変化していない。
- **原因**: `activateBlock()`ではなく`activateItem()`+`deactivateItem()`が必要。サーバー同期待ち時間不足。
- **修正**: Bot1がコミット8c753a6で修正完了。
- **修正内容**:
  - `bot.activateItem()`→100ms待機→`bot.deactivateItem()`の流れに変更
  - インベントリ更新を3秒間ポーリングで待機
  - 同期待ち時間を1000msに延長
- **ファイル**: `src/bot-manager/bot-blocks.ts` (useItemOnBlock関数)
- **ステータス**: ✅ FIXED (2026-02-15, コミット8c753a6)

---

### [2026-02-15] minecraft_open_chest と minecraft_take_from_chest でチェスト取り違え
- **症状**: `minecraft_open_chest(x=-80, y=80, z=-53)` で開いたはずが、`minecraft_take_from_chest()` を呼ぶと別のチェスト (x=-81, y=79, z=-53) の内容が表示される。open_chestで "obsidian(1)" が表示されても、take_from_chestでは "diamond(5), leather(3), sugar_cane(10), book(1)" となり、obsidianが取得できない。
- **原因**: MCPツールの内部状態管理で、複数のチェストが近くにある場合に、最後に開いたチェストではなく、別のチェストを参照している可能性がある。
- **影響**: チェストから特定のアイテムを取り出せず、Phase 5の進行に支障。
- **回避策**: チェストから取り出す代わりに、自分で黒曜石4個を作成する（溶岩+水バケツ）。
- **修正予定**: `src/tools/crafting.ts` または `src/bot-manager/bot-items.ts` のチェスト操作関連コードを調査。
- **ファイル**: `src/tools/crafting.ts`, `src/bot-manager/bot-items.ts`
- **関連修正 (2026-02-22, autofix-1)**: `takeFromChest` でチェストopen失敗時にロックが解放されないバグを修正。
  チェストアクセス競合時のデッドロックリスクを低減。ファイル: `src/bot-manager/bot-storage.ts`
- **修正済み (autofix-3, 2026-02-22)**: 座標未指定時の `findBlock` 検索範囲を 6→4 ブロックに縮小。インタラクション範囲内のチェストのみ対象とすることで、離れた別チェストを誤って選択するリスクを低減。座標を必ず指定するよう促すエラーメッセージも改善。ファイル: `src/bot-manager/bot-storage.ts`

**修正済み**

---

### [2026-02-16] iron_pickaxe と iron_sword がインベントリから消失
- **症状**: チェストから `iron_pickaxe` と `iron_sword` を取得（take_from_chest成功確認）し、装備もした（equip成功確認）。その後 pillar_up や move_to を実行したところ、いつの間にかインベントリから消失。stone_pickaxe と stone_sword のみ残っている。チェストにも戻っていない。
- **発生状況**:
  1. チェスト(-3,96,0)から iron_pickaxe と iron_sword を取得（成功）
  2. iron_pickaxe を装備（成功）
  3. pillar_up で11ブロック上昇
  4. チェスト(2,106,-1)から diamond を取得
  5. 拠点に戻る（move_to）
  6. インベントリ確認 → iron_pickaxe/iron_sword が消失、stone系に戻っている
- **原因**: 不明。インベントリ同期の問題か、アイテム管理のバグの可能性。
- **影響**: Phase 4未達成。鉄装備を再取得する必要がある。
- **修正予定**: インベントリ管理周りのコードを調査。
- **ファイル**: `src/bot-manager/bot-items.ts`, `src/tools/crafting.ts`

---

### [2026-02-16] stick クラフトで birch_planks を使わず dark_oak_planks を選択 ✅ **FIXED**
- **症状**: インベントリに `birch_planks x50` がある状態で `minecraft_craft(item_name="stick", count=2)` を実行すると、"missing ingredient" エラーになる。
- **エラーメッセージ**: `Failed to craft stick from birch_planks: Error: missing ingredient. Try crafting planks from logs first`
- **原因**:
  1. bot.recipesAll(item.id, null, null)が何かレシピを返している
  2. その後のクラフト実行で「missing ingredient」エラーが発生
  3. マニュアルレシピの条件`allRecipes.length === 0`に到達していない
  4. つまり、有効なレシピが存在しないのにrecipesAllが何かを返している（Mineflayer/mcDataのバグの可能性）
- **影響**: stickが作成できず、石ツール作成に支障。ただし既にダイヤ装備があるため優先度は低い。
- **修正内容**:
  - `src/bot-manager/bot-crafting.ts` (lines 355-469): `stick` と `crafting_table` は `recipesAll()` の結果を無視し、常にマニュアルレシピを使用するよう変更
  - 最も数量の多い planks タイプを自動選択（`sort()` で最大数のものを使用）
  - `simpleWoodenRecipes` リストで stick/crafting_table を特別扱いし、確実にクラフト可能に
- **ファイル**: `src/bot-manager/bot-crafting.ts` (lines 355-469)
- **ステータス**: ✅ FIXED (autofix-4, 2026-02-22)

**修正済み**

### [2026-02-17] stick クラフト bug - GIT MERGE CONFLICT FOUND ✅ **FIXED**
- **症状**: dark_oak_planks x4 を持っているのに stick craft が失敗
- **エラー**: "Failed to craft stick from dark_oak_planks: Error: missing ingredient"
- **根本原因**: **git merge conflict が未解決のままコミット済みだった**
  - bot-crafting.ts line 706-777 に `<<<<<<< HEAD` と `>>>>>>> origin/main` マーカーが存在
  - TypeScript解析時にこれが`any`型として扱われ、実行時バグを引き起こしていた
  - 実装上は存在する修正（BUGFIX 2026-02-17）がコンフリクトマーカーに埋もれていた
- **修正内容**:
  - bot-crafting.ts line 706-777 のコンフリクトマーカーを削除
  - HEADバージョン（BUGFIX BUGFIX 2026-02-17の修正）を採用
  - compatibleRecipe.find()で常に互換性検証を実施するように統一
- **ファイル**: `src/bot-manager/bot-crafting.ts` (lines 706-777)
- **修正日**: 2026-02-17
- **ステータス**: ✅ FIXED

---

### [2026-02-17] Respawn HP/Hunger Recovery Bug - keepInventory ON but healing broken ✅ **FIXED**
- **症状**: `minecraft_respawn()` を実行しても HP/Hunger が 20/20 に回復しない。keepInventory=true でアイテムは保持されるが、HP/Hunger は元の値のまま。
- **発生例**: Claude5 respawn実行 → HP 1/20 Hunger 11/20 → respawn実行 → 同じく HP 1/20 Hunger 11/20 (変わらず)
- **期待動作**: keepInventory=true の場合、プレイヤーは spawn地点で全回復（HP 20/20, Hunger 20/20）+インベントリ保持
- **実際の動作**: respawn後もHP/Hungerは元の値のままで変わらない
- **根本原因**: `/kill` コマンドでボットを死亡させた後、`bot.respawn()` を呼び出していなかった。ボットは死亡画面のまま実際にリスポーンしていなかった。
- **修正内容**: `src/bot-manager/bot-survival.ts` の `respawn()` 関数を修正:
  1. `/kill` 送信前に death イベントリスナーを設定
  2. death イベント後に `bot.respawn()` を呼び出してリスポーンを実行
  3. spawn イベントを待ってリスポーン完了を確認
  4. 1秒待機後にHP/Food値を読み取る
- **ファイル**: `src/bot-manager/bot-survival.ts` (respawn function)
- **ステータス**: ✅ FIXED (2026-02-22, autofix-2)

**修正済み**

---

