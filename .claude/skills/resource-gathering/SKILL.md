---
name: resource-gathering
description: |
  mc_gatherツールで木材・石・鉱石を自動で探索・採掘・回収。find_block→move_to→dig_blockを手動で繰り返す必要なし。
  ALWAYS use when: 木を集めたい、丸石が必要、鉱石を掘りたい、素材が足りない、oak_log/cobblestone/iron_ore等のブロックを収集する時。
  個別にfind_block→move_to→dig_blockと呼ぶ代わりに、このスキルを使うこと。
---

# リソース自動収集スキル

指定したアイテムを自動で収集する完全自動化スキル。

## 基本使用法

```
mc_gather(block="oak_log", count=10)
```

`mc_gather`は自動で検索→移動→採掘→回収を実行する。

## よく使うパターン

| 目的 | コマンド |
|------|---------|
| 木材収集 | `mc_gather(block="oak_log", count=10)` |
| 石材収集 | `mc_gather(block="cobblestone", count=20)` |
| 石炭採掘 | `mc_gather(block="coal_ore", count=8)` |
| 鉄鉱石採掘 | `mc_gather(block="iron_ore", count=12)` |
| 砂収集 | `mc_gather(block="sand", count=16)` |

## パラメータ

- `block`: 採掘するブロック名（例: "oak_log", "cobblestone", "iron_ore"）
- `count`: 収集個数（デフォルト: 1）
- `max_distance`: 検索半径（デフォルト: 32）

## ワークフロー

1. `mc_status()` — 現在のインベントリと周囲を確認
2. `mc_gather(block="対象ブロック", count=N)` — 自動収集
3. `mc_status()` — 収集結果を確認

## 対応ブロック例

| カテゴリ | ブロック名 |
|---------|-----------|
| 木材 | oak_log, birch_log, spruce_log |
| 石材 | cobblestone, stone, andesite |
| 鉱石 | coal_ore, iron_ore, gold_ore, diamond_ore |
| 食料 | wheat, carrot, potato |

## Tips

- **ツール準備**: 鉱石採掘にはピッケルが必要 → `mc_craft(item="stone_pickaxe")`
- **範囲拡大**: 見つからない場合は `max_distance` を増やす
- **効率化**: 近くのブロックから優先的に採掘される

## エラー対応

- `No XXX found within Y blocks`: 範囲内にブロックがない
  - → `mc_navigate(x=new_x, y=new_y, z=new_z)` で別の場所へ移動
  - → `max_distance` を増やして再実行

- `Failed to dig block`: 適切なツールがない
  - → `mc_craft(item="wooden_pickaxe")` でツールをクラフト

## 低レベルツールが必要な場合

特殊な採掘操作が必要な場合は `search_tools` でTier3ツールを検索:
- `search_tools(query="dig")` → `minecraft_dig_block`
- `search_tools(query="find")` → `minecraft_find_block`
- `search_tools(query="collect")` → `minecraft_collect_items`
