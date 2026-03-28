# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

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
- **Status**: Reported - Session 100 (2026-03-28)
- **Notes**: 正しいAPIは `status()`, `log()`, `getMessages()`, `chat()`, `wait()`, `reconnect()` (top-level)。高レベルのgather/craft/combat等は存在しない。SKILL.mdとCLAUDE.mdのドキュメントが実装と乖離している。エージェントが正しいAPIを使えるようにドキュメントを修正するか、sandboxに`bot.status = status`等のエイリアスを追加する必要がある。

---

## [2026-03-28] Bug: server_full - Claude2接続不能（Session 99）

- **Cause**: セッション開始時にサーバーが満員（server_full）でClaude2が接続できない。3回試行、全て同じエラー。他のボットが接続を占有している可能性。
- **Coordinates**: N/A (接続前)
- **Last Actions**: mc-connect.cjs localhost 25565 Claude2 → 即座に "Kicked: multiplayer.disconnect.server_full"
- **Error Message**: Error: Kicked: {"translate":"multiplayer.disconnect.server_full"}
- **Status**: Reported - Session 99 (2026-03-28)
- **Notes**: 同じバグがSession 97でも報告済み（bot2.md内）。サーバーのmax-players設定が低すぎるか、切断されなかったゾンビセッションが残っている可能性。

---

## [2026-03-28] Bug: daemon再起動後にserver_full - Claude2接続不能

- **Cause**: デーモン再起動後、他のボット（Claude1-7）が自動再接続してサーバーをserver_full状態にした。Claude2が接続できない。
- **Coordinates**: N/A (接続前)
- **Last Actions**: daemon停止 → npm run daemon で再起動 → mc-connect.cjs実行 → "Kicked: multiplayer.disconnect.server_full" エラー
- **Error Message**: Error: Kicked: {"translate":"multiplayer.disconnect.server_full"}
- **Status**: Reported - Session 97 (2026-03-28)
- **Notes**: サーバーのmax-players設定を確認する必要あり。または他のボットの自動再接続を無効化する必要あり。

---

## [2026-03-28] Bug: craft()タイムアウト + farm()タイムアウト - CRITICAL

- **Cause**: craft('crafting_table'), craft('bread'), farm() が60-90秒でタイムアウト。クラフト系API全般が機能不全。
- **Coordinates**: X:9, Y:99, Z:24 (地上)
- **Last Actions**: craft('crafting_table')→60秒タイムアウト、farm()→90秒タイムアウト、craft('bread')→小麦を消費せず即完了（実際には何も作られない）
- **Error Message**: "Execution timed out after 60000ms", またはcraft完了するが素材消費なし・アイテム作成なし
- **Status**: Reported - Session 97 (2026-03-28)
- **Affected APIs**: bot.craft(), bot.farm()
- **HP/Hunger**: HP:10, Hunger:0→15
- **Notes**: combat('cow')後アイテムがインベントリに入らないバグも継続。navigate('apple')後にbread 1個入ったのは謎。wheat:5→6も理由不明。craft()はwheat消費しないで即完了する（タイムアウトではないが実効なし）。
