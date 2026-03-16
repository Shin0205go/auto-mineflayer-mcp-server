---
name: enchanting
description: エンチャントテーブル設置と最適エンチャント
---
## 必要素材
- obsidian x4、diamond x2、book x1
- 本棚15個でLv30エンチャント可能（book x45、leather x15）

## 手順
1. `mc_craft(item="enchanting_table")`
2. `mc_place_block(block_type="enchanting_table", x=..., y=..., z=...)`
3. 本棚を周囲に設置（1ブロック離して）
4. 経験値Lv30貯めてエンチャント

## 優先エンチャント
- ピッケル: Efficiency V, Fortune III, Unbreaking III
- 剣: Sharpness V, Unbreaking III, Looting III
- 防具: Protection IV, Unbreaking III

## 経験値稼ぎ
- モブ戦闘: `mc_combat(target="zombie")`
- ネザー要塞のブレイズ（高経験値）
