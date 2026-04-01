# terrain-management スキル

採掘後の穴埋めと平地化。pathfinderが通れなくなるのを防ぐ。

---

## 重要な教訓（実戦から得た知見）

### 致命的ミス: 足元を掘ると落下ダメージ
**絶対に自分の真下を掘らない。** 高い場所を掘る時は TARGET_Y の高さに立ち、**横方向から壁を削る**。
上から下に掘ると 10+ ブロック落下 → HP 半減以上。

### pathfinder.goto は遅い（20-30秒/回）
大量の掘削で毎回 pathfinder.goto を使うと 120秒タイムアウトする。
**近距離移動は setControlState で手動移動**。pathfinder は長距離の初回移動のみ。

### bot.placeBlock は blockUpdate 待ちで 5秒タイムアウト
`safePlaceBlock`（raw packet方式）を使う → 50ms。mc_execute sandbox に組み込み済み。

### bot.consume() が blockUpdate タイムアウト
食事は不安定。HP回復は自然回復（food >= 18）に頼る。

### ブロック配置の距離制限: 4.5ブロック
サーバーが 4.5+ を拒否。fillHoles には必ず距離チェックを入れる。

### 120秒制限内で作業する
1回の mc_execute で掘れるのは最大 30-50 ブロック程度。大きなエリアは複数回に分割。

---

## 1. 穴埋め（fillHoles — mc_execute sandbox 内蔵）

mc_execute 内で `fillHoles(radius)` が使える（sandbox に注入済み）。

```javascript
// 手が届く範囲の穴を自動で埋める
await fillHoles(5);
```

手動版（sandbox外 or カスタム版）:
```javascript
const pos = bot.entity.position;
const footY = Math.floor(pos.y);
const filler = bot.inventory.items().find(i =>
  ['cobblestone', 'dirt', 'stone', 'andesite', 'diorite', 'granite'].includes(i.name)
);
if (!filler) { log('埋め戻し素材なし'); return; }
await bot.equip(filler, 'hand');

let filled = 0;
const MAX_DIST = 4.5;

for (let dx = -4; dx <= 4; dx++) {
  for (let dz = -4; dz <= 4; dz++) {
    const sx = Math.floor(pos.x) + dx;
    const sz = Math.floor(pos.z) + dz;
    const atFoot = bot.blockAt(new Vec3(sx, footY, sz));
    const below = bot.blockAt(new Vec3(sx, footY - 1, sz));

    if (atFoot && atFoot.name === 'air' && below && below.name === 'air') {
      // 支えブロックを探す
      let supportY = -1;
      for (let cy = footY - 2; cy >= footY - 5; cy--) {
        const cb = bot.blockAt(new Vec3(sx, cy, sz));
        if (cb && cb.name !== 'air' && cb.name !== 'water') { supportY = cy; break; }
      }
      if (supportY < 0) continue;

      for (let fy = supportY + 1; fy < footY; fy++) {
        const targetPos = new Vec3(sx, fy, sz);
        if (targetPos.distanceTo(pos) > MAX_DIST) continue;  // 距離チェック必須

        const ref = bot.blockAt(new Vec3(sx, fy - 1, sz));
        if (ref && ref.name !== 'air') {
          try {
            // safePlaceBlock (raw packet) 推奨
            await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
            bot._client.write('block_place', {
              location: { x: ref.position.x, y: ref.position.y, z: ref.position.z },
              direction: 1, hand: 0, cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false
            });
            await wait(100);
            filled++;
          } catch(e) {}
        }
      }
    }
  }
}
log('穴埋め: ' + filled + 'ブロック');
```

---

## 2. 安全な平地化（横方向から削る方式）

**核心: TARGET_Y に立ち、横から壁を掘る。絶対に足元を掘らない。**

```javascript
const TARGET_Y = 101;  // 地形調査で最頻値を使う
const BATCH_SIZE = 40;  // 120秒制限内に収める
let dugCount = 0;

// Step 0: 地形調査 — まず最頻高さを決める
const heights = {};
const pos = bot.entity.position;
for (let dx = -15; dx <= 15; dx += 2) {
  for (let dz = -15; dz <= 15; dz += 2) {
    for (let y = 130; y >= 60; y--) {
      const b = bot.blockAt(new Vec3(Math.floor(pos.x)+dx, y, Math.floor(pos.z)+dz));
      if (b && b.name !== 'air' && b.name !== 'water') {
        heights[y] = (heights[y] || 0) + 1;
        break;
      }
    }
  }
}
const targetY = parseInt(Object.entries(heights).sort((a,b) => b[1]-a[1])[0][0]);
log('Target level: Y=' + targetY);

// Step 1: TARGET_Y+1 の高さに移動
const movements = new Movements(bot);
movements.canDig = false;
movements.maxDropDown = 2;
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalY(targetY + 1));

// Step 2: 横方向から掘る（足元は掘らない！）
const myY = Math.floor(bot.entity.position.y);
for (let y = myY; y > targetY && dugCount < BATCH_SIZE; y++) {
  // y は TARGET_Y+1 以上のみ
  for (let dx = -3; dx <= 3 && dugCount < BATCH_SIZE; dx++) {
    for (let dz = -3; dz <= 3 && dugCount < BATCH_SIZE; dz++) {
      const block = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x)+dx, y, Math.floor(bot.entity.position.z)+dz));
      if (!block || block.name === 'air' || !block.diggable) continue;
      // 重要物を掘らない
      if (['chest','furnace','crafting_table','bed','torch'].some(n => block.name.includes(n))) continue;
      const dist = bot.entity.position.distanceTo(block.position.offset(0.5,0.5,0.5));
      if (dist > 4.2) continue;
      // 足元ブロックは掘らない！
      if (block.position.y < Math.floor(bot.entity.position.y)) continue;
      try { await bot.dig(block); dugCount++; } catch(e) {}
    }
  }
}

log('掘削: ' + dugCount + 'ブロック');
```

