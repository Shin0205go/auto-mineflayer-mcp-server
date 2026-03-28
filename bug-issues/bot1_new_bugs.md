## [2026-03-28] Bug: Session 92 - gamerule無限チャットループ

- **Cause**: 接続直後からGameruleメッセージ（doTileDrops, doMobLoot, doEntityDrops, doMobSpawning, keepInventory）が5連セットで毎秒数回ずつ無限に送信され続けている。bot.getMessages()で大量のチャットが返り、ゲームプレイの進行が妨げられている。bot1.mdが434KBに達した。
- **Coordinates**: (-3, 60, -8) - birch_forest
- **Last Actions**: mc_connect後にmc_chat/mc_executeを実行するたびにgameruleチャットが大量返却される
- **Error Message**: "Gamerule doTileDrops is now set to: true]" などが毎秒数回ループ。閉じカッコ"]"が欠けているのも不自然。
- **Root Cause推測**: サーバー側またはボット接続時の初期化コードがgamerule設定を繰り返し実行している可能性。
- **Impact**: 高。チャット履歴がスパムで埋まり、ボットの判断精度が下がる。
- **Status**: Reported 2026-03-28 Session 92

## [2026-03-28] Bug: Session 92 - pillarUp/build("shelter")タイムアウト

- **Cause**: bot.pillarUp(8)が30秒でタイムアウト、bot.build("shelter")が60秒でタイムアウト。夜間に安全確保ができない。
- **Coordinates**: (-1.5, 74, -7.5) - birch_forest
- **Last Actions**: 夜間、敵mob多数環境でpillarUp(8)とbuild("shelter")を実行→両方タイムアウト
- **Error Message**: "Execution timed out after 30000ms" / "Execution timed out after 60000ms"
- **Root Cause推測**: pillarUpがコブルストーンを認識できないかpathfinding干渉で無限ループ
- **Status**: Reported 2026-03-28 Session 92

## [2026-03-28] Bug: Session 92 - combat後に食料ドロップなし継続（Session 91からの継続）

- **Cause**: bot.combat("cow"), bot.combat("chicken") を実行しても食料がインベントリに入らない。Session 90, 91から継続している問題。
- **Coordinates**: (-2, 74, -8) - birch_forest
- **Last Actions**: combat("cow") → food:[] / combat("chicken") → food:[]
- **Error Message**: なし（combatは即終了するが食料なし）
- **Status**: Reported 2026-03-28 Session 92 (継続バグ)
