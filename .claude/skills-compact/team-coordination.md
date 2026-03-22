---
name: team-coordination
description: 最優先。チーム連携ルール・役割・チャットタグ（mc_execute用）
---
## 接続直後（全員）
```js
const msgs = await bot.getMessages();
bot.log(`Messages: ${msgs}`);
const s = await bot.status();
bot.log(`HP:${s.hp} Hunger:${s.hunger} Pos:${JSON.stringify(s.position)}`);
// 指示あり → 実行、指示なし → フェーズ目標で自律行動
```

## リーダー（Claude1）
```js
// フェーズ宣言
await bot.chat("[フェーズ] Phase 2 開始。目標: チェストに食料20個以上");
// タスク割当
await bot.chat("[指示] @Claude2 農場で小麦収穫、パン作成して");
await bot.chat("[指示] @Claude3 羊を探してベッド作成して");
```

## フォロワー優先順位
1. 人間チャット → 最優先
2. `[指示]` → 即実行
3. `[SOS]` → 近ければ救援
4. フェーズ目標で自律行動

## 安全チェック（毎ターン）
```js
const s = await bot.status();
if (s.hunger < 15) await bot.eat();
if (s.hp < 4) { await bot.flee(); return; }
await bot.equipArmor();
```

## チャットタグ
- `[フェーズ]` リーダーのみ、フェーズ宣言
- `[指示]` リーダーのみ、タスク割当
- `[了解]` 指示への応答
- `[報告]` 進捗・完了
- `[SOS]` 緊急救助要請
- `[資源]` 発見共有
