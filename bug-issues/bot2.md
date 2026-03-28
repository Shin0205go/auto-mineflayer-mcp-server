# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

---

## [2026-03-28] Bug: 地形スタック - controlStateが動作しない特定座標 (Session 101)

- **Cause**: 特定の座標（-3,106,12 および 33,99,-1）でsetControlState('forward'/'sprint')/bot.lookを使っても全く移動できない。全方向テストして空気があっても動かない。他の座標では正常に動く。
- **Coordinates**: -3.3,106.0,12.7 および 33,99,-1
- **Last Actions**: bot.look → setControlState('forward', true) → wait(2000) → 座標変化なし
- **Error Message**: 移動量=0（エラーなし、サイレント失敗）
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: 33,99,-1は地上のcrafting_tableの上。-3,106,12は洞窟内のstone上。どちらも足元がsolidブロック、上が空気の状態。原因不明。管理者テレポートで一時脱出できたが、また別の場所でスタック。

---

## [2026-03-28] Bug: 落下によるHP:5 + 食料なし (Session 101)

- **Cause**: 移動中に予期しない落下（Y=91→75、16ブロック落下）でHP:5まで減少。食料ゼロ。
- **Coordinates**: 8,74,-4
- **Last Actions**: West方向に移動 → 落下
- **Error Message**: "[Server]: Claude2 fell from a high place"
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: keepInventory有効。管理者(shng25)によるTP+HP回復で救助。食料システムが機能しないためHPの自然回復が期待できない。

---

## [2026-03-28] Bug: pathfinder.goto永久タイムアウト + controlState無効 - CRITICAL (Session 101)

- **Cause**: pathfinder.gotoがカスタムgoalを受け付けるが永久にタイムアウト（30-60秒）。bot.setControlState('forward', true)も全く効かない（2秒後も同じ座標）。ボットが完全に移動不能。
- **Coordinates**: x=33, y=99, z=-1
- **Last Actions**:
  1. pathfinder.goto(customGoal) → 60秒タイムアウト
  2. setControlState('forward', true) + wait(2000) → 座標変化なし
  3. bot.dig(grassBlock) → 成功（採掘は機能）
- **Error Message**: "Execution timed out after 60000ms" (pathfinder.goto)
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: goalsオブジェクトはスコープにundefined。Movementsは使用可能。bot.dig()は機能する。完全に移動できないため、鉄採掘・精錬・フェーズ進行が不可能。

---

## [2026-03-28] Bug: bot.placeBlock() 5秒タイムアウト (Session 101)

- **Cause**: bot.placeBlock(refBlock, faceVec)がblockUpdateイベントを待機して5秒タイムアウトする。crafting_tableのEast面/Top面両方で失敗。
- **Coordinates**: x=33, y=99, z=-1
- **Last Actions**: furnaceをcrafting_tableに設置 → "Event blockUpdate:(34, 98, -1) did not fire within timeout of 5000ms"
- **Error Message**: Event blockUpdate:(34, 98, -1) did not fire within timeout of 5000ms
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: furnaceはインベントリに残る。ブロック設置が機能しない。

---

## [2026-03-28] Bug: bot.status/bot.log等がmc_execute sandbox内で未定義 (Session 100)

- **Cause**: SKILL.md, CLAUDE.md等のドキュメントには`bot.status()`, `bot.log()`と書いてあるが、mc-execute.tsのsandboxでは`status()`, `log()`, `getMessages()`がtop-levelの関数として定義されている。`bot`はmineflayerのrawBotオブジェクトで、これらのラッパーメソッドを持たない。
- **Coordinates**: x=0.7, y=86, z=-2.3
- **Last Actions**: BOT_USERNAME=Claude2 node scripts/mc-execute.cjs "const s = await bot.status(); bot.log(...);" → TypeError: bot.status is not a function
- **Error Message**: TypeError: bot.status is not a function / TypeError: bot.log is not a function
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: 正しいAPIは `status()`, `log()`, `getMessages()`。高レベルのgather/craft/combat等は存在しない。SKILL.mdとCLAUDE.mdのドキュメントが実装と乖離している。

---

## [2026-03-28] Bug: server_full - Claude2接続不能（Session 99）

- **Cause**: セッション開始時にサーバーが満員（server_full）でClaude2が接続できない。
- **Coordinates**: N/A (接続前)
- **Last Actions**: mc-connect.cjs localhost 25565 Claude2 → "Kicked: multiplayer.disconnect.server_full"
- **Error Message**: Error: Kicked: {"translate":"multiplayer.disconnect.server_full"}
- **Status**: Reported

---

## [2026-03-28] Bug: craft()タイムアウト + farm()タイムアウト - CRITICAL

- **Cause**: craft('crafting_table'), craft('bread'), farm() が60-90秒でタイムアウト。
- **Coordinates**: X:9, Y:99, Z:24 (地上)
- **Error Message**: "Execution timed out after 60000ms"
- **Status**: Reported
