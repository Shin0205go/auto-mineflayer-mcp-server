---
name: resource-gathering
description: |
  mc_gatherツールで木材・石・鉱石を自動で探索・採掘・回収。find_block→move_to→dig_blockを手動で繰り返す必要なし。
  ALWAYS use when: 木を集めたい、丸石が必要、鉱石を掘りたい、素材が足りない、oak_log/cobblestone/iron_ore等のブロックを収集する時。
---

# リソース自動収集スキル

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

## Tips

- **ツール準備**: 鉱石採掘にはピッケルが必要 → `mc_craft(item="stone_pickaxe")`
- **範囲拡大**: 見つからない場合は `max_distance` を増やす
- **見つからない時**: `mc_navigate(x=..., z=...)` で別の場所へ移動してから再実行
