---
name: crafting-chain
description: |
  mc_craftツールで素材収集→中間素材→最終製品まで自動クラフト。autoGather=trueで不足素材も自動収集。
  ALWAYS use when: ピッケルを作りたい、斧が必要、かまどを作る、松明が欲しい、道具をクラフトしたい時。
---

# クラフトチェーンスキル

## 基本使用法

```
mc_craft(item="wooden_pickaxe", autoGather=true)
```

## よく使うレシピ

| アイテム | コマンド |
|---------|---------|
| 作業台 | `mc_craft(item="crafting_table")` |
| 木ピッケル | `mc_craft(item="wooden_pickaxe")` |
| 石ピッケル | `mc_craft(item="stone_pickaxe")` |
| 鉄ピッケル | `mc_craft(item="iron_pickaxe", autoGather=true)` |
| かまど | `mc_craft(item="furnace")` |
| 松明 | `mc_craft(item="torch")` |
| チェスト | `mc_craft(item="chest")` |

## autoGather パラメータ

- `true`: 不足素材を自動で収集・精錬して完成
- `false`(デフォルト): 手持ちの素材のみ。不足分はエラーメッセージで通知

## Tool Upgrade Protocol（ツールアップグレード手順）

旧`minecraft_upgrade_tools`の代替。

### Stone Upgrade (Phase 3)
```
1. mc_status() — 現在の道具を確認
2. mc_gather(block="cobblestone", count=20) — 石材確保
3. mc_craft(item="stone_pickaxe") — 石ピッケル
4. mc_craft(item="stone_axe") — 石斧
5. mc_craft(item="stone_sword") — 石の剣
```

### Iron Upgrade (Phase 4)
```
1. mc_status() — 鉄鉱石の位置を確認
2. mc_gather(block="iron_ore", count=12) — 鉄鉱石採掘
3. mc_craft(item="furnace") — かまどがなければ作成
4. mc_craft(item="iron_pickaxe", autoGather=true) — 鉄ピッケル
5. mc_craft(item="iron_sword", autoGather=true) — 鉄の剣
6. mc_craft(item="iron_helmet", autoGather=true) — 防具も可能なら
```

### Diamond Upgrade (Phase 5)
```
1. diamond-mining SKILLを参照（Y=-59でブランチマイニング）
2. mc_gather(block="diamond_ore", count=5) — ダイヤ採掘
3. mc_craft(item="diamond_pickaxe") — ダイヤピッケル
4. mc_craft(item="diamond_sword") — ダイヤ剣
```

## 失敗時の対応

`mc_craft`は失敗時に不足アイテムを返す：
```json
{ "success": false, "item": "iron_pickaxe", "missing": ["iron_ingot x1"] }
```

→ `mc_gather(block="iron_ore", count=1)` で不足分を収集して再実行

## Tips

- **autoGather推奨**: 素材不足を気にせず実行可能
- **事前確認**: `mc_status()`でインベントリを確認してから実行
- **精錬自動化**: iron_ingotが必要な場合、raw_iron→精錬を自動処理
