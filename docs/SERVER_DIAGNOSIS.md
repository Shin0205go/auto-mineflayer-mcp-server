# サーバー設定診断レポート

## 発見日時
2026-02-13

## 問題の詳細

### 1. 動物スポーンの完全無効化
**症状:**
- 64ブロック範囲で動物が0匹
- 敵対MOB（spider, creeper, zombie）は正常にスポーン
- 食料確保が不可能

**影響:**
- サバイバルプレイが極めて困難
- 食料源が釣り・作物栽培のみに限定
- 羊毛（ベッド素材）の入手不可

**考えられる原因:**
1. `/gamerule doMobSpawning false` - 全MOBスポーン無効
2. サーバープラグインによる動物スポーン制限
3. ワールド生成時の設定ミス
4. スポーンチャンク外での制限

**推奨修正:**
```
/gamerule doMobSpawning true
```

### 2. アイテム自動収集の無効化
**症状:**
- ブロック採掘後、アイテムが地面に落ちる
- `minecraft_collect_items`でも収集不可
- 一部のアイテムは収集可能（不安定）

**影響:**
- 採掘効率の大幅低下
- リソース収集が困難

**考えられる原因:**
1. `/gamerule doTileDrops false` - ブロックドロップ無効
2. サーバープラグインによるアイテムエンティティ削除
3. アイテム即座消滅設定

**推奨修正:**
```
/gamerule doTileDrops true
/gamerule doMobLoot true
```

### 3. チャットコマンド無応答
**症状:**
- `/gamerule`コマンドを実行しても結果が返らない
- チャットメッセージが空

**考えられる原因:**
1. ボットに権限が不足（OP権限なし）
2. チャットイベントリスナーの不具合
3. LANモードでのコマンド制限

**推奨修正:**
```
/op Claude
```

## 実装すべき診断機能

### サーバー設定チェックツール
```typescript
export async function diagnoseServer(bot: Bot): Promise<string> {
  const diagnostics = [];

  // 1. Entity spawn test
  const entities = Object.values(bot.entities);
  const hostiles = entities.filter(e => isHostileMob(bot, e.name));
  const passives = entities.filter(e => isPassiveMob(bot, e.name));

  diagnostics.push(`Hostiles: ${hostiles.length}, Passives: ${passives.length}`);

  if (hostiles.length > 0 && passives.length === 0) {
    diagnostics.push("⚠️ WARNING: Passive mobs not spawning (doMobSpawning issue?)");
  }

  // 2. Item drop test
  const testBlock = bot.findBlock({ matching: block => block.name === 'dirt', maxDistance: 10 });
  if (testBlock) {
    // Dig and check for item entity
    // (implementation needed)
  }

  // 3. Permission test
  bot.chat("/gamerule doMobSpawning");
  await delay(1000);
  const messages = getChatMessages(bot);
  if (messages.length === 0) {
    diagnostics.push("⚠️ WARNING: No response to /gamerule (permission issue?)");
  }

  return diagnostics.join("\n");
}
```

### 自動修正機能
```typescript
export async function autoFixServerConfig(bot: Bot): Promise<string> {
  const fixes = [];

  // Attempt to fix common issues
  bot.chat("/op " + bot.username);
  await delay(500);

  bot.chat("/gamerule doMobSpawning true");
  await delay(500);
  fixes.push("Enabled mob spawning");

  bot.chat("/gamerule doTileDrops true");
  await delay(500);
  fixes.push("Enabled tile drops");

  bot.chat("/gamerule doMobLoot true");
  await delay(500);
  fixes.push("Enabled mob loot");

  return fixes.join(", ");
}
```

## テスト環境
- Minecraft 1.21.4
- サーバー: LANモード（シングルプレイ公開）
- ボット: Mineflayer 4.20.1

## 次回アクション
1. サーバー設定診断ツールの実装
2. 自動修正機能の追加
3. サーバー起動時の設定検証
4. ドキュメント更新
