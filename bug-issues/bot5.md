# Bot5 - Bug & Issue Report

このファイルはBot5専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] use_item_on_block でバケツが水/溶岩を汲めない
- **症状**: `minecraft_use_item_on_block(item_name="bucket", x, y, z)` で水源や溶岩源を右クリックしても、`water_bucket` や `lava_bucket` にならず、空の `bucket` のままになる。ツール出力は "Collected water/lava with bucket → now holding bucket" と表示されるが、実際にはアイテムが変化していない。
- **原因**: `src/tools/building.ts` の `use_item_on_block` ツールで、バケツ操作の実装が不完全。Mineflayerの `bot.equip()` と `bot.activateBlock()` だけでは、バケツの中身が正しく取得できない可能性がある。
- **影響**: 黒曜石作成（水バケツで溶岩源を固める）ができず、Phase 5の進行が阻害される。
- **修正予定**: `src/tools/building.ts` の実装を確認し、Mineflayerのバケツ操作APIを調査して修正する。
- **ファイル**: `src/tools/building.ts`

---

### [2026-02-15] minecraft_open_chest と minecraft_take_from_chest でチェスト取り違え
- **症状**: `minecraft_open_chest(x=-80, y=80, z=-53)` で開いたはずが、`minecraft_take_from_chest()` を呼ぶと別のチェスト (x=-81, y=79, z=-53) の内容が表示される。open_chestで "obsidian(1)" が表示されても、take_from_chestでは "diamond(5), leather(3), sugar_cane(10), book(1)" となり、obsidianが取得できない。
- **原因**: MCPツールの内部状態管理で、複数のチェストが近くにある場合に、最後に開いたチェストではなく、別のチェストを参照している可能性がある。
- **影響**: チェストから特定のアイテムを取り出せず、Phase 5の進行に支障。
- **回避策**: チェストから取り出す代わりに、自分で黒曜石4個を作成する（溶岩+水バケツ）。
- **修正予定**: `src/tools/crafting.ts` または `src/bot-manager/bot-items.ts` のチェスト操作関連コードを調査。
- **ファイル**: `src/tools/crafting.ts`, `src/bot-manager/bot-items.ts`

---

