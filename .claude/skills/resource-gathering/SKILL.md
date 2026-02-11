---
name: resource-gathering
description: |
  自動リソース収集スキル。指定したブロックを自動で探索・採掘・回収。
  Use when: 木材、石、鉱石などの大量収集が必要な時
---

# リソース自動収集スキル

指定したアイテムを自動で収集する高レベルスキル。

## 使用方法

```
minecraft_gather_resources {
  username: "BotName",
  items: [
    { name: "oak_log", count: 10 },
    { name: "cobblestone", count: 64 }
  ],
  maxDistance: 32
}
```

## パラメータ

- `items`: 収集対象のリスト（name: ブロック名, count: 目標個数）
- `maxDistance`: 検索範囲（デフォルト: 32ブロック）

## 自動実行される処理

1. **ブロック検索** - 指定範囲内でブロックを探索
2. **自動移動** - ブロックの位置まで自動で移動
3. **採掘** - 適切なツールで採掘（ツール不足なら警告）
4. **アイテム回収** - ドロップしたアイテムを自動回収
5. **ループ** - 目標数に達するまで繰り返し

## 対応ブロック例

| カテゴリ | ブロック名 |
|---------|-----------|
| 木材 | oak_log, birch_log, spruce_log |
| 石材 | cobblestone, stone, andesite |
| 鉱石 | coal_ore, iron_ore, gold_ore, diamond_ore |
| 食料 | wheat, carrot, potato |

## Tips

- **ツール準備**: 鉱石採掘にはピッケルが必要
- **範囲拡大**: 見つからない場合は maxDistance を増やす
- **複数アイテム**: 1回の呼び出しで複数種類を収集可能
- **効率化**: 近くのブロックから優先的に採掘

## エラー対応

- `No XXX found`: 範囲内にブロックがない → 移動または範囲拡大
- `Dig failed`: 適切なツールがない → ツールをクラフト
- `No items gained`: ドロップがない → ツールの種類を確認
