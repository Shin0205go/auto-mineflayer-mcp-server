---
name: building
description: |
  mc_buildツールで建築。place_blockを何十回も呼ぶ必要なし。
  ALWAYS use when: 拠点を作りたい、シェルターが必要、壁を建てたい、モブから身を守る建物が欲しい時。
---

# 自動建築スキル

## 基本建築

```
mc_build(preset="shelter", size="small")
```

## 建築タイプ

| タイプ | 用途 | 必要ブロック |
|--------|------|-------------|
| shelter | 壁+屋根の避難所 | small:50, medium:150, large:300 |
| wall | 直線の防御壁 | サイズによる |
| platform | 平面の足場 | サイズによる |
| tower | 見張り塔 | サイズによる |

## Base Protocol（拠点確立プロトコル）

Phase 1拠点を確立する手順。旧`minecraft_establish_base`の代替。

| # | ツール | 目的 |
|---|--------|------|
| 1 | `mc_status()` | 現在位置・インベントリ確認 |
| 2 | `mc_gather(block="oak_log", count=16)` | 板材用の木材 |
| 3 | `mc_craft(item="crafting_table")` | 作業台作成 |
| 4 | `mc_gather(block="cobblestone", count=24)` | かまど+建材用の石 |
| 5 | `mc_craft(item="furnace")` | かまど作成 |
| 6 | `mc_craft(item="chest", count=3)` | チェスト3個 |
| 7 | `mc_build(preset="shelter", size="small")` | シェルター建築 |
| 8 | `mc_status()` | 完了確認 |

**作業台・かまどはplaceでシェルター内に設置。チェストも同様。**

低レベルブロック配置が必要な場合: `search_tools(query="place")` で `minecraft_place_block` を発見可能。

## Tips

- **材料準備**: 建築前に十分な建材を用意
- **地形整地**: mc_buildは自動で地面を平らにする
- **夜間避難**: shelterは即座に使用可能
- **カスタマイズ**: 完成後に低レベルツールで窓やドアを追加
