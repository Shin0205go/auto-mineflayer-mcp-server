---
name: iron-mining
description: 鉄鉱石採掘→精錬→鉄インゴット
---
## 前提
- 石ピッケル以上必須（木では掘れない）
- かまど + 燃料(coal/oak_log)

## 手順
1. `mc_status()` — 道具確認
2. `mc_gather(block="iron_ore", count=16)` — Y=16付近が最多
3. `mc_smelt(item_name="raw_iron", count=16)` または `mc_craft(item="iron_pickaxe", autoGather=true)`

## 必要数の目安
- 鉄ピッケル: 3個、鉄の剣: 2個、バケツ: 3個 → 最低8個
- フル装備追加: +24個 → 計32個

## 鉄装備レシピ（インゴット数）
- iron_pickaxe: 3、iron_sword: 2、iron_axe: 3
- iron_helmet: 5、iron_chestplate: 8、iron_leggings: 7、iron_boots: 4
