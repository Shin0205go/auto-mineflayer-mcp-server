---
name: bed-crafting
description: ベッド作成。夜スキップ・リスポーン地点設定
---
## 必要素材
- wool x3（羊3匹分）、oak_planks x3（原木1個で可）

## 手順
1. `mc_navigate(target_entity="sheep", max_distance=64)`
2. `mc_combat(target="sheep")` × 3回（wool x3入手）
3. `mc_gather(block="oak_log", count=1)`
4. `mc_craft(item="white_bed")`
5. `mc_place_block(block_type="white_bed", x=..., y=..., z=...)`
6. 夜になったら `mc_sleep()`

## 羊が見つからない
plains / forest バイオームへ移動して探す
