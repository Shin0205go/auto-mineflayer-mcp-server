---
name: building
description: 構造物建設。mineflayer pathfinder + placeBlock（mc_execute用）
---
## 基本

buildのpresetはshelter / wall / platform / tower。
sizeはsmall(50ブロック) / medium(150) / large(300)。smallがデフォルト。

## Base Protocol (Phase 1)

oak_logを16個採掘し、crafting_tableをクラフトする。cobblestoneを24個採掘し、furnaceとchestを3個クラフトする。shelterをbuildする。

## 個別ブロック設置

statusで現在位置を取得し、placeでfurnace・crafting_table・chestを現在位置の近くに設置する。
