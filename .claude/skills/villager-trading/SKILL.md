---
name: villager-trading
description: 村人交易。エメラルド・特殊アイテム入手（mc_execute用）
---
## 村人を見つける
```js
await bot.navigate("villager"); // entity検索
```

## 職業ブロック（村人の職業を決定）
- 司書 → lectern（本棚関連）
- 鍛冶屋 → smithing_table
- 農民 → composter
- 聖職者 → brewing_stand
- 武器屋 → grindstone

## 交易のコツ
- emerald を集める → ゾンビ倒してcarrot/potato入手 → 農民に売る
- 司書からenchanted_book（Fortune/Efficiencyなど）を購入
- 聖職者からender_pearl購入可能（Phase 6で重要）

## 村人繁殖
- ベッド数 > 村人数が条件
- 食料（bread/carrot）を村人に与える
