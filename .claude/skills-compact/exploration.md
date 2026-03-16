---
name: exploration
description: mc_navigateで広範囲探索。バイオーム・村・資源を発見
---
## 基本パターン
- ブロック探索: `mc_navigate(target_block="iron_ore", max_distance=64)`
- エンティティ探索: `mc_navigate(target_entity="villager", max_distance=64)`
- 座標移動: `mc_navigate(x=250, y=64, z=-200)`

## 探索後
`mc_status()` → nearby_resources で周囲資源を確認

## 重要な発見はチャット共有
`mc_chat(message="[資源] diamond_ore発見: x=..., y=..., z=...")`

## 見つからない時
- `max_distance` を増やす
- 別の座標に移動してから再探索
