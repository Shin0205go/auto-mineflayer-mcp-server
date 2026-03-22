---
name: exploration
description: |
  mc_navigateとmc_statusで広範囲探索を実行。バイオーム・村・構造物・資源を発見。
  ALWAYS use when: 新しい場所を探索したい、村を見つけたい、特定のバイオームを探している時。
---

# エリア探索スキル

## 基本

```
mc_navigate(target_block="iron_ore", max_distance=64)   # ブロック探索
mc_navigate(target_entity="villager", max_distance=64)   # エンティティ探索
mc_navigate(x=250, y=64, z=-200)                         # 座標移動
```

移動先で `mc_status()` を呼ぶとnearby_resourcesで周囲資源が見える。

## 探索対象例

| カテゴリ | 対象 |
|---------|------|
| 鉱石 | diamond_ore, iron_ore, coal_ore |
| 構造物 | villager(村), spawner(スポナー) |
| 食料 | cow, pig, chicken, sheep |

## 探索半径の目安

| 半径 | 用途 |
|------|------|
| 50 | 近場の資源確認 |
| 100 | バイオーム探索 |
| 200 | 村・構造物探索 |

## Tips

- 重要な発見はチャットで共有: `mc_chat(message="[資源] diamond_ore発見: x=123, y=-59, z=456")`
- 見つからない時: 方向を変えて100ブロック移動してから再探索
