# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

---

## [2026-03-28] Bug: ボット宙浮き・移動不能 + 多数のbot.* API未定義 (Session 102)

- **Cause**: 再接続後にY=102.00で完全に固定。setControlState('jump')してもbot.entity.positionが変化しない。また bot.gather, bot.status, bot.flee, bot.moveTo, bot.navigate, bot.eat, bot.farm, bot.combat, bot.equipArmor がすべてundefined（bot.craftのみ動作）。pathfinder.gotoは90秒タイムアウト。
- **Coordinates**: x=-21, y=102, z=0
- **Last Actions**: mc-connect.cjs で再接続後、bot.entity.position.y=102.00でfloating状態。setControlState/bot.dig/pathfinder.gotoが全て機能しない。
- **Error Message**: pathfinder.goto: "Execution timed out after 90000ms", bot.dig: 0ブロック採掘（サイレント失敗）
- **Status**: Reported - Session 102 (2026-03-28)
- **Notes**: bot.farm/bot.gather/bot.flee等の高レベルAPIがundefinedなのはsandbox構成の問題と思われる。宙浮きはmineflayerのエンティティ状態がリセットされていない可能性。

---

## [2026-03-28] Bug: 溺死 - Y=62移動中 (Session 102)

- **Cause**: 移動中（前進+スプリント）に水中に落下して溺死。pathfinderが使えないためcontrolState手動移動に頼っていたが地形確認なしで移動したため水域に落下。
- **Coordinates**: x=1.7, y=62, z=2.7 付近
- **Last Actions**: forward+sprint で農場エリアに向けて移動中
- **Error Message**: "[Server]: Claude2 drowned"
- **Status**: Reported - Session 102 (2026-03-28)
- **Notes**: pathfinder不機能のためcontrolState手動移動を使っているが、地形チェックなしの前進移動は水/崖落下の危険がある。リスポーン後Y=114の高所。keepInventoryでアイテム保持。

---

## [2026-03-28] Bug: 溺死 + ゾンビ死亡 (Session 101) - CRITICAL DEATHS

- **Cause**:
  1. 水中に入り込み溺死（水の中でジャンプできず脱出不能）
  2. ゾンビに倒される（HP低下中に野外でゾンビと遭遇）
- **Coordinates**: 1,67,9 (溺死), 2,82,-2 (ゾンビ)
- **Last Actions**: 落下→水中entrapment→溺死。その後ゾンビ遭遇→死亡。
- **Error Message**: "[Server]: Claude2 drowned", "[Server]: Claude2 was slain by Zombie"
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: keepInventoryあるため装備は残存。根本原因はpathfinder不機能による地形スタック+落下の連鎖。食料なし+水中で逃げ場がなかった。

---

## [2026-03-28] Bug: 地形スタック連鎖 + 予期しない落下 - CRITICAL (Session 101)

- **Cause**: 移動中に繰り返し深い穴や洞窟に落下する。controlState('forward')が正しく動作せず、予期しない方向に移動して落下する。
- **Coordinates**: 各地（-3,106,12 / 33,99,-1 / 1,67,9）
- **Last Actions**: controlState forward → Z/X方向が反転して崖から落下
- **Error Message**: なし（サイレント失敗）
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: yawマッピングが混乱している可能性。確認したyaw:
  - yaw=0 → dz=-3.4 (North, -Z方向) ✓
  - yaw=-Math.PI/2 → dx=+2 (East, +X方向) ✓
  - yaw=Math.PI/2 → dx=-X (West, -X方向) ✓
  - yaw=Math.PI → 期待South(+Z)だが実際はNorth(-Z)に移動することも？
  落下防止のためflee/pillarUp/placeBlockが全て動作しないことが根本問題。

---

## [2026-03-28] Bug: 地形スタック - controlStateが動作しない特定座標 (Session 101)

- **Cause**: 特定の座標でsetControlState('forward'/'sprint')/bot.lookを使っても全く移動できない。
- **Coordinates**: -3.3,106.0,12.7 および 33,99,-1 および 2,82,-2
- **Last Actions**: bot.look → setControlState('forward', true) → wait(2000) → 座標変化なし
- **Error Message**: なし（サイレント失敗）
- **Status**: Reported - Session 101 (2026-03-28)

---

## [2026-03-28] Bug: pathfinder.goto永久タイムアウト + controlState無効 - CRITICAL (Session 101)

- **Cause**: pathfinder.gotoがカスタムgoalを受け付けるが永久にタイムアウト（30-60秒）。
- **Coordinates**: x=33, y=99, z=-1
- **Error Message**: "Execution timed out after 60000ms" (pathfinder.goto)
- **Status**: Reported - Session 101 (2026-03-28)
- **Notes**: goalsオブジェクトはスコープにundefined。bot.dig()は機能する。

---

## [2026-03-28] Bug: bot.placeBlock() 5秒タイムアウト (Session 101)

- **Cause**: bot.placeBlock(refBlock, faceVec)がblockUpdateイベントを待機して5秒タイムアウトする。
- **Error Message**: Event blockUpdate:(34, 98, -1) did not fire within timeout of 5000ms
- **Status**: Reported - Session 101 (2026-03-28)

---

## [2026-03-28] Bug: bot.status/bot.log等がmc_execute sandbox内で未定義 (Session 100)

- **Cause**: ドキュメントとsandbox実装の乖離。`status()`, `log()`, `getMessages()` はtop-level関数。
- **Status**: Reported - Session 100 (2026-03-28)

---

## [2026-03-28] Bug: craft()タイムアウト + farm()タイムアウト - CRITICAL

- **Cause**: craft('crafting_table'), craft('bread'), farm() が60-90秒でタイムアウト。
- **Status**: Reported - Session 97

---

## [2026-03-28] Bug: bot.dig()が異常に遅い + pathfinder.goto永久タイムアウト (Session 102)

- **Cause**: bot.dig(block)で1ブロック掘るのに約14秒かかる。stone_pickaxeで石を掘っているにもかかわらず非常に遅い。pathfinder.gotoは60秒でタイムアウトし移動できない。
- **Coordinates**: x=3.9, y=61.5, z=3.3 (掘削場所)
- **Last Actions**: stone_pickaxeを装備してbot.dig(stoneBlock)を呼び出し。14秒後に完了。
- **Error Message**: "Execution timed out after 60000ms" (dig loop), pathfinder.goto timeout
- **Status**: Reported - Session 102 (2026-03-28)
- **Notes**: 以前のセッション(101)でも同じpathfinder問題が報告済み。未修正のまま継続している。

---

## [2026-03-28] Bug: 謎のリスポーン/テレポート (Session 102)

- **Cause**: bot.dig()ループが60秒タイムアウト後、座標がY=61からY=107に変化し、HP=20/Hunger=20に回復。インベントリは保持されている。
- **Coordinates**: 開始: x=1.6, y=61, z=4.6 → 終了: x=-20.6, y=107, z=1.6
- **Last Actions**: bot.dig()ループが60秒タイムアウトで中断
- **Error Message**: タイムアウトエラーのみ
- **Status**: Reported - Session 102 (2026-03-28)
- **Notes**: 死亡→リスポーン（keepInventory ON）と推測される。死因不明。地下Y=61で掘削中に落下か敵か？
