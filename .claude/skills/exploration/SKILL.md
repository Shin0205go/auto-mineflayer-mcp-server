---
name: exploration
description: |
  エリア探索スキル。スパイラルパターンで広範囲を探索し、バイオーム・構造物・資源を発見。
  Use when: 新しいバイオーム、村、資源を探したい時
---

# エリア探索スキル

スパイラルパターンで効率的に探索する高レベルスキル。

## 使用方法

```
minecraft_explore_area {
  username: "BotName",
  radius: 100,
  target: "village"  // 省略時は全般的な探索
}
```

## パラメータ

- `radius`: 探索半径（ブロック単位）
- `target`: 探索対象（省略可能）
  - バイオーム名: "desert", "forest", "plains"
  - ブロック名: "diamond_ore", "village"
  - エンティティ名: "villager", "horse"

## 探索パターン

```
スパイラル探索（5ブロック間隔）:
    ↑
  ← ● →
    ↓

開始地点から螺旋状に外側へ展開
```

## 自動実行される処理

1. **開始座標記録** - 探索開始位置を保存
2. **スパイラル移動** - 5ブロック間隔で螺旋状に移動
3. **バイオーム確認** - 各地点でバイオームをチェック
4. **ターゲット検索** - 指定されたブロック/エンティティを探索
5. **発見記録** - 見つかったものを座標付きで記録
6. **範囲制限** - 指定半径を超えたら探索終了

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

## 発見データの形式

```
Exploration complete. Visited 80 points.
Findings:
- village biome at (250, 320)
- diamond_ore block at current location
- villager entity at current location
```

## Tips

- **事前準備**: 食料、武器、松明を持参
- **座標記録**: save_memoryで発見した重要な場所を記録
- **夜間注意**: 夜間探索は危険、明るい時間に実行推奨
- **ターゲット指定**: 目的がある場合はtargetを指定して効率化
- **中断可能**: 途中で危険を感じたら中断してOK

## 探索後のアクション

```
# 発見した村の座標を記憶
save_memory {
  type: "location",
  name: "最寄りの村",
  x: 250, y: 65, z: 320,
  locationType: "village"
}

# 発見した資源地点に移動
minecraft_move_to { x: 250, y: 65, z: 320 }
```

## エラー対応

- `Move failed`: 障害物や地形が複雑 → 別ルートを試す
- `No notable findings`: 半径を広げて再探索
- `Target not found`: ターゲットがこの範囲にない → さらに遠くを探索