### 巡回パターン（複数回実行で広域整地）

```javascript
// 8方向のウェイポイントを順に巡回
const CENTER = { x: 12, z: 0 };
const RADIUS = 12;
const waypoints = [
  { x: CENTER.x + RADIUS, z: CENTER.z },
  { x: CENTER.x, z: CENTER.z + RADIUS },
  { x: CENTER.x - RADIUS, z: CENTER.z },
  { x: CENTER.x, z: CENTER.z - RADIUS },
];

for (const wp of waypoints) {
  await bot.pathfinder.goto(new goals.GoalNear(wp.x, TARGET_Y + 1, wp.z, 3));
  // 各ウェイポイントで横方向掘削 + fillHoles
  // ... (上記 Step 2 + fillHoles)
}
```

---

## 3. 安全な掘り下げパターン（階段式）

高い場所を TARGET_Y まで下げる場合、**足元を掘らず階段状に降りる**:

```javascript
// 階段掘り — 前方＋下方のブロックを掘って斜めに降りる
const targetY = 101;
let dug = 0;

for (let step = 0; step < 20; step++) {
  const myY = Math.floor(bot.entity.position.y);
  if (myY <= targetY + 1) break;

  // 前方のブロック（頭と足の高さ）を掘る
  const forward = bot.entity.position.offset(1, 0, 0);
  const headBlock = bot.blockAt(new Vec3(Math.floor(forward.x), myY + 1, Math.floor(forward.z)));
  const bodyBlock = bot.blockAt(new Vec3(Math.floor(forward.x), myY, Math.floor(forward.z)));
  const floorBlock = bot.blockAt(new Vec3(Math.floor(forward.x), myY - 1, Math.floor(forward.z)));

  // 頭の高さを掘る
  if (headBlock && headBlock.diggable && headBlock.name !== 'air') {
    await bot.dig(headBlock); dug++;
  }
  // 足の高さを掘る
  if (bodyBlock && bodyBlock.diggable && bodyBlock.name !== 'air') {
    await bot.dig(bodyBlock); dug++;
  }
  // 前に進む
  bot.setControlState('forward', true);
  await wait(500);
  bot.setControlState('forward', false);
}
```

---

## 4. 採掘ループへの組み込み

```javascript
async function safeDigAndFill(block) {
  // 足元チェック: 掘ると落ちるか？
  if (block.position.y < Math.floor(bot.entity.position.y)) {
    log('足元は掘らない！');
    return;
  }

  await bot.dig(block);

  // 掘った後の穴埋め
  const underFeet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (underFeet && underFeet.name === 'air') {
    const filler = bot.inventory.items().find(i =>
      ['cobblestone','dirt'].includes(i.name)
    );
    if (filler) {
      await bot.equip(filler, 'hand');
      const twoBelow = bot.blockAt(bot.entity.position.offset(0, -2, 0));
      if (twoBelow && twoBelow.name !== 'air') {
        // raw packet で高速配置
        await bot.lookAt(twoBelow.position.offset(0.5, 1.5, 0.5), true);
        bot._client.write('block_place', {
          location: { x: twoBelow.position.x, y: twoBelow.position.y, z: twoBelow.position.z },
          direction: 1, hand: 0, cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false
        });
        await wait(100);
      }
    }
  }
}
```

---

## 注意事項

- **鉱石は平地化でも掘らない** — `iron_ore`, `coal_ore` 等は除外
- **大きな radius は複数バッチに分割** — 1回30-50ブロックが上限
- **pathfinder は初回移動のみ** — 近距離は手動移動 (setControlState)
- **HP監視必須** — 落下ダメージに注意、HP < 8 で中断
- **夜間は装備確認** — 整地中にMob攻撃される
- **素材管理** — cobblestone > dirt > stone の優先順位で埋め戻し
- **距離チェック必須** — placeBlock は 4.5ブロック以内のみ有効

## Pathfinder 安全設定

整地時は必ず以下を設定:
```javascript
const movements = new Movements(bot);
movements.canDig = false;     // pathfinder が勝手に掘らない
movements.maxDropDown = 2;    // 2ブロック以上の落下を避ける
movements.dontCreateFlow = true;
bot.pathfinder.setMovements(movements);
```
