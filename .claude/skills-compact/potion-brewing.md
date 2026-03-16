---
name: potion-brewing
description: ポーション醸造。醸造台設置からレシピまで
---
## 醸造台作成
1. `mc_combat(target="blaze")` → blaze_rod x1
2. `mc_craft(item="brewing_stand")`
3. `mc_place_block(block_type="brewing_stand", x=..., y=..., z=...)`

## 基本レシピ（水入り瓶→各ポーション）
- 水入り瓶 + nether_wart → awkward_potion（基本）
- awkward + magma_cream → fire_resistance（ネザー必須）
- awkward + spider_eye → poison
- awkward + sugar → swiftness
- awkward + golden_carrot → night_vision
- awkward + blaze_powder → strength

## 強化: awkward potion + glowstone → 強化版
## 延長: awkward potion + redstone → 延長版

## ネザー前必須
`fire_resistance_potion` を最低4本用意
