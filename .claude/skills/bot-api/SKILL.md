# bot API Reference for mc_execute

mc_execute でコードを書く時に使える `bot` オブジェクトのAPIリファレンス。
全メソッドは async（`await` 必須）。

## Status & Info

```js
// ステータス取得（HP, 空腹, 位置, インベントリ, 周辺情報）
const s = await bot.status();
// s.hp, s.hunger, s.position.x/y/z, s.time, s.biome
// s.inventory: [{name, count}, ...], s.nearbyEntities, s.nearbyResources

// インベントリのみ
const inv = await bot.inventory();  // [{name, count}, ...]
```

## Movement

```js
await bot.moveTo(x, y, z);              // 座標へ移動
await bot.navigate("oak_log");           // ブロックを探して移動
await bot.navigate("cow");              // エンティティを探して移動
await bot.navigate({target_block: "diamond_ore", max_distance: 64});
await bot.flee(30);                      // 30ブロック逃走
await bot.pillarUp(10);                 // 10ブロック上に積み上げ
```

## Resources & Crafting

```js
await bot.gather("oak_log", 10);         // 木材10個採掘
await bot.gather("cobblestone", 32);     // 石32個採掘
await bot.craft("bread", 3);            // パン3個クラフト
await bot.craft("stone_pickaxe", 1, true); // autoGather=true: 素材も自動収集
await bot.smelt("raw_iron", 5);          // 鉄鉱石5個精錬
```

## Combat & Survival

```js
await bot.eat();                         // 最適な食料を自動選択
await bot.eat("bread");                  // 指定食料を食べる
await bot.combat("zombie");             // ゾンビと戦闘
await bot.combat("cow");               // 牛を狩る（食料獲得）
await bot.combat("sheep");             // 羊を狩る（羊毛獲得）
await bot.equipArmor();                 // 最強防具を自動装備
```

## Building & Farming

```js
await bot.farm();                        // 農場: 水源探し→耕作→種植え→収穫
await bot.place("cobblestone", x, y, z); // ブロック設置
await bot.build("shelter");             // シェルター建築
await bot.build("house", "medium");     // 中サイズの家
```

## Storage

```js
await bot.store("list");                 // 近くのチェスト内容表示
await bot.store("store", "bread", 10);   // パン10個をチェストに格納
await bot.store("take", "bread", 5);     // パン5個をチェストから取得
await bot.store("store_all", null, null, x, y, z, ["stone_sword", "bread"]);
  // 指定アイテム以外を全格納
await bot.drop("dirt", 32);             // 土32個を捨てる
```

## Chat

```js
await bot.chat("[報告] Phase 2 完了");   // メッセージ送信
const msgs = await bot.getMessages();   // 新着メッセージ確認
```

## Utility

```js
bot.log("デバッグ情報");                 // ログ出力（結果に含まれる）
await bot.wait(5000);                   // 5秒待機（最大30秒/回）
```

## パターン集

### 食料確保ループ
```js
for (let i = 0; i < 10; i++) {
  const s = await bot.status();
  if (s.hp < 8) { await bot.flee(); break; }
  if (s.hunger < 10) await bot.eat();

  await bot.farm();
  const inv = await bot.inventory();
  const wheat = inv.find(i => i.name === 'wheat');
  if (wheat && wheat.count >= 3) {
    await bot.craft('bread');
    bot.log(`パン作成完了。小麦残り: ${wheat.count - 3}`);
  }
  await bot.wait(30000); // 30秒待って小麦成長を待つ
}
```

### 安全な資源収集
```js
const s = await bot.status();
if (s.hp < 10) { await bot.eat(); }
await bot.equipArmor();

// 木材→作業台→ピッケル→石
await bot.gather("oak_log", 8);
await bot.craft("crafting_table");
await bot.craft("wooden_pickaxe");
await bot.gather("cobblestone", 20);
await bot.craft("stone_pickaxe");
await bot.craft("stone_sword");
bot.log("石ツール完成");
```

### 夜間サバイバル
```js
const s = await bot.status();
if (s.time > 12500) {
  bot.log("夜だ！シェルターを建てる");
  await bot.build("shelter");
  // ベッドがあれば寝る
  const inv = await bot.inventory();
  if (inv.find(i => i.name.includes('bed'))) {
    await bot.sleep();
  }
}
```

### 探索して動物を狩る
```js
// 200ブロック先を探索
await bot.moveTo(200, 90, 0);
const s = await bot.status();
const animals = ['cow', 'pig', 'chicken', 'sheep'];
for (const animal of animals) {
  if (s.nearbyEntities?.includes(animal)) {
    await bot.combat(animal);
    bot.log(`${animal}を狩った`);
    break;
  }
}
```

## 制約
- タイムアウト: デフォルト120秒、最大600秒（10分）
- bot.wait(): 最大30秒/回
- ログ: 最大200行
- require/process/fs/eval はアクセス不可（サンドボックス）
