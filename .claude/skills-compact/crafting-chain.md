---
name: crafting-chain
description: mc_craftで依存関係自動解決。autoGather=trueで素材も自動収集
---
## 基本
```
mc_craft(item="wooden_pickaxe", autoGather=true)
```

## Stone Upgrade (Phase 3)
1. `mc_gather(block="cobblestone", count=20)`
2. `mc_craft(item="stone_pickaxe")`
3. `mc_craft(item="stone_axe")`
4. `mc_craft(item="stone_sword")`

## Iron Upgrade (Phase 4)
1. `mc_gather(block="iron_ore", count=12)`
2. `mc_craft(item="furnace")` — なければ作成
3. `mc_craft(item="iron_pickaxe", autoGather=true)`
4. `mc_craft(item="iron_sword", autoGather=true)`

## Diamond Upgrade (Phase 5)
1. `mc_gather(block="diamond_ore", count=5)` — Y=-59
2. `mc_craft(item="diamond_pickaxe")`
3. `mc_craft(item="diamond_sword")`

## 失敗時
- missing items が返る → `mc_gather(block=...)` で収集して再実行
