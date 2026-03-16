---
name: diamond-mining
description: ダイヤ採掘。Y=-59、鉄ピッケル必須
---
## 前提
- 鉄ピッケル以上（木・石では採掘不可）
- 水バケツ（溶岩対策）
- 松明、食料

## 手順
1. `mc_navigate(x=current_x, y=-59, z=current_z)` — 最適高度へ
2. `mc_gather(block="diamond_ore", count=5)` — 自動採掘
3. `mc_chat(message="[資源] ダイヤ発見: x=..., z=..., Y=-59")`

## 採掘量の目安
- ダイヤピッケル: 3、ダイヤ剣: 2、フルアーマー: 24、エンチャント台: 2
- 基本セット合計: **31個**

## 注意
- Y=-54以下は溶岩湖多い → 水バケツ必携
- Fortune III ピッケルがあれば効率2.2倍
