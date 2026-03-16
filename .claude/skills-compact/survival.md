---
name: survival
description: 食料確保・HP回復・夜間対処の手順
---
## Day 1
1. `mc_status()` — 状況把握
2. `mc_gather(block="oak_log", count=10)`
3. `mc_craft(item="crafting_table")`
4. `mc_craft(item="wooden_pickaxe")`
5. `mc_craft(item="wooden_sword")`
6. `mc_combat(target="cow")` — pig/chicken/sheep/zombie でも可
7. `mc_eat()`
8. `mc_gather(block="cobblestone", count=20)`
9. `mc_craft(item="stone_pickaxe")`
10. `mc_craft(item="stone_sword")`
11. `mc_build(preset="shelter", size="small")`

## HP/食料しきい値
- hunger < 15 → `mc_eat()`
- HP < 10 → `mc_eat()` 優先（リスポーン禁止）
- HP < 4 + 脅威 → `mc_flee()` 即時

## 食料ない時
1. `mc_store(action="list")` でチェスト確認
2. `mc_combat(target="cow")` で狩猟
3. 最終手段: `mc_combat(target="zombie")` → rotten_flesh

## 夜間
- ベッドあり → `mc_sleep()`
- なし → `mc_build(preset="shelter", size="small")`
