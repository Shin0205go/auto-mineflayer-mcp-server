---
name: crafting-chain
description: bot.craftで依存関係自動解決。autoGather=trueで素材自動収集（mc_execute用）
---
## 基本

autoGather=trueを指定することで素材が不足していても自動収集してクラフトする。

## Stone Upgrade (Phase 3)

cobblestone を20個採掘してから、stone_pickaxe・stone_axe・stone_swordをクラフトする。

## Iron Upgrade (Phase 4)

iron_oreを12個採掘し、furnaceを作成してraw_ironを12個精錬する。iron_pickaxeとiron_swordをクラフトする。

## Diamond Upgrade (Phase 5)

Y=-59付近でdiamond_oreを5個採掘し、diamond_pickaxeとdiamond_swordをクラフトする。

## 失敗時

missing items エラーが出たら素材を収集してから再実行する。クラフト結果を確認すると足りない素材が表示される。
