---
name: resource-gathering
description: 自動探索・採掘・回収。mineflayer pathfinder + dig（mc_execute用）
---
## 基本

gatherは find→move→mine→collect を自動で行う。

## よく使うパターン
- oak_log 10個: 木材
- cobblestone 32個: 石
- iron_ore 12個: 鉄鉱石（石ピッケル必須）
- coal_ore 8個: 石炭
- diamond_ore 5個: ダイヤ（鉄ピッケル必須、Y=-59付近）

## 見つからない時

別エリアに移動（現在位置から+100ブロック、Y=64）してから再実行する。
