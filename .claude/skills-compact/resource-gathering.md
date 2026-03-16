---
name: resource-gathering
description: mc_gatherで自動探索・採掘・回収
---
## 基本
```
mc_gather(block="oak_log", count=10)
```
find→move→mine→collect を自動実行。

## よく使うパターン
- 木材: `mc_gather(block="oak_log", count=10)`
- 石: `mc_gather(block="cobblestone", count=20)`
- 鉄: `mc_gather(block="iron_ore", count=12)` — 石ピッケル必須
- 石炭: `mc_gather(block="coal_ore", count=8)`
- ダイヤ: `mc_gather(block="diamond_ore", count=5)` — 鉄ピッケル必須

## 見つからない時
- `max_distance` を増やす（デフォルト32）
- `mc_navigate(x=...,y=...,z=...)` で別エリアへ移動してから再実行
