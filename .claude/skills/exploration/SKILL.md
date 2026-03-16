---
name: exploration
description: |
  mc_navigateとmc_statusで広範囲探索を実行。バイオーム・村・構造物・資源を発見。
  ALWAYS use when: 新しい場所を探索したい、村を見つけたい、特定のバイオームを探している、周辺の地形を把握したい時。
  move_toを何度も呼んで手動探索する代わりに、このスキルで効率的に広範囲を探索。
---

# エリア探索スキル

mc_*コアツールで効率的にエリアを探索する。

## 基本的な探索手順

```
1. mc_status() — 現在位置・周囲の資源・脅威を確認
2. mc_navigate(target_block="diamond_ore", max_distance=64) — 特定ブロックへ移動
3. mc_status() — 移動先の状況確認
```

## 探索パターン

### 特定ブロックを探す
```
mc_navigate(target_block="iron_ore", max_distance=64)
```

### 特定エンティティを探す
```
mc_navigate(target_entity="villager", max_distance=64)
```

### 座標指定で移動
```
mc_navigate(x=250, y=64, z=-200)
```

### スパイラル探索（広範囲）

Tier3ツールの`minecraft_explore_area`で自動スパイラル探索も可能:
```
search_tools(query="explore") → minecraft_explore_area を発見
```

## 探索対象例

### バイオーム
- `desert` - 砂漠（サボテン、砂岩、村）
- `jungle` - ジャングル（カカオ、オウム）
- `mushroom_fields` - キノコ島（モッシュルーム）
- `ice_spikes` - 氷柱（氷塊）

### 構造物
- `village` - 村（村人、取引）
- `desert_pyramid` - 砂漠の寺院（宝箱）
- `jungle_temple` - ジャングルの寺院

### 資源
- `diamond_ore` - ダイヤモンド鉱石
- `ancient_debris` - 古代の残骸（ネザー）
- `spawner` - スポナー

## 探索半径の目安

| 半径 | 所要時間 | 用途 |
|------|---------|------|
| 50 | 2分 | 近場の資源確認 |
| 100 | 5分 | バイオーム探索 |
| 200 | 15分 | 村・構造物探索 |
| 500 | 1時間 | 長距離探検 |

## Tips

- **事前準備**: 食料、武器、松明を持参
- **座標記録**: 発見した重要な場所はチャットで共有
- **夜間注意**: 夜間探索は危険、明るい時間に実行推奨
- **中断可能**: 途中で危険を感じたら中断してOK
- **mc_statusを活用**: 移動先でmc_statusを呼ぶとnearby_resourcesで周囲資源が見える

## エラー対応

- `Move failed`: 障害物や地形が複雑 → 別ルートを試す
- `No notable findings`: 範囲を広げて再探索
- `Target not found`: ターゲットがこの範囲にない → さらに遠くを探索
