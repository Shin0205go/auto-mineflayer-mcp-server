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
- **症状**: インベントリに `birch_planks x49` と `dark_oak_planks x7` がある状態で `minecraft_craft(item_name="stick", count=24)` を実行すると、`dark_oak_planks` から作ろうとして "missing ingredient" エラーになる。birch_planksが大量にあるのに使われない。
- **エラーメッセージ**: `Failed to craft stick from dark_oak_planks: Error: missing ingredient. Try crafting planks from logs first`
- **原因**: `inventoryItems.find(i => i.name.endsWith("_planks"))` がインベントリ順序で最初に見つかった planks を返すため、数量に関係なく dark_oak_planks が選ばれていた。
- **影響**: stickが作成できず、鉄ツール作成に支障。Claude4, Claude7も同じ問題を報告。
- **修正内容**:
  - `inventoryItems.find()` → `inventoryItems.filter().sort((a,b) => b.count - a.count)[0]` に変更
  - 最も数量が多い planks を選択するようにロジック改善
  - stick と crafting_table の両方のマニュアルレシピ作成箇所を修正
- **ファイル**: `src/bot-manager/bot-crafting.ts` (line 414-450)
- **ステータス**: ✅ FIXED (2026-02-16, Bot5修正)

---

