## [2026-03-27] Bug: Session 117 UPDATE - combat/place後に即切断バグ確認, CRITICAL継続

- **Cause**: bot.combat()やbot.place()を呼んだ直後（1-3秒）にサーバー切断が発生
- **Coordinates**: (40.2, 76, -1.6) - 全セッション同じ
- **Pattern**:
  - bot.combat("cow") → "牛を倒した" ログ → 即切断
  - bot.combat("chicken/pig") → 完了 → 即切断
  - bot.combat("zombie") → "No zombie found" → 即切断
  - bot.place("crafting_table") → 成功 → 即切断
  - bot.navigate() → 即完了（実際の移動なし）
  - bot.gather/moveTo/farm → 60秒タイムアウト
- **Impact**: HP5.9 Hunger0 食料0が16セッション以上継続。食料確保不能。
- **Status**: Reported Session 117. combat/place後の即切断バグ最優先修正必要。

## [2026-03-27] Bug: Session 117 - 死亡疑い (HP5.9 Hunger0 食料0状態から切断), CRITICAL継続

- **Cause**: HP5.9 Hunger0 食料0の状態で鶏・豚を倒した直後に切断（死亡の可能性）
- **Coordinates**: (40.2, 76, -1.6)
- **Last Actions**: bot.navigate("chicken") → bot.combat("chicken") → bot.navigate("pig") → bot.combat("pig") → 切断
- **Error Message**: "Not connected to any server"
- **Observation**:
  - 動物を倒してもドロップが取得できない（beefなし、leatherのみ）
  - Hunger0のまま食事不能
  - bot.navigate("cow") が即時完了するが食料ドロップなし
  - moveTo全タイムアウト継続
- **Status**: Reported. Session 117. 死亡バグ + 食料ドロップ取得バグ継続。

## [2026-03-27] Bug: Session 116 (current) - craft/moveTo/pillarUp/farm全タイムアウト継続, CRITICAL: Sessions 101-116

- **Session 116 観察**:
  - HP:5.9 Hunger:0 Food=0 - 全く改善なし（Sessions 101-116で同じ）
  - 座標: (40.1, 76.0, -1.9) - 毎セッション同じ場所
  - bot.craft("furnace"): 30秒タイムアウト（crafting_table設置後も）
  - bot.moveTo(60, 76, 0): 30秒タイムアウト（短距離でも失敗）
  - bot.pillarUp(5): 30秒タイムアウト
  - bot.farm(): 120秒タイムアウト
  - bot.combat("cow/pig/chicken/sheep/zombie"): 即時完了するが食料ドロップなし
  - bot.navigate("cow/pig"): 即時完了（実際の移動なし）
  - bot.status(): 正常動作
  - bot.place("crafting_table"): 動作した（6秒）
  - **根本バグ継続**: moveTo/craft/pillarUpのタイムアウトが全16セッションで継続
  - **crafting_table設置後もcraft("furnace")タイムアウト** — 新観察
  - **緊急度**: CRITICAL - Session 116まで継続。
- **Status**: Reported. Session 116. CRITICAL - コードレビュー最急務。

## [2026-03-27] Bug: Session 115 (current) - gather/combat/moveTo全タイムアウト継続, CRITICAL: Sessions 101-115

- **Session 115 観察**:
  - HP:5.9 Hunger:0 Food=0 - 全く改善なし（Sessions 101-115で同じ）
  - 座標: (40.1, 76.0, -1.9) - 毎セッション同じ場所
  - Time: midnight (ticks:20643)
  - gather("wheat", 5): 60秒タイムアウト
  - combat("cow"): 完了するがHP/hunger変わらず、食料ドロップなし
  - combat("chicken"): 完了するがHunger変わらず
  - eat(): 呼んでも効果なし（食料アイテムがinventoryにない）
  - flee(): 完了するが接続すぐ切れる
  - **根本バグ同じ**: gather/farm/moveTaタイムアウト + 食料アイテムドロップなし
  - **緊急度**: CRITICAL - Session 115まで継続。コードレビュー最急務。
- **Status**: Reported. Session 115. CRITICAL.

## [2026-03-27] Bug: Session 114 (current) - 接続切断+moveTo+farm+アイテムドロップバグ継続, CRITICAL: Sessions 101-114

- **Session 114 観察**:
  - HP:5.9 Hunger:0 Food=0 - 全く改善なし（毎セッション同じ）
  - 座標: (40.1, 76.0, -1.9) - 毎セッション同じ場所
  - combat("cow"): leatherのみ、raw_beef なし
  - combat("pig"): 完了するがporkなし（食料ドロップなし）
  - farm(): 120秒タイムアウト
  - moveTo(45,76,-2): 30秒タイムアウト（短距離でも失敗）
  - moveTo(140,76,-1): 60秒タイムアウト
  - navigate("cow"): 23ms即時完了（実際の移動なし）
  - navigate("sheep"): 2901ms完了（実際の移動なし）
  - **根本バグ継続**: Sessions 101-114で同じ状態が継続
    1. moveTo タイムアウトバグ: 短距離でもタイムアウト
    2. アイテムドロップバグ: combatで食料が得られない
    3. farm() タイムアウト: 農場作業が完了しない
  - **緊急度**: CRITICAL - ゲームプレイ完全不可能
  - **優先修正事項**: moveTo の pathfinding/timeout 問題
- **Status**: Reported. Session 114. CRITICAL - コードレビュー最急務。

## [2026-03-27] Bug: Session 113 (current) - 接続切断+pillarUp+farm+アイテムドロップバグ継続, CRITICAL: Sessions 101-113

- **Session 113 観察**:
  - HP:5.9 Hunger:0 Food=0 - 状況改善なし（前セッションと全く同じ）
  - 座標: (40.1, 76.0, -1.9) - 毎セッション同じ場所にリセット
  - combat("chicken"): feather/eggのみドロップ、raw_chicken なし（食料ドロップなし）
  - combat("cow"): leatherのみドロップ、raw_beef なし（食料ドロップなし）
  - pillarUp(3): 30秒タイムアウト
  - pillarUp(6): 30秒タイムアウト
  - farm(): 60秒タイムアウト
  - navigate("wheat"): 30秒タイムアウト
  - moveTo: 120秒タイムアウト（前セッションと同じ）
  - wait(30000): Not connected エラー
  - 時刻: midnight (ticks:21849) - 夜間で危険
  - **根本バグ継続**: 3種類のバグが複合
    1. 接続切断バグ: wait/moveTo/farm等でNot connected
    2. アイテムドロップバグ: combat成功でも食料アイテムが取得できない（骨/羽/革のみ）
    3. pillarUp/moveTo タイムアウトバグ
  - **緊急度**: CRITICAL - Sessions 101-113で同じ状態が継続、ゲームプレイ完全不可能
- **Session 113 追加観察** (朝morning):
  - craft("furnace"): 15-20秒タイムアウト（作業台がインベントリにあるのに失敗）
  - craft("furnace", 1, false): 同タイムアウト
  - navigate("crafting_table"): 15秒タイムアウト（作業台がworld/invにあるが見つからない？）
  - navigate("cow"): 3ms即時完了（実際の移動なし）
  - navigate("chicken"): 277ms完了（実際の移動なし）
  - combat("pig"): 完了するがporkなし（アイテム取得不可）
  - gather("oak_log", 3): 完了するがlogなし（採掘効果なし）
  - **パターン**: navigate/combat/gatherが即時完了するが世界と実際に相互作用していない
  - **仮説**: botがspawnしているが、実際のMinecraftワールドと同期していない可能性
- **Status**: Reported. Session 113. CRITICAL - コードレビュー最急務。修正なしでは進行不可能。

---

## [2026-03-27] Bug: Session 112 (current) - 接続切断バグ継続, CRITICAL: Sessions 101-112継続

- **Session 112 観察**:
  - HP:5.9 Hunger:0 Food=0 - 状況改善なし
  - 接続直後のstatus確認は成功(273ms)、inventory確認も成功(5ms)
  - combat("cow", 8): 1405ms完了 - エラーなし、しかし食料が0のまま（ドロップ取得バグ）
  - combat("chicken", 8): 1006ms完了 - エラーなし、しかし食料が0のまま（同様）
  - craft("furnace"): 10秒後にNot connected（接続切断バグ）
  - smelt("beef"): "No furnace found" エラー(10652ms) - furnaceなし
  - gather("oak_log", 3): 833ms完了 - しかし木材がinvに追加されない（gather効果なし）
  - bot位置: (40,76,-2) - 前セッションと全く同じ場所でスタック継続
  - inventory: wheat_seeds x55, cobblestone x185, crafting_table x1, stone tools各種, iron_sword x1
  - 根本バグ2種類:
    1. 接続切断バグ: 複数秒の操作(craft/wait/moveTo)で必ずNot connected
    2. アクション効果なしバグ: combat/gatherは完了するがアイテムが取得できない
  - これら2バグの複合でゲームプレイが完全に不可能
- **Status**: Reported. Session 112. CRITICAL - コードレビュー最急務。修正なしでは進行不可能。

---

## [2026-03-27] Bug: Session 111 (current) - Bot fully stuck at (40,76,-2), CRITICAL: Sessions 101-111継続

- **Session 111 観察**:
  - HP:5.9 Hunger:0 Food=0 - 状況改善なし
  - pillarUp: 120秒タイムアウト
  - moveTo(45,70,0): 60秒タイムアウト
  - moveTo(53,65,6): 120秒タイムアウト
  - combat("cow"): 成功するがドロップ取得できない（食料0継続）
  - combat("chicken")+combat("pig"): 完了するが食料0
  - flee(10): Not connected エラー（10秒切断バグ継続）
  - farm(): 120秒タイムアウト
  - ボットは(40.1, 76, -1.9)から動けない。接続10秒切断バグ継続。
  - **根本問題**: ボットスタック + 接続不安定 + アイテムドロップ取得失敗が複合している
- **Status**: Reported. Session 111. CRITICAL - コードレビュー最急務。

---

## [2026-03-27] Bug: Session 110 (current) - Bot connection drops after ~10s, CRITICAL: Sessions 101-110継続

- **Session 110 詳細分析**:
  - mc_reload後: moveTo(2ブロック)は成功(3sec)。その直後のmoveTo(5ブロック)で切断。
  - wait(10000ms)実行中に切断される。
  - combat("cow")成功後、inv確認時に切断される。
  - craft("furnace")成功。place("furnace")成功。
  - 接続が~10秒で自動切断される「keepaliveバグ」が根本原因。
  - HP:5.9 Hunger:0 Food=0 継続。combat成功でもドロップがinvに追加されない。
- **Root Pattern**: 接続してから約10秒後に必ずNot connected。何らかの操作（wait/moveTo/combat）のどれかがトリガー。
- **Session 110 追加観察**:
  - mc_reload後: moveTo(2ブロック)成功(736ms)→切断→再接続→(40.1,76,-1.9)にリセット
  - 毎回接続直後のpositionが(40.1,76.0,-1.9)で固定（移動が保持されない）
  - farm()は60秒タイムアウト（接続中でも処理開始せずタイムアウト）
  - navigate("chest")タイムアウト
  - 朝(morning, ticks=107)でも同様のバグ継続
  - **仮説**: ボットが「ゾンビ状態」にある - サーバー側では存在するが、MCP側の接続が不安定でkeepaliveが送れずサーバーから切断される。切断のたびにスポーン位置にリセットされる。
  - **必要な修正**: keepalive送信の維持 + 切断後の位置保持 or 正しいリスポーン位置への移動
- **Session 109 追記**: 同じ状況継続。HP:5.9 Hunger:0 Food=0。moveTo(5ブロック)タイムアウト継続。pillarUpタイムアウト。navigateタイムアウト。bot.combat()後にNot connectedエラーで切断される。farm()120秒タイムアウト。ボットはX=40.1,Y=76,Z=-1.9から動けない。根本問題未解決。コードレビュー急務。
- **Status**: Reported. Session 110. CRITICAL - 接続10秒切断バグ。コードレビュー急務。

---

## [2026-03-27] Bug: Session 108 (current) - Bot fully stuck at (40,76,-2), CRITICAL: Sessions 101-108継続, moveTo/gather/craft/pillarUpがタイムアウト

- **Session 108 追記**: 同じ状況継続。HP:5.9 Hunger:0 Food=0。bot.craft("furnace")がタイムアウト継続。bot.combat("cow")は成功するが生肉ドロップなし。チェスト(53,65,6)へのmoveTOが60秒でタイムアウト。根本問題未解決。
- **Status**: Reported. Session 108. CRITICAL - コードレビュー急務。

---

## [2026-03-27] Bug: Session 107 (current) - Bot fully stuck at (40,76,-2), CRITICAL: Sessions 101-107継続, moveTo/gather/craft/pillarUpがタイムアウト

- **Root Cause**: 7セッション連続で同じバグ継続。moveTo(5ブロック以上)が常にタイムアウト。
- **Coordinates**: (40.1, 76, -2) birch_forest
- **State**: HP=5.9 Hunger=0 Food=0
- **Observed in Session 107**:
  - bot.status() → 正常(300ms)
  - bot.moveTo(+1ブロック) → 成功(1.6sec)、ただし実際の位置は変化なし(40.5,76,-1.5のまま)
  - bot.moveTo(5ブロック以上) → 毎回タイムアウト
  - bot.pillarUp(3) → タイムアウト
  - bot.gather("birch_log") → タイムアウト
  - bot.craft("furnace") → レシピ見つからない（crafting_table設置済みでも）
  - bot.place("cobblestone") → 成功(8sec)
  - bot.place("crafting_table") → 成功(7sec)
  - bot.eat() → 成功するが食料0のためHP/hunger変化なし
  - 切断は発生しなくなったが、ボットは事実上動けない
- **Pattern**: moveTo/gather系操作がtimeoutする。ボットはy=76の同じ場所に固定されている。
- **URGENT**: コードレビューが急務。moveTo/gather/pillarUpのタイムアウト修正が必要。Sessions 101-107継続。
- **Status**: Reported. Session 107. CRITICAL.

---

## [2026-03-27] Bug: Session 106 (current) - Bot fully stuck at (40,76,-2), CRITICAL: combat後に切断される, Sessions 101-106 継続

- **Root Cause**: 6セッション連続で同じバグ継続。combat()実行直後に "Not connected" エラーで切断される。
- **Coordinates**: (40.1, 76, -2) birch_forest
- **State**: HP=5.9 Hunger=0 Food=0
- **Observed in Session 106**:
  - bot.status() → 正常(300ms)
  - bot.combat("cow") → "牛を狩った" ログ後すぐ切断エラー、食料ドロップなし
  - bot.combat("pig") → 同様、狩った後切断
  - bot.combat("chicken") → 同様
  - bot.farm() → 120秒タイムアウト
  - 毎回mc_connectで再接続が必要
- **Pattern**: combat()がアイテムを取得できず即切断。6セッション(101-106)連続で同一現象。
- **URGENT**: コードレビューが急務。combat後の切断バグとアイテムドロップ取得不具合の修正が必要。
- **Status**: Reported. Session 106. CRITICAL.

---

## [2026-03-27] Bug: Session 105 (current) - Bot fully stuck at (40,76,-2), CRITICAL: keepalive/movement bug continues Sessions 101-105

- **Root Cause**: 5セッション連続で同じバグ継続。moveTo() 短距離(5ブロック)でも120秒タイムアウト。
- **Coordinates**: (40, 76, -2) birch_forest
- **State**: HP=5.9 Hunger=0 Food=0
- **Observed in Session 105**:
  - bot.moveTo(x+5, y, z) → 120秒タイムアウト
  - bot.combat("chicken") → 瞬時返却、食料ドロップなし
  - bot.navigate("chicken"/"cow") → 成功するが位置変化なし(40,76,-2のまま)
  - bot.craft("furnace") → "success" だがインベントリに反映なし
  - bot.farm() → 実行後 "Not connected" エラー
  - status()/inventory() → 正常（300ms以内）
- **Pattern**: 5セッション(101-105)連続で同一現象。コードレビューが急務。
- **Status**: Reported. Session 105. NEEDS URGENT CODE FIX.

---

## [2026-03-27] Bug: Session 104 (current) - Bot fully stuck at (40,76,-2), CRITICAL: keepalive bug continues Sessions 101-104

- **Root Cause**: keepaliveタイムアウトバグ。combat()/moveTo()/farm()/pillarUp()全てタイムアウトまたは即返却で効果なし。
- **Coordinates**: (40, 76, -2) birch_forest
- **State**: HP=5.9 Hunger=0 Food=0
- **Sessions Affected**: 101, 102, 103, 104 (連続4セッション同じバグ)
- **Observed in Session 104**:
  - bot.combat("cow") → 1.5秒即返却、食料ゼロのまま
  - bot.farm() → 120秒タイムアウト
  - bot.combat("pig", 4) → 300秒タイムアウト
  - bot.flee() → 動作するが位置変化なし
  - status()/inventory() → 正常動作
- **Additional Session 104 Observations**:
  - place("crafting_table", px+1, py, pz) → 成功（8.5秒）
  - moveTo(px+1, py, pz) → 一見成功するが位置が(40.5,76,-1.5)に固定される
  - moveTo後に位置が常に(40.5,76,-1.5)にリセットされる
  - craft("furnace") → 45秒タイムアウト（crafting_table設置済みでも失敗）
  - 2ブロック移動を3回繰り返すと3回目は位置変化なし
- **Root Cause Hypothesis**: ボットがサーバー側でスタック状態。サーバーがクライアントの移動を拒否している可能性。
  またはkeepalive応答後に接続がリセットされてボットがリスポーン位置に戻される。
- **Critical**: 4セッション継続で同じバグ。コードレビューが必要。
- **Status**: Reported. Session 104.

---

## [2026-03-27] Bug: Session 103 (current) - Bot fully stuck at (40,76,-2), all movement ops timeout, combat drops missing

- **Root Cause**: 既知のkeepaliveタイムアウトバグ継続。moveTo/pillarUp/combat全てタイムアウトまたは即返却で効果なし。
- **Coordinates**: (40.1, 76, -1.9) birch_forest
- **State**: HP=5.9 Hunger=0 Food=0
- **Last Actions**:
  - bot.pillarUp(5) → 60秒タイムアウト
  - bot.combat("cow") → 即返却するが食料ゼロのまま
  - bot.moveTo(x+10, y, z) → 30秒タイムアウト、位置変化なし
  - bot.combat("pig"/"chicken"/"sheep"/"cow") → "Not connected" エラー（操作中に切断）
  - 再接続後 status() は動く（259ms）
- **Pattern**: combat() 呼び出し後に接続が切れる。reconnect後も位置変化なし。
- **Impact**: ゲームプレイ完全不可。飢餓でHP削れ続けている。
- **Status**: Reported. Session 103.

---

## [2026-03-27] Bug: Session 102 (current) - Bot fully stuck at (40,76,-2), all movement ops timeout

- **Root Cause**: 既知のkeepaliveタイムアウトバグ継続。moveTo/farm/pillarUp/navigate全てタイムアウト。
- **State**: HP=5.9 Hunger=0 Pos=(40.1, 76, -1.9) birch_forest
- **Observed**:
  - bot.moveTo(px+10, py, pz) → 30秒タイムアウト、位置変化なし
  - bot.farm() → 60秒タイムアウト
  - bot.pillarUp(3) → 20秒タイムアウト
  - bot.navigate("cow") → 成功返却するが位置変化なし
  - bot.combat("cow") → 成功返却するが食料ゼロのまま
  - bot.flee(10) → 1.5秒で成功返却するが位置変化なし
  - 唯一動く操作: status(), inventory(), flee()（但し移動なし）
- **Food**: ゼロ。wheat_seeds x55 あり。bread作れない（小麦ゼロ）
- **Inference**: Hunger=0, HP=5.9, botは飢餓ダメージ受けながらスタック。3秒keepalive問題で長操作不可
- **Priority**: CRITICAL - keepalive修正なしではゲームプレイ完全不可
- **Status**: Reported. Session 102.

---

## [2026-03-27] Bug: Session 101 (current) - pillarUp timeout + combat drop bug continues

- **Root Cause**: pillarUpが30秒タイムアウト。combat()成功返却するが肉ドロップなし。既知バグ継続。
- **State**: HP=5.9 Hunger=0 Time=night(15393) Pos=(40, 76, -2) birch_forest
- **Observed**:
  - bot.pillarUp(6) → 30秒タイムアウト（接続は生きているが動作しない）
  - bot.combat("cow") → 1.5秒で成功返却するが食料ドロップ取得なし
  - bot.moveTo(53, 65, 6) → 60秒タイムアウト（チェストへ移動できず）
  - bot.flee() → 10秒後成功返却するがHP変化なし
- **Context**: Chest at (53, 65, 6). 3秒keepalive問題の悪化か？
- **追加観察**:
  - 位置(40,76,-2)にリスポーンし続ける（飢餓死亡の繰り返し）
  - moveTo(px+1, py, pz)は1秒以内で成功するが、位置が毎回(40,76,-2)にリセット
  - moveTo 2ブロック以上 or 1秒超える操作はすぐ切断/タイムアウト
  - farm() 30秒タイムアウト
  - 事実上ゲームプレイ完全停止状態
- **必要な修正（優先度順）**:
  1. keepaliveパケット実装（最重要 - これなしでは何も動かない）
  2. combat()のドロップアイテム回収修正（食料が取れない）
  3. farm()の高速化 or short-circuit（既存農場があればすぐ収穫）
- **Status**: Reported. Session 101 end. Gameplay blocked.

---

## [2026-03-27] Bug: Session 65/100/current - Connection degraded to <500ms, starvation death imminent

- **Root Cause**: 3秒keepaliveタイムアウトバグ継続。Sessions 65/97/98/99/100と同じ。未修正。
- **Session 65 end state**: HP=5.9 (dropping from Hunger=0 starvation), morning ticks=1313, pos=(40.1,76,-1.9)
- **Connection degradation at end**: After many reconnect attempts, connections now last <500ms (previously 3s). Likely due to 6+ hostile mobs sending rapid damage packets overwhelming mineflayer.
- **Combat findings**: combat("chicken") times out at 10s with chicken clearly visible in entities list. Combat() is either not approaching the entity or not dealing damage.
- **New Findings (Session 100)**:
  - bot.combat("chicken") = 20秒後に成功返却するが食料ドロップなし（ドロップ取得バグ）
  - bot.navigate("cow") = 3秒でdisconnect
  - bot.combat("cow") = 1.25秒で成功返却するが食料なし（ドロップ取得バグ）
  - bot.flee() = 15秒でdisconnect（flee中に切断）
- **インベントリ**: iron_sword x1, wheat_seeds x55, cobblestone x183, stone_pickaxe x4, crafting_table - 食料ゼロ
- **影響**: ゲームプレイ完全停止。keepalive未実装で長時間操作不可。動物狩りしても肉ドロップなし。HP=5.9→dropping。
- **優先度**: CRITICAL - keepalive packet送信 + 動物肉ドロップ取得の修正が両方必要
- **Status**: Reported. Session 65/100 end.

---

## [2026-03-27] Bug: Session 65 (current) - iron_sword obtained from drops but Phase4 still blocked

- **Progress**: iron_sword x1 obtained by picking up dropped items (navigate + small moveTo loop)
- **State**: HP=6.9 Hunger=0 at (42.7, 74, -6.7) birch_forest day
- **Inventory highlights**: iron_sword x1, stone_pickaxe x3, cobblestone x180, wheat_seeds x55, bone_meal x13, coal+charcoal x3, crafting_table x1
- **Still needed**: iron_pickaxe (3 iron ingots), food (hunger=0 indefinitely)
- **Working operations** (<3s): status(), inventory(), place() single block, moveTo 1-2 blocks
- **Broken operations** (>3s = disconnect): combat(), navigate(), gather(), farm(), flee(), craft() for complex recipes
- **Pattern**: bot.moveTo(x+1, y, z) = ~600ms SUCCESS. moveTo(x+4, y, z) = ~2-3s DISCONNECTS. Any operation approaching 3 seconds causes server disconnect.
- **Status**: Reported. Session 65 ongoing. Phase 4 blocked by 3s timeout bug.

---

## [2026-03-27] Bug: Session 99 - 3秒切断バグ継続、bot.place()も3秒で切断

- **Root Cause**: 3秒keepaliveタイムアウトバグ継続。Session 65/97/98と同じ。
- **New Finding (Session 99)**:
  - bot.status() (~250ms) = 動作
  - bot.inventory() (~250ms) = 動作
  - bot.flee() → "Not connected" at exactly ~15秒（flee中に切断）
  - bot.place("torch", x, y, z) → "Not connected" at exactly 3024ms
  - bot.pillarUp() → "Not connected" at ~15秒
- **状況**: HP:6.9 Hunger:0 birch_forest Y=78 朝(ticks=5813)、敵多数周囲
- **影響**: bot.status()/bot.inventory()以外全API使用不可。ゲームプレイ完全停止。
- **接続直後1回目**: 成功率高い。2回目以降は3秒でdisconnect。
- **優先度**: CRITICAL - コードレビュー必須。keepalive packet送信の実装が必要。
- **Status**: Reported. Session 99.

---

## [2026-03-27] Bug: Session 98 - 3秒切断バグ継続、全長時間APIが動作不能

- **Root Cause**: 3秒keepaliveタイムアウトバグが継続。以前のバグ報告(Session 65, 97)と同じ問題。
- **Evidence (Session 98)**:
  - bot.status() (~250ms) = 動作
  - bot.inventory() (~250ms) = 動作
  - bot.moveTo(2ブロック) (595ms) = 実行されるが移動できない
  - bot.moveTo(5ブロック) → "Not connected" at exactly 3026ms
  - bot.pillarUp() → タイムアウト30秒
  - bot.gather() → タイムアウト30秒
  - bot.farm() → タイムアウト60秒
  - bot.combat("chicken") (11秒) = 完了するがドロップ0
  - bot.wait(20秒) = 成功したが後続call時は切断
- **現状**: HP:6.9 Hunger:0 birch_forest Y=75-77 朝(ticks≈3000)
- **影響**: 食料確保、移動、採掘が全て不可。ゲームプレイ完全停止。
- **優先度**: CRITICAL - コードレビュー必須
- **Status**: Reported. Session 98.

---

## [2026-03-27] Bug: Session 65 NEW FINDING - Bot disconnects after exactly ~3 seconds (server keepAlive timeout)

- **Root Cause**: Minecraft server kicks bot after ~3 seconds of no packet activity during long operations.
- **Evidence (exact timings)**:
  - bot.moveTo() → "Not connected" at exactly 3027ms
  - bot.equipArmor() → "Not connected" at exactly 3030ms
  - bot.status() (~200ms) = WORKS, bot.place() (~800ms) = WORKS
- **Fix needed**: Long-running operations (moveTo, combat, navigate, gather) need to send keep-alive/ping packets every 1-2 seconds during execution. Alternatively, reduce pathfinding timeout to <3s.
- **Session state**: HP=6.9 Hunger=0 Y=77 birch_forest, 3s disconnect blocks all food gathering.
- **Status**: Reported. New finding for code reviewer.

---

## [2026-03-27] Bug: Session 97 FINAL - 全APIバグによりゲームプレイ完全停止、2回の昼夜サイクル生存のみ

- **Session Summary**: Session 97 で2回の昼夜サイクルを生存（HP:6.9維持）だが、食料確保ゼロ
- **動作したAPI**: bot.status(), bot.inventory(), bot.place()（部分的）, bot.moveTo()（極短距離のみ、2ブロック以内）
- **失敗したAPI**:
  - combat(): 瞬時完了(200-400ms)でドロップ0 OR 10-25秒後に切断
  - navigate(): 全てタイムアウト(20-60秒)
  - farm(): タイムアウト(90秒)
  - pillarUp(): 26秒でエラー "No blocks placed"（頭上ブロックが天井になっていた可能性）
  - moveTo(長距離): 15-20秒タイムアウト
  - craft(): タイムアウト(素材なしのため？)
  - flee(): 動くが同位置に留まる
  - gather(): 25秒後に切断（gather自体は完了した可能性あり）
- **接続パターン**: connect後1回目のmc_executeは成功することが多い。2回目以降は50%の確率で0-2ms で切断。特にwait()、combat()、navigate()実行中は高確率で切断。
- **生存理由**: Normal難易度でHunger=0でも死なない（HP最小1まで）。HP=6.9で安定。
- **Coordinates**: birch_forest, Y=74-78付近を漂流
- **Status**: CRITICAL - コードレビューによる修正なしではゲームプレイ不可能

## [2026-03-26] Bug: Session 65 SUMMARY - All resource gathering APIs broken (gather/combat/farm)

- **Session state**: HP=6.9 Hunger=0 at (31.6, 74, -5.7). Day time. Chicken nearby but no food obtainable.
- **gather() broken**: gather("iron_ore",8) runs 120s, bot moves ~20 blocks underground, returns 0 raw_iron. gather("coal_ore") runs 60s returns 0 coal. gather("deepslate_iron_ore") times out. ALWAYS 0 items for ores.
- **combat() broken**: combat("chicken") runs 20s, chicken entity still visible after, 0 food drops. Same with cow/pig/sheep. Combat does not kill entities.
- **bot.eat() false success**: eat() logs "Ate food" with Hunger=0 but no food in inventory.
- **Disconnect loop**: After mc_reload+mc_connect, 1st mc_execute succeeds, 2nd fails at 2ms "Not connected". Persistent across sessions.
- **moveTo terrain prison**: moveTo(100,69,0) → arrives at (5,69,0). Only way out is admin teleport.
- **Progression BLOCKED**: Phase 4 (iron pickaxe) impossible with all gathering/combat APIs broken.
- **Status**: Reported. All issues already in earlier bug entries. Code reviewer action needed urgently.

---

## [2026-03-25] Bug: Session 66 end - Disconnect loop confirmed, HP=6.9 Hunger=0 at session end

- **Cause**: Same disconnect loop as Session 70f. mc_connect returns success, first bot.status() works (HP=6.9, Hunger=0, Y=78), all subsequent calls fail immediately with "Not connected".
- **Final State**: HP=6.9, Hunger=0, Y=78, birch_forest area. Will likely die from starvation.
- **Session Summary**: 6+ deaths in Session 66. Root cause cascade: gather() timeouts → no wood → no crafting_table → no farm setup → no food → starvation deaths. flee() caused high-altitude deaths. combat drops never worked.
- **Status**: Reported. Session 66 end.

---

## [2026-03-25] Bug: Session 70f - Bot stuck in disconnect loop: API calls fail 2ms after connect

- **Cause**: After mc_connect() returns "Connected", API calls that involve server interaction (bot.status(), bot.navigate(), bot.gather(), bot.combat(), bot.getMessages()) all fail at 1-2ms with "Not connected". Only bot.log() and bot.wait() work. bot.inventory() works once but then fails.
- **Coordinates**: Y=76, near spawn (0,0), HP=6.9 (probably died from mobs during the loop)
- **Diagnostic**:
  - bot.log("A") → works
  - bot.wait(2000) → works
  - bot.status() → fails at 1ms (every time after first use)
  - bot.gather() → fails at 2ms
  - bot.inventory() → works FIRST time, then fails
  - PATTERN: First mc_execute after connect works ONCE. Second call always fails.
- **Root Cause Hypothesis**: Bot is dying in-game from creeper/mob attacks between mc_execute calls (HP=6.9 with 3+ creepers). When bot dies in Mineflayer, the bot entity leaves the world temporarily. BotManager.requireSingleBot() fails because bot.entity is null during death respawn animation. The bot reconnects to server but the MCP session doesn't know about it.
- **Alternative Hypothesis**: Server is kicking bot for anti-spam (multiple rapid reconnects during a session)
- **Status**: Reported

## [2026-03-25] Bug: Session 70e - Frequent "Not connected" after mc_connect, bot disconnects during flee()/wait()

- **Cause**: After mc_reload + mc_connect succeeds, subsequent mc_execute calls immediately fail with "Not connected" (0-2ms). Pattern: mc_connect → success → mc_execute → "Not connected" at 0ms. Even simple wait(2000) disconnects the bot. flee() with enderman nearby triggers disconnect. bot.build("shelter") fails with "Bot Claude1 not found".
- **Coordinates**: (-10, 76, 0) area
- **Last Actions**: mc_reload → mc_connect → mc_execute{status} → success → mc_execute{flee/wait/place} → fail at 0ms
- **Error Message**: "Not connected to any server" at 0ms after successful mc_connect
- **Pattern**: Seems related to enderman proximity (2 endermen within 7-12 blocks), creeper cluster (3+), or combat state. Status() works once but next call fails.
- **Note**: bot.wait() pre-flee logic ran ("Pre-wait: enderman at 7.3 blocks — auto-fleeing") suggesting bot IS connected but then disconnects during flee operation
- **Status**: Reported

## [2026-03-25] Bug: Session 75 - combat() drops completely broken, causing starvation death loop

- **Cause**: bot.combat() returns success but yields ZERO drops from any entity (cow, pig, chicken, sheep, zombie, skeleton, drowned). Tested 20+ times across session.
- **Evidence**: navigate(cow) confirms cow found, combat(cow) runs, inventory unchanged. rotten_flesh:2 appeared ONCE in inventory at respawn, suggesting drops may occur but are not being picked up.
- **Impact**: No food obtainable through hunting. Bot starved multiple times (Hunger=0 deaths + low HP deaths).
- **Drop pickup hypothesis**: Bot may be killing entities but not picking up drops (pathfinder not moving to collect items, or items despawning).
- **Coordinates**: Various: (12,72,-7), (134,83,94)
- **Status**: Reported - CRITICAL

## [2026-03-27] Bug: Session 97 - 頻繁な自動切断（mc_execute実行中または直後に切断）
- **Cause**: mc_connectで接続成功するが、mc_execute実行中または直後に"Not connected to any server"エラーが繰り返し発生。接続→実行→切断のループ。bot.place()などを呼ぶと7秒以内に切断される。
- **Coordinates**: (27, 76, -7) birch_forest
- **Last Actions**: connect成功→status確認(OK)→place()実行中に切断（2回確認）
- **Error Message**: "Not connected to any server. Use minecraft_connect(host="localhost", port=25565, username="Claude1", agentType="game") first."
- **Frequency**: connect直後の最初のmc_execute(status系)は成功、2回目以降のmc_executeで高確率で切断
- **Status**: CRITICAL - 安定したゲームプレイが不可能

## [2026-03-27] Bug: Session 97 - mc_execute中に突然切断される（Not connected to any server）
- **Cause**: mc_execute実行中にサーバー接続が切断され、"Not connected to any server"エラー。前のAPIコール（place x12個）の実行中に切断。
- **Coordinates**: (27, 75, -6)
- **Last Actions**: bot.place("cobblestone") を複数回ループ実行中に切断
- **Error Message**: "Not connected to any server. Use minecraft_connect(host="localhost", port=25565, username="Claude1", agentType="game") first."
- **Status**: Reported - 再接続後も同じ問題が繰り返す可能性あり

## [2026-03-27] Bug: Session 97 - farm()実行中に"Bot Claude1 not found"エラー・リスポーン疑い
- **Cause**: farm()呼び出し12秒後に "Bot Claude1 not found" エラー。その後再接続すると位置が変わっていた(40,76,-2→37,73,7)。HPは6.9のまま（keepInventory ON）。
- **Coordinates**: farm()前=(40,76,-2), farm()後=(37,73,7)
- **Last Actions**: farm() → 12秒でBotNotFoundエラー → 再接続
- **Error Message**: "Bot Claude1 not found"
- **Status**: 死亡の可能性あり（keepInventoryでアイテム保持）

## [2026-03-27] Bug: Session 97 - 接続が約30秒で自動切断される
- **Cause**: bot.wait(30000)または gather() 実行中に約20-30秒で接続が切れる。mc_connect直後のstatus()は動くが、gather/wait中に "Not connected" エラーになる。再接続後も同じパターンが繰り返す。
- **Coordinates**: (43, 76, 0)
- **Last Actions**: wait(30000)→30秒でdisconnect, gather("birch_log")→20秒でdisconnect
- **Error Message**: "Not connected to any server. Use minecraft_connect..."
- **Status**: CRITICAL - 長時間の処理が全て失敗する

## [2026-03-27] Bug: Session 97 SUMMARY - bot API 総合機能不全レポート（コードレビュー優先対応要）
- **Cause**: Session 95-97で以下の全てのbotAPIが機能不全:
  1. bot.gather() → 全タイムアウト（20-30秒）
  2. bot.combat() → 瞬時完了(200-400ms)・ドロップ0・敵倒せず
  3. bot.farm() → タイムアウト（水源探索で詰まる？）
  4. bot.navigate() → タイムアウト（5秒でも）
  5. bot.flee() → 動作するが実際には同位置に留まる
  6. bot.moveTo() → x か z の単方向2-3ブロックのみ動作（斜め・大距離はタイムアウト）
  7. bot.pillarUp() → 極めて遅い（47秒で1ブロック）
  8. bot.wait() → Enderman auto-fleeでABORT繰り返し
  - 動作するAPI: bot.place(), bot.craft(), bot.status(), bot.inventory()
- **Coordinates**: (28, 74, -6) birch_forest
- **Current State**: HP=6.9, Hunger=0, Enderman 2体が常に6ブロック内。昼間なのにCreeper2/Skeleton3/Zombie2/Drowned2が存在。
- **Priority**: CRITICAL - 全resourceが取得不能、ゲームプレイが完全に詰んでいる
- **Status**: コードレビュー緊急対応要

## [2026-03-27] Bug: Session 97 - flee()が動作しない（同位置に留まる）、Enderman常に6ブロック内で無限auto-flee
- **Cause**: flee(30), flee(50)実行後も同じ座標(25,74,-6)に留まる。flee が実際に移動していない。Endermanが常に6ブロック以内に張り付き、wait()が毎回ABORTED。gather/navigate/moveTo(大距離)も全て機能不全。
- **Coordinates**: (25, 74, -6)
- **Last Actions**: flee(30)→同位置, flee(50)→同位置, wait(30000)→Enderman auto-fleeでABORT×15回
- **Error Message**: flee後も座標変化なし
- **Status**: CRITICAL - flee/wait/gather/navigate全不動作、生存危機

## [2026-03-27] Bug: Session 97 - gather()全タイムアウト、item entity 5個近くにあるが拾えない
- **Cause**: nearbyEntities.item=5個あるが、moveTo短距離移動で近づいてもアイテムが自動回収されない。gather("feather")もタイムアウト。アイテム回収系が完全に機能不全。
- **Coordinates**: x=27, y=75, z=-6
- **Last Actions**: moveTo短距離×5回でitem entity付近を移動 → item数変わらず。gather("feather")→タイムアウト。
- **Error Message**: "Execution timed out after 20000ms"
- **Status**: CRITICAL - 食料/資源の回収が不可能

## [2026-03-27] Bug: Session 96 - combat()のドロップアイテム回収不能
- **Cause**: bot.combat()でchickenとcowを倒したが、インベントリに食料が追加されなかった。アイテムドロップが発生しているがbotが拾えていない模様。
- **Coordinates**: x=47, y=82, z=-3 (birch_forest biome)
- **Last Actions**: combat("chicken") → "完了" but no raw_chicken in inventory. combat("cow") → 同様に食料取得なし。
- **Error Message**: None thrown, combat reports success
- **Status**: Reported - keepInventoryはON、adminも確認済み

## [2026-03-27] Bug: Session 96 - 夜が終わらない（time stuckの可能性）
- **Cause**: 10分以上リアルタイムで夜が継続。hostile mobs (skeleton x4, creeper x3, zombie, drowned)が全時間存在し続けた。
- **Coordinates**: x=26, y=77, z=-5
- **Last Actions**: wait(30000)を複数回呼び出し、エンティティが昼間レベルに減少しなかった
- **Error Message**: None
- **Status**: Reported

## [2026-03-27] Bug: Session 94 SUMMARY - 全移動系API機能不全、place()のみ動作
- **Cause**: bot.moveTo(), bot.navigate(), bot.pillarUp(), bot.gather(), bot.farm(), bot.combat() が全てタイムアウト。place()のみ動作。pathfinderが完全スタック状態。
- **Pattern**: moveTo(x,y,z)が「成功」してもほぼ同じ座標のまま。昼間なのにskeleton/zombie多数→屋根付きエリアにスタックしている可能性。
- **Coordinates**: (25-41, 72-78, -6 to -7) Y=72-78に約2時間スタック
- **Last Actions**: place()で壁・天井作成、pillarUp試み、moveTo試み→全てタイムアウト
- **Effect**: HP6.9/Hunger0で食料取得不能。飢餓ダメージで死亡寸前。
- **Status**: CRITICAL. コードレビュー必須。moveTo/navigate/gather/combat/pillarUpの全面修正が必要。

## [2026-03-27] Bug: Session 95 - moveTo/navigate/farm/pillarUp全てタイムアウト、地上脱出不能
- **Cause**: bot.pillarUp(35)→y=72→73に1ブロックしか上がれず（47秒かかった）。bot.navigate/moveTo→60秒タイムアウト。bot.farm()→120秒タイムアウト。Hunger=0, HP=9.3で飢餓状態。admin指示でpillarUpのみ使用するよう変更。
- **Coordinates**: (32, 73, -5)
- **Last Actions**: pillarUp(35)→失敗(1ブロックのみ), navigate→timeout, moveTo→timeout, farm→timeout
- **Error Message**: タイムアウト多数
- **Status**: CRITICAL - 全移動/採集コマンドが機能不全

## [2026-03-27] Bug: Session 94 NEW - navigate("chicken")が30秒タイムアウト、combat後ドロップ0継続
- **Cause**: bot.navigate("chicken") → 30秒タイムアウト。bot.combat("chicken") → "Cannot reach (16.7 blocks away)"でabort。bot.farm() → 120秒タイムアウト。HP9.3/Hunger0の飢餓状態で食料取得手段が完全に機能しない。
- **Coordinates**: (32, 70, -6)
- **Last Actions**: navigate("chicken")×2→timeout, combat("chicken")→aborted, farm()→timeout
- **Error Message**: "Execution timed out after 30000ms", "Cannot reach chicken (16.7 blocks away)"
- **Status**: CRITICAL. コードレビュー要。navigate/combat/farmの全面修正が必要。

## [2026-03-27] Bug: Session 93-94総括 - CRITICAL: 食料・資源取得が完全機能不全
- **Cause**: 以下の全ての食料/資源取得経路が機能していない:
  1. bot.combat("cow"/"sheep"/"chicken"/"pig") → 全てsilent完了 → 食料ドロップ0
  2. bot.gather("wheat") → silent完了 → 小麦0
  3. bot.gather("iron_ore") → silent完了 → raw_iron0
  4. bot.gather("hay_block") → silent完了 → hay_block0
  5. bot.farm() → 多くの場合タイムアウト or 小麦0で完了
  6. navigate("hay_block")で"発見"→gather("hay_block")→0
  7. moveTo(x,y,z) → 目標外の座標に移動（Y方向特に不正確）
- **Coordinates**: x=45, y=68, z=-7（朝時点）
- **Last Actions**: 上記全て試行済み
- **Error Message**: gather/combat はエラーなし。farm()はタイムアウト。
- **Status**: CRITICAL. 全てのリソース取得が失敗。HP9.3 Hunger0で飢餓死亡ループが継続中。緊急コードレビュー必要。

## [2026-03-27] Bug: Session 93 - 死亡40-41回目 飢餓ダメージ（gather/combat全dropバグ継続）
- **Cause**: gather("iron_ore")がraw_ironを0ドロップ。combat("cow"/"chicken"/"sheep")が肉を0ドロップ。空腹0継続→飢餓→死亡×2回
- **Coordinates**: 死亡1: x=51 y=58 z=25付近、死亡2: y=104付近
- **Last Actions**: gather("iron_ore",5)→raw_iron:0、combat系→food:0、HP0.2で死亡、eat()呼び出し時点でリスポーン後
- **Error Message**: なし（gather/combatともにsilent fail）
- **Status**: Reported. CRITICAL: gather(鉱石)・combat(動物)の両方がドロップ0。flyなどの移動も目標外。コードレビュー緊急。

## [2026-03-27] Bug: Session 94 - 死亡 drowning (navigate "water" 後に水中に落下)
- **Cause**: bot.navigate("water") で水源に近づいた後、bot.wait() 中に水中に落ちて溺死。Hunger=0 + HP=9.3の飢餓状態で抵抗不能。
- **Coordinates**: (51, 58, 25) 付近
- **Last Actions**: navigate("water") → farm() 失敗 → navigate("chicken") → wait(1000) 中に溺死
- **Error Message**: "[wait] ABORTED: oxygen depleting underwater with HP=9.3", "Claude1 drowned"
- **Status**: Reported. navigate("water")が危険な水源近傍に誘導している。farm()がwheat=0収穫で終了する問題も継続。

## [2026-03-27] Bug: Session 93 - 死亡 starvation+mob (Hunger 0 + HP 3.5 + 敵多数)
- **Cause**: Hunger 0 + HP 3.5で食料なし。スケルトン×3、クリーパー×2に囲まれ、pillarUp中に接続切断。リスポーン後HP=9.3に回復。
- **Coordinates**: (-14, 58, 5) 付近
- **Last Actions**: flee → pillarUp → moveTo chest(失敗) → pillarUp中に接続切断(MCP error -32000)
- **Error Message**: "MCP error -32000: Connection closed"
- **Status**: Reported. 食料0状態での生存が不可能。combat/farmの食料取得バグが根本原因。

## [2026-03-27] Bug: Session 92 - 死亡38回目 drowning (moveTo が水中に誘導)
- **Cause**: moveTo(-6, 61, 2)を呼び出したがbot実際にY=106の地上に移動し、水に落ちてdrownした。HP=9.2 + starvation状態で死亡。
- **Coordinates**: Y=106付近 (溺死)
- **Last Actions**: moveTo(-6,61,2) → 実際 Y:106.2に移動 → "Claude1 drowned"
- **Error Message**: "Claude1 drowned"
- **Status**: Reported. moveTo()が目標座標と全く異なる位置に移動し水没死を引き起こす。

## [2026-03-27] Bug: Session 92 - CRITICAL SUMMARY: 全食料取得方法が機能不全（セッション全体）
- **Cause**: 以下の全ての食料取得方法が失敗:
  1. bot.combat("cow"/"pig"/"chicken"/"sheep") → total inventory unchanged (0 drops)
  2. bot.gather("wheat"/"hay_block"/"carrot"/"potato"/"iron_ore") → 0 drops
  3. bot.farm() → 120秒タイムアウト
  4. bot.store("withdraw", "bread") → chest内に食料なし
- **Evidence**: combat("skeleton")はbone/arrowをドロップ → 無生物ドロップは機能する。animals系だけが壊れている。
- **Coordinates**: Y=72 付近 (地表)
- **Last Actions**: cow→0, pig→0, sheep→0, chicken→0 × 5回以上。bone_meal x7, wheat_seeds x70所持だが農場も作れず。
- **Error Message**: なし（全てsilent fail）
- **Status**: CRITICAL. 食料確保が完全に不可能。飢餓→HPゼロ→死亡のループが不可避。コードレビュー緊急必要。

## [2026-03-27] Bug: Session 92 - gather(iron_ore)等の鉱石がドロップを返さない（drop=0バグ）
- **Cause**: gather("iron_ore",1), gather("gold_ore",1), gather("copper_ore",1) を実行してもraw_iron/raw_gold/raw_copperが0のまま。gather("stone",2)はcobblestoneを返す。gather("coal_ore",2)は最初の1回だけcoalを返す。
- **Coordinates**: Y=72 (地表付近)
- **Last Actions**: gather("iron_ore",1)→raw_iron:0 × 5回以上。gather("stone",2)→cobblestone:+2(成功)
- **Error Message**: なし（silent fail）
- **Status**: Reported. CRITICAL: 鉱石のドロップが全て0。Phase4で鉄インゴット入手が不可能。

## [2026-03-27] Bug: Session 92 - craft()が世界に設置済みのcrafting_tableを認識しない
- **Cause**: crafting_table(2)をインベントリに持ちながら bot.place()で世界に設置してcraft()を呼んでも "requires a crafting_table. Place one nearby first" エラーが出る。bot.navigate("crafting_table")は成功するのに craft()だけ認識しない。
- **Coordinates**: (21, 72, 7)
- **Last Actions**: place(crafting_table) → navigate(crafting_table)成功 → craft("iron_pickaxe") → "requires a crafting_table" エラー
- **Error Message**: "Error: iron_pickaxe requires a crafting_table. Place one nearby first"
- **Status**: Reported. craft()がplaced crafting_tableを使えないバグ。

## [2026-03-27] Bug: Session 92 - gather()が全ての鉱石・石材タイプでタイムアウト（完全機能不全）
- **Cause**: gather("iron_ore",3), gather("deepslate_iron_ore",3), gather("cobblestone",3) が全て60秒タイムアウトで失敗。stone_pickaxe所持、目標ブロックの近くに移動済みでも採掘開始されない。
- **Coordinates**: Y=62-64付近 (洞窟内)
- **Last Actions**: navigate(iron_ore) → Y:63発見 → gather("iron_ore",1) → 60s timeout × 5回以上
- **Error Message**: "Execution timed out after 60000ms" (全ての gather() 呼び出し)
- **Status**: Reported. CRITICAL: gather()が完全に機能不全。Phase4鉄採掘が不可能。

## [2026-03-27] Bug: Session 92 - 死亡37回目 Creeperに爆破された (食料確保中)
- **Cause**: 飢餓状態(Hunger=0)でHP3.6まで落ちた後 Creeper に爆破されて死亡。combat()が食料ドロップしないため食料確保不可能状態が続いた。
- **Coordinates**: Y=80付近
- **Last Actions**: 食料確保試行 → HP3.6 → "Claude1 was blown up by Creeper"
- **Error Message**: "Claude1 was blown up by Creeper"
- **Status**: Reported.

## [2026-03-27] Bug: Session 92 - 死亡36回目 Creeperに爆破された（木材採集中）
- **Cause**: navigate(birch_log)でY=114に移動後、gather("birch_log",6)中にCreeper爆発で死亡。タイムアウト(120秒)中に夜になって危険になった。
- **Coordinates**: Y=114付近 (地表)
- **Last Actions**: navigate("birch_log") → Y:114 → gather("birch_log",6) → タイムアウト → "Claude1 was blown up by Creeper"
- **Error Message**: "Execution timed out after 120000ms" + "Claude1 was blown up by Creeper"
- **Status**: Reported. gather()がタイムアウトするため夜間に無防備になりCreeper爆死。

## [2026-03-27] Bug: Session 92 - 死亡35回目 "fell from a high place" gather中にHP0 (鉄採掘ループ)
- **Cause**: bot.gather("iron_ore", 8) ループ中にHP=0になり "fell from a high place" で死亡。HP14→HP0と急減。gather()が高所落下を引き起こしている。
- **Coordinates**: Y=74付近 (地下)
- **Last Actions**: gather("iron_ore",8) → HP:14 → gather("iron_ore",8) → HP:0 → "Claude1 fell from a high place"
- **Error Message**: "Claude1 fell from a high place"
- **Status**: Reported. gather()が鉄採掘中に落下死を引き起こす。地下でgatherすると危険。

## [2026-03-27] Bug: Session 92 - 死亡34回目 Endermanに殺された（地下脱出後）
- **Cause**: 地下(Y=61)でスタックしていたが、gather("stone")実行後にY=115に移動してEndermanに殺された。pillarUp()が0ブロックしか積めず機能不全。HP=1.5のまま地表に出て即殺。
- **Coordinates**: (-5.5, 115, -9.5)
- **Last Actions**: gather("stone",1) → Y:116.9に移動 → "Claude1 was slain by Enderman"
- **Error Message**: "Claude1 was slain by Enderman"
- **Status**: Reported. pillarUp()が全く機能せず、gather()が意図しない遠距離移動を引き起こした。

## [2026-03-27] Bug: Session 92 - pillarUp()が全てのシナリオで0ブロック設置（機能不全）
- **Cause**: cobblestone 167個所持していても pillarUp() が "Failed to pillar up. No blocks placed." エラーを返す。mc_reload後も改善なし。
- **Coordinates**: (-2.3, 61, 9.7) 地下洞窟
- **Last Actions**: pillarUp(15) → エラー → mc_reload → pillarUp(15) → 同エラー × 5回以上
- **Error Message**: "Failed to pillar up. No blocks placed. Check: 1) Have scaffold blocks? 2) Solid ground below? 3) Open space above?"
- **Status**: Reported. 深刻なバグ。地下でpillarUpが完全に使えない。

## [2026-03-27] Bug: Session 91 - 動物狩猟でドロップアイテムが取得できない
- **Cause**: bot.combat("cow"), bot.combat("sheep"), bot.combat("chicken")を実行すると"完了"と表示されるが、食料アイテム（beef/porkchop/chicken）がインベントリに入らない。
- **Coordinates**: x=-23, y=60, z=5 付近 (old_growth_birch_forest)
- **Last Actions**: bot.combat("cow") → 完了 → inventory確認 → 肉なし × 3種類
- **Error Message**: なし（完了扱い）
- **Status**: Reported. combatがドロップを拾えないバグ。食料確保が不可能になる重大なバグ。

## [2026-03-27] Bug: Session 91 - HP3.5 空腹0で逃走不可能（敵に囲まれてスタック）
- **Cause**: スケルトン3体、クリーパー2体に囲まれた状態でflee()を実行しても移動できず、食料もないためHP回復不可能な状態に陥った。
- **Coordinates**: x=-3, y=61, z=10
- **Last Actions**: flee(60)実行 → 位置変わらず → 周辺にskeleton×3, creeper×2
- **Error Message**: なし
- **Status**: Reported. flee()が敵に囲まれた状態で機能しない。

## [2026-03-27] Bug: Session 90 - pillarUp()が上方向でなく下方向に移動するバグ
- **Cause**: pillarUp(20)を呼ぶとY=68→Y=61と下に移動している。本来は上に積み上げるべきだが、下方向に移動している。
- **Coordinates**: (-5, 68, 3) → (-1, 61, 0) (Y方向が逆)
- **Last Actions**: flee() → Y=73地下 → pillarUp(20) → Y=61に下降
- **Error Message**: なし（完了扱い）
- **Status**: Reported. pillarUp()がY+方向でなくY-方向に動いている深刻なバグ。地下でpillarUpするとさらに深みにはまる。

## [2026-03-27] Bug: Session 90 - 死亡32回目 飢餓ダメージ+高所落下（地下でスタック）
- **Cause**: moveTo()が目標と逆方向に動き地下(Y=77)へ潜ってしまい、飢餓Hunger:3でダメージを受け、flee()が高所落下を引き起こした。
- **Coordinates**: (3, 78, -9) 地下洞窟内
- **Last Actions**: moveTo(-1,87,-2)の繰り返し → Y=77の地下へ移動 → Hunger:3→HP:7.2 → flee() → "Claude1 fell from a high place"
- **Error Message**: "Claude1 fell from a high place"
- **Root Cause**: moveTo()が目標座標とは逆方向に移動するバグ。地下に潜ると食料が取れず、飢餓で死亡パターンが再現。
- **Status**: Reported. moveTo()の方向計算バグとflee()の高所落下バグが複合。

## [2026-03-27] Bug: Session 90 - 敵エンティティが長時間追跡し続け、移動系が全てタイムアウト（継続中）
- **Cause**: クリーパー2体・スケルトン1体が朝(ticks 5273)になっても消えず、同じ位置(27,98,0)近辺で追跡を続ける。moveTo/navigate/gather/pillarUp/fleeが全て30-60秒タイムアウト。status()/wait()は正常動作。
- **Coordinates**: (27, 98, 0) - mc_reload後も位置変わらず
- **Last Actions**: mc_reload → pillarUp(5)タイムアウト → navigate("chest")タイムアウト → gather()タイムアウト → 待機しても改善せず
- **Duration**: 90分以上同一地点でスタック
- **Error Message**: "Execution timed out after 30000ms" (全移動系)
- **Status**: Reported. 敵エンティティ近接時のpathfinder計算が無限ループしてスレッドをブロックしている可能性。敵を無視して移動するオプションが必要。

## [2026-03-27] Bug: Session 90 - moveTo/pillarUp/flee が全てタイムアウト（エンティティ周辺でスタック）
- **Cause**: クリーパー3体・スケルトン1体の周囲にいる状態でmoveTo/pillarUp/fleeを実行すると全てタイムアウト。ボットが(26,98,1)に固定されて動けない。
- **Coordinates**: (26, 98, 1)
- **Last Actions**: moveTo(15,98,4) × 2回, moveTo(9,96,4), pillarUp(5), flee(40) → 全てタイムアウト30-60秒
- **Symptoms**: status()は即座に返る。moveTo/pillarUp/fleeは30-60秒後にタイムアウトエラー。位置は変わらない。
- **Error Message**: "Execution timed out after 30000ms"
- **Status**: Reported. 敵エンティティ近接時の移動系タイムアウトバグ。pathfinderが敵を避けようとして経路計算で詰まっている可能性。

## [2026-03-27] Bug: Session 89 - flee()が地下洞窟へ移動（根本的pathfinderバグ）
- **Cause**: bot.flee(100)を実行するとYが下がる。地表に出る代わりに洞窟内を逃走ルートとして使っている。Y=67→flee→Y=60→flee→Y=48のように悪化する。
- **Coordinates**: 付近 (4,60,-5) → (15,48,-9)
- **Last Actions**: flee(100) × 2回 → Y=67→60→48 と下降
- **Symptoms**: flee後にskeletonが増える（地下spawnerからか）。逃げるほど危険になる。
- **Root Cause**: fleeのpathfinderが地表への経路を優先せず、接続された洞窟を逃走ルートにしている。
- **Status**: Reported. 緊急修正が必要。flee()にY_min制約または地表方向優先ロジックが必要。

## [2026-03-27] Bug: Session 89 - 死亡31回目 Zombie攻撃（Y=64洞窟内）
- **Cause**: Y=64の洞窟内でHP:2の状態でゾンビに追い詰められ死亡。flee/moveToが機能せず、食料ゼロで回復不能な状況が継続した。
- **Coordinates**: (-1, 64, 2) 付近
- **Last Actions**: flee → moveTo(3,100,9) → wait → "Claude1 was slain by Zombie"
- **Error Message**: "Claude1 was slain by Zombie"
- **Status**: Reported. 同一エリアでの繰り返し死亡パターン。flee距離が不足している可能性、または同一mobがリスポーン点に沸いている。

## [2026-03-27] Bug: Session 89 - 死亡30回目 Zombie攻撃（シェルター内、夜間）
- **Cause**: bot.build("shelter")でシェルターを建設したが、シェルター内にZombieが侵入してHP2.5まで削られ死亡。シェルターが密閉されていないか、Zombieがシェルター内に沸いた可能性。
- **Coordinates**: (-12, 85, 40) 付近
- **Last Actions**: build("shelter") → wait(30s) → Zombie接近 → HP:20→2.5 → 死亡 → "Claude1 was slain by Zombie"
- **Error Message**: "Claude1 was slain by Zombie"
- **Status**: Reported. シェルターがZombie侵入を防げていない。夜間のシェルターが機能不全。

## [2026-03-27] Bug: Session 89 - gather/farm/pillarUp全ツール連続タイムアウト（Y=83付近）
- **Cause**: gather("iron_ore",2), gather("birch_log",4), farm(), pillarUp(20) 全てが30-120秒でタイムアウト。ツールが実際には何もしないままタイムアウトする。
- **Coordinates**: (-13, 83, 40) 付近
- **Last Actions**: navigate(iron_ore) → gather(iron_ore,8) タイムアウト → gather(iron_ore,2) タイムアウト → gather(birch_log,4) タイムアウト → farm() タイムアウト
- **Symptoms**: gatherが実行開始するが進行せず全てタイムアウト。石ピッケルはあるのに採掘できない。Creeperが常に追跡して中断される可能性あり。
- **Error Message**: "Execution timed out after NNNms"が連続発生
- **Status**: Reported. gather全般的に機能不全の可能性。敵の妨害もある。

## [2026-03-27] Bug: Session 89 - 死亡29回目 Skeleton射撃（地上Y=92、HP低+Hunger:0での戦闘）
- **Cause**: Hunger:0・HP:9.3の状態でzombie戦闘中にSkeleton射撃を受けて死亡。HP低下中に戦闘を試みたのが問題。
- **Coordinates**: (-2, 92, 36) 付近
- **Last Actions**: zombie戦闘試み → "Claude1 was shot by Skeleton" → 死亡
- **Error Message**: "Claude1 was shot by Skeleton"
- **Status**: Reported. HP<10かつHunger<4の状態での戦闘はfleeを優先すべき。

## [2026-03-27] Bug: Session 89 - 死亡28回目 Creeperに爆殺（テレポート直後Y=98）
- **Cause**: adminテレポート後(6,98,-6)でCreeper爆発により即死。HP:20/Hunger:20でも周辺確認なしに行動してCreeper接触。
- **Coordinates**: (6, 98, -6)
- **Last Actions**: adminテレポート → eat() → Creeper爆発 → 死亡
- **Error Message**: "Claude1 was blown up by Creeper"
- **Status**: Reported. keepInventory動作。テレポート後のCreeper接近チェックが必要。

## [2026-03-27] Bug: Session 89 - pathfinderスタック・全ツールタイムアウト（地下洞窟Y=42）
- **Cause**: 地下洞窟Y=42で全ての移動系ツール（moveTo/navigate/flee/combat/gather）がタイムアウトまたは無効。位置が全く変わらない。
- **Coordinates**: (-1, 42, -9)
- **Last Actions**: moveTo(100, 42, -9) → 位置(-2,44,-9)（ほぼ変化なし）、navigate("grass_block")タイムアウト、flee()タイムアウト、combat("zombie")タイムアウト
- **Symptoms**: moveToが実行されてもY座標が変化しない or さらに深くなる。HP:10 Hunger:0で飢餓ダメージ確実。脱出不能。
- **Error Message**: タイムアウト（120秒）が連続発生
- **Status**: Reported. 再接続で位置はリセットされず。pathfinder洞窟スタックバグ継続中。

## [2026-03-27] Bug: Session 88 - 死亡27回目 溺死（Y=53付近、combat後に水に落下）
- **Cause**: combat("skeleton")実行中にHP=3.2から溺死。Y=53の水中に落ちたと思われる
- **Coordinates**: (0.3, 53.9, 3.6)
- **Last Actions**: flee() → HP 20→11.2 (skeleton shots) → eat() → combat("skeleton") → 溺死
- **Error Message**: "[Server] Claude1 drowned"
- **Status**: Reported. admin /kill後のrespawn直後に再死亡。

## [2026-03-27] Bug: Session 88 - 死亡26回目 落下死（Y=72地上移動中）
- **Cause**: moveTo(-1,68,-3)後にY=72付近から落下死
- **Coordinates**: Y=72→Y=96(respawn)
- **Last Actions**: flee() → moveTo(-1,68,-3) → moveTo(-1,74,-3) → 落下死
- **Status**: Reported. keepInventory動作。HP=20/Hunger=20でrespawn。

## [2026-03-27] Bug: Session 88 - 完全pathfinderデッドロック（shelter建設後・Y=63洞窟内）
- **Cause**: bot.build("shelter")が洞窟内(Y=63)でcobblestoneシェルターを建設した後、pathfinderが完全に詰まって一切移動不能になった
- **Coordinates**: (-2.7, 63, -1.3) - 30分以上この場所から動けない
- **Symptoms**: moveTo/navigate/gather全てが実行されるが位置が変わらない。timeout or 即座にreturn
- **Duration**: ~30分以上デッドロック継続
- **HP Status**: HP=0.3（starvation floor）、shelter壁がskeletonを防いで安定
- **Status**: Reported. 緊急: bot.build()が狭い空間でpathfinder破壊するバグ

## [2026-03-27] Bug: Session 88 - 致命的ループ（根本原因・緊急）
- **Cause**: 食料ゼロ + HP=0.3 + 地下Y=60 + 複数hostile + pillarUp=0効果 の組み合わせで脱出不可能ループ
- **Pattern**:
  1. combat()でmeat未ドロップ（バグ） → 食料枯渇
  2. Hunger<18 → HP自然回復なし
  3. starvationでHP=0.3 → pillarUp/flee/moveTo全て失敗 or 別のhostileに遭遇
  4. 死亡 → keepInventoryでrespawn → 食料なし → HP=20/Hunger=20から再スタート
  5. farm()が高所で落下死 → 地下に戻る → 2へ
- **Root Cause**: combat()がmeat_dropを回収しない + pillarUp()が0ブロック配置 + farm()が高所で落下死
- **Session 88 deaths**: 25回以上
- **Status**: CRITICAL. code-reviewerによる緊急修正が必要。優先度: 1) combat()ドロップ回収修正 2) pillarUp()修正 3) farm()落下防止

## [2026-03-27] Bug: Session 88 - 死亡25回目 落下死（bot.farm()実行中・Y=96.5から）
- **Cause**: bot.farm()が高所(Y=96.5)で実行中に移動して落下死。farm()は地形を無視して高所を歩く。
- **Coordinates**: Y=96.5 → Y=60付近で死亡
- **Last Actions**: farm() → "[Server] Claude1 fell from a high place"
- **Pattern**: Session 88で farm() により複数回の落下死が発生。高所でfarm()を実行すると必ず落下する危険なパターン。
- **Status**: Reported. bot.farm()は高所では使用禁止。平地(Y=64前後)でのみ使用すること。

## [2026-03-27] Bug: Session 88 - 死亡24回目 落下死（骨粉ループ中Y=89から）
- **Cause**: place("bone_meal")のループ中に移動して(6,89,8)付近から落下死
- **Coordinates**: (6, 89, 8)
- **Last Actions**: bone_meal apply loop → navigate中に落下 → HP=9 Hunger=0
- **Error Message**: "[Server] Claude1 fell from a high place"
- **Status**: Reported. keepInventoryでアイテム保持。Session 88 死亡24回目。

## [2026-03-27] Bug: Session 88 - 死亡23回目 落下死（navigate中Y=92.5から）
- **Cause**: navigate("crafting_table")実行中に落下死。bot.buildでシェルター建設後に内部ナビゲートで落下
- **Coordinates**: Y=92.5付近（base area）
- **Last Actions**: Phase 1完了確認のためnavigate("crafting_table")実行 → 落下
- **Error Message**: "[Server] Claude1 fell from a high place"
- **Status**: Reported. Phase 1完了後すぐ死亡。keepInventoryでアイテム保持。

## [2026-03-27] Bug: Session 88 - combat()がmeatドロップを回収しない
- **Cause**: combat("cow")成功するが、raw_beefやcooked_beefがインベントリに入らない。eggは回収できる（chickensから）。
- **Coordinates**: (40, 94, 2)
- **Last Actions**: 5回combat("cow")→食料ゼロ。eggだけ増えた
- **Error Message**: なし（combatは成功を返す）
- **Status**: Reported. 食料確保の重大バグ。Phase 2進行が困難。

## [2026-03-27] Bug: Session 88 - 死亡22回目 Zombie撃殺（Hunger=3・Y=64）

- **Cause**: Hunger=3・HP=11で地下Y=64でZombieに殺された。crafting_table+furnace作成直後。
- **Coordinates**: (-39.5, 66, -8.5)
- **Last Actions**: craft(crafting_table) success → place(CT) success → craft(furnace) success → `Claude1 was slain by Zombie`
- **Status**: Reported。furnace=1はkeepInventoryで保存済み。

## [2026-03-27] Bug: Session 88 - 死亡21回目 落下死（HP=1.3・Y=77）

- **Cause**: HP=1.3でgather("wheat")実行中に落下。
- **Coordinates**: (2.7, 77, 12.3)
- **Status**: Reported

## [2026-03-27] Bug: Session 88 - 死亡20回目 Skeleton射殺（HP=7.3・Y=66）

- **Cause**: Spider撃破後にHP=7.3まで減少。地下Y=66でSkeleton射殺。
- **Coordinates**: (-14.7, 66, 8.3)
- **Last Actions**: combat("spider") → gather wheat fail → Skeleton shot
- **Status**: Reported

## [2026-03-27] Bug: Session 88 - 死亡19回目 Skeleton射殺（HP=3・Hunger=0・Y=71）

- **Cause**: HP=3・Hunger=0で地下Y=71。Skeleton射殺。
- **Coordinates**: (-2.3, 71, 7.3)
- **Last Actions**: moveTo blocked by spider → passive wait → Skeleton shot
- **Error Message**: `<[Server]> Claude1 was shot by Skeleton`
- **Status**: Reported. 同じスポーン周辺のmob群が根本原因。

## [2026-03-27] Bug: Session 88 - 死亡18回目 Skeleton射殺（HP=3.7・Hunger=0地下Y=45）

- **Cause**: Hunger=0で地下Y=45に閉じ込め。HP=3.7の状態でSkeletonに射殺。
- **Coordinates**: (10, 45, 6)
- **Last Actions**: moveTo(surface) → creeper blocked → passive wait → Skeleton shot
- **Error Message**: `<[Server]> Claude1 was shot by Skeleton`
- **Root Cause**: combat flee threshold=10により戦闘不可・moveTOが地下ルートを選択・escape不可能
- **Status**: Reported

## [2026-03-27] Bug: Session 88 - 死亡17回目 落下死（Y=87から落下）

- **Cause**: navigate(farmland)後Y=87の高地に移動、gather("wheat")60秒タイムアウト中に落下死。
- **Coordinates**: (-0.5, 87, 1.6)
- **Last Actions**: navigate(farmland) → 60s timeout → `Claude1 hit the ground too hard`
- **Error Message**: `<[Server]> Claude1 hit the ground too hard`
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - 連続死亡パターン（根本原因報告）

- **Cause**: 以下の複合バグにより食料確保が不可能な状態が続き死亡ループが発生:
  1. **pillarUp()**: 45秒タイムアウト後0ブロック配置。地下脱出不可能。
  2. **combat() flee threshold**: HP<10で戦闘放棄。食料動物も食料mobも倒せない。
  3. **moveTo()**: 地下(Y<70)でPath blocked。cave環境での経路探索完全失敗。
  4. **gather()**: underground環境で60-120sタイムアウト。地上の小麦に届かない。
  5. **eat()**: wheat単体は食べられない。bread craft必須だがCT不在で作れない。
  6. **craft()**: CT不在で全てのクラフトが失敗。最初のbirch_log採取もtimeout。
- **Coordinates**: (-39, 63, 1) - スポーンから40ブロック離れた地下
- **Session**: 死亡16回以上（Session 88のみ）
- **Status**: 緊急修正要求。地下脱出機能とcombat flee thresholdが特に重大。
- **Recommended Fix**:
  - pillarUp(): 通常のジャンプ+設置ロジックを見直す（現在0ブロックしか置けない）
  - moveTo(): underground cave navigarionをサポートする、またはY>70に制限してから掘り上がる
  - combat flee threshold: HP=10からHP=5に下げる（今のHP<10で即flee）
  - gather(): underground tunnelを自動的に掘り上がる機能を追加

## [2026-03-26] Bug: Session 88 - 死亡: 落下死16回目（cobblestone staircase作成中、Y=96から落下）

- **Cause**: place()でstaircase作成中、60秒タイムアウト後にY=96から落下死。HP=2で極限状態。
- **Coordinates**: (0, 96, -6)付近
- **Last Actions**: place("cobblestone",...) staircase → 60s timeout → `Claude1 fell from a high place`
- **Error Message**: `<[Server]> Claude1 fell from a high place`
- **Root Cause**: place()の途中でタイムアウト→制御が返った時に高所から落下。高所でのplace()タイムアウトは危険。
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - 死亡: Skeletonに射殺15回目（combat()タイムアウト・HP=5）

- **Cause**: HP=5・Hunger=0で地下Y=63に閉じ込め。combat("skeleton",3)呼び出しが30秒タイムアウト中にSkeletonに射殺された。
- **Coordinates**: (-39.4, 63, -5.4)
- **Last Actions**: flee() x3 → wait loop → combat("skeleton",3) 30s timeout → `Claude1 was shot by Skeleton`
- **Error Message**: `<[Server]> Claude1 was shot by Skeleton`
- **Root Cause**: pillarUp/gather/escapeUndergroundが全てタイムアウト。地下から脱出できない状態でHPが削られた。
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - 死亡: Zombieに殺された10回目（farm()タイムアウト中）

- **Cause**: HP=5でfarm()実行中（120秒タイムアウト）にZombieに殺された。farm()実行中は安全チェックが効かない。
- **Coordinates**: (-2.5, 60, -10.4)
- **Last Actions**: farm() → 120s timeout → `Claude1 was slain by Zombie`
- **Error Message**: `<[Server]> Claude1 was slain by Zombie`
- **Status**: Reported。farm()実行中のHP監視が不十分。

## [2026-03-26] Bug: Session 88 - navigate/gatherが全タイムアウト（pathfinder完全機能不全）

- **Cause**: HP=20/Hunger=20でもnavigate("birch_log")が120秒タイムアウト、gather("birch_log")が60秒タイムアウト。Y=81の高台から木ブロックまでのパス探索が失敗し続ける。
- **Coordinates**: (2.3, 81, -9.4)
- **Last Actions**: gather(birch_log) → 60s timeout, navigate(birch_log) → 120s timeout
- **Error Message**: `Execution timed out after 120000ms`
- **Root Cause**: birch_forestの複雑な地形でpathfinderが正常に動作しない。mc_reload後も改善なし。
- **Status**: Reported。コードレビュー緊急対応要請。

## [2026-03-26] Bug: Session 88 - 落下死14回目（place(wheat_seeds)後に落下）

- **Cause**: farmland付近(5,76,2)にseeds plantingが成功した直後に落下死。30秒タイムアウト中に落下した可能性。
- **Coordinates**: (1, 77, 1)
- **Last Actions**: moveTo(5,76,2) → place(wheat_seeds) → `fell from a high place`
- **Error Message**: `<[Server]> Claude1 fell from a high place`
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - 死亡: drowned 13回目（moveTo中）

- **Cause**: HP=2.7/Hunger=0でmoveTo(0,85,0)中にdrownedに殺された。高台(Y=102)到達後にリスポーン。
- **Coordinates**: (-0.7, 54, 0.5) → (Y=102付近)
- **Last Actions**: moveTo(0,85,0) → drowned → リスポーン HP=20/Hunger=20
- **Error Message**: `<[Server]> Claude1 drowned`
- **Status**: Reported。moveTOが水中経路を選択してdrownedが発生。

## [2026-03-26] Bug: Session 88 - 死亡: Zombie12回目（gather birch_log タイムアウト中）

- **Cause**: HP=20/Hunger=20でgather("birch_log",8)が120秒タイムアウト中にZombieに殺された。gather()実行中の安全チェックが機能していない（繰り返しパターン）。
- **Coordinates**: (-2.5, 104, 5.5)
- **Last Actions**: gather(birch_log) → 120s timeout → Zombie
- **Error Message**: `<[Server]> Claude1 was slain by Zombie`
- **Status**: Reported。gather()タイムアウト中のHP監視が機能しない。

## [2026-03-26] Bug: Session 88 - 死亡: Drownedに殺された11回目

- **Cause**: HP=7.5/Hunger=0でmoveTo(4,82,4)中にDrownedに殺された。低地(Y=58)→高台(Y=112)へ移動中に水域を通過してDrownedと遭遇。
- **Coordinates**: (6.7, 58, 16.7)
- **Last Actions**: moveTo(4,82,4) → Drownedに殺された
- **Error Message**: `<[Server]> Claude1 was slain by Drowned`
- **Status**: Reported。飢餓状態での緊急移動中に水域/Drownedに遭遇するパターンが繰り返されている。

## [2026-03-26] Bug: Session 88 - 死亡: moveTo中に溺死9回目

- **Cause**: birch_log(102,62,-4)へmoveTo中に溺死。moveTo()が水中経路を選択してドラウンド。
- **Coordinates**: (90.5, 39, 2.5) → 溺死地点不明
- **Last Actions**: navigate(birch_log) → moveTo(102,62,-4) → drowned
- **Error Message**: `<[Server]> Claude1 drowned`
- **Root Cause**: moveTo()が水中を経由する経路を選択する。特にY=39-62の低地は水域が多い。
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - farm()/navigate()が全タイムアウト・完全詰み

- **Cause**: farm()が30-120秒タイムアウト。navigate(water/farmland)が30-90秒タイムアウト。gather()はHP=3で自動中断。HP=3・Hunger=3・食料0の完全詰み状態。
- **Coordinates**: (91.5, 37.5, 2.3)
- **Last Actions**: farm() → timeout × 5回, navigate(water) → timeout, gather(birch_log) → ABORTED HP critical
- **Error Message**: `Execution timed out after 120000ms`, `[ABORTED] mc_gather stopped: HP critically low`
- **Impact**: ゲーム進行不可。コードレビュー修正が急務。
- **Status**: Reported

## [2026-03-26] Bug: Session 88 - craft()が全て30秒タイムアウト（石ツール含む）

- **Cause**: craft("stone_hoe")、craft("bread")等が30秒でタイムアウト。mc_reload後も改善なし。crafting_tableをインベントリに持っているのに全てのcraftがハングアップする。
- **Coordinates**: (-3.5, 45, -11.5)
- **Last Actions**: mc_reload → craft("stone_hoe") → timeout × 3回
- **Error Message**: `Execution timed out after 30000ms`
- **Note**: Session開始時にcraft("bread")は成功したが、その後craft系が全て失敗するようになった。
- **Status**: Reported。craft()の実装に問題あり。

## [2026-03-26] Bug: Session 88 - navigate(farmland)/farm()が連続タイムアウト（60秒）

- **Cause**: navigate({target_block:"farmland", max_distance:50})が毎回60秒でタイムアウト。farm()も同様。ボットが農場エリアに到達できない。
- **Coordinates**: (-3.5, 44, -11.5) birch_forest
- **Last Actions**: navigate farmland → timeout → farm() → timeout を3回以上繰り返し
- **Error Message**: `Execution timed out after 60000ms`
- **Status**: Reported。農場管理系コマンドがbirch_forestの複雑な地形で機能しない。

## [2026-03-26] Bug: Session 88 - HP=3・食料0・動物スポーンなし・回復不可能状態

- **Cause**: HP=3、Hunger=15、food=0、動物が500ブロック圏内に存在しない。combat("cow/pig/chicken/sheep")全て空振り（動物なし）。eat()も食料なくて実行不可。自然回復なし（Hunger<18）。
- **Coordinates**: (-3.5, 44, -11.5)
- **Last Actions**: combat animals → 全空振り → navigate farmland → timeout
- **Status**: Reported。birch_forestバイオームで動物スポーンがなく食料確保が不可能。

## [2026-03-26] Bug: Session 88 - 死亡: 溺死2回目（Y=50低地でflee→drowned）

- **Cause**: Y=50の低地でbot.flee(50)を実行 → Y=108の高台に飛ばされた後に溺死したと思われる。または低地のY=50付近に水域があり、flee()が水中に誘導した。
- **Coordinates**: Y=50付近（birch_forest低地）
- **Last Actions**: flee(50) → HP:20 Pos:(10,108,7) 表示 → drowned
- **Error Message**: `<[Server]> Claude1 drowned`
- **Root Cause**: flee()が水場に誘導している。Session 86のdrowned bugと同じパターン。
- **Status**: Reported。flee()の水場回避が修正されていない。

## [2026-03-26] Bug: Session 88 - 死亡: drowned 8回目

- **Cause**: HP=2でcreeper包囲。gather(wheat,10)が81秒かかりHP=14→2に減少。moveToで逃げようとしたがdrowned。水場への誘導が繰り返されている。
- **Coordinates**: x=0, y=54, z=4
- **Last Actions**: gather(wheat)→HP激減→moveTo→drowned
- **Error Message**: `<[Server]> Claude1 drowned`
- **Status**: Reported。gather()実行中にHPが大幅に削られる（敵対モブからの攻撃か？）。安全チェックの改善が急務。

## [2026-03-26] Bug: Session 88 - 死亡: Skeletonに射殺（7回目）

- **Cause**: gather(birch_log,20)タイムアウト（105秒）後にHP=15.2まで削られた状態で、navigate(farmland)実行中にskeletonに射殺された。gather中に移動して敵の射程に入った可能性。
- **Coordinates**: x=-1, y=74, z=6 (birch_forest, farmland付近)
- **Last Actions**: gather(birch_log,20)→HP低下→navigate(farmland)→skeleton slain
- **Error Message**: `<[Server]> Claude1 was shot by Skeleton`
- **Status**: Reported。gather()実行中の安全チェックなし。敵が近い状態でnavigateがblockされない。

## [2026-03-26] Bug: Session 88 - 落下死 (navigate移動中に何度も繰り返す)

- **Cause**: navigate(wheat, 200)実行中にY=107から遠くへ飛ばされた(-38,90,-55)状態でHP=2になった後、wait()のauto-flee中に落下死。navigation中の落下保護が機能していない。
- **Coordinates**: Pos:(-38,90,-55) → 落下死
- **Last Actions**: navigate(wheat,200)タイムアウト → HP=2 → wait()auto-flee → 落下
- **Error Message**: `<[Server]> Claude1 hit the ground too hard`
- **Pattern**: 同セッション内でzombie死亡(x1)、drowned(x2)、落下(x2)と合計5回の死亡。keepInventoryで継続。
- **Status**: Reported。navigate移動中の安全チェックが不十分。flee()が水や崖に誘導するバグ。

## [2026-03-26] Bug: Session 88 - pillarUp常時タイムアウト（60秒）

- **Cause**: pillarUp(5), pillarUp(6)など小さな値でも常にタイムアウト（60秒）する。pillarUp後の位置確認では1-2ブロックしか上がっていない（-16→-16+1）。ブロックを置いてジャンプする処理が詰まっている模様。
- **Coordinates**: x=-1, y=81, z=-16
- **Last Actions**: pillarUp(6)実行 → 60秒タイムアウト → 1ブロック上がっただけ
- **Error Message**: Execution timed out after 60000ms
- **Status**: Reported。moveTo/gather/combat/pillarUp全機能不全でゲームプレイ不能状態。

## [2026-03-26] Bug: Session 88 - 死亡: Zombieに殺された（HP1.7、Hunger0、pillarUp中）

- **Cause**: HP=1.7、Hunger=0の状態でpillarUp中にZombieに殺された。pillarUpがタイムアウト(60秒)で途中停止し、その間に近くのzombieにダメージを受けた。moveTo/combat/gatherが全て機能しない状態で食料確保できず、HP回復不能のまま長時間経過。
- **Coordinates**: x=1, y=75, z=-23 (birch_forest)
- **Last Actions**: pillarUpを実行中にtimeout → zombie slain
- **Error Message**: `<[Server]> Claude1 was slain by Zombie`
- **Root Cause**: 1) pillarUpがタイムアウトして途中で停止→敵への無防備状態 2) combat()が機能せず食料確保不能 3) HP1.7で何もできない状態が続いた
- **Status**: Reported。Session 87-88を通じてmoveTo/combat/gather全機能不全が死亡を招いた。緊急コードレビュー必要。

## [2026-03-26] Bug: Session 88 - moveTo依然無効・動物が300ブロック圏内に存在しない・食料0でHP1.7

- **Cause**: mc_reload後もmoveTo(-200,64,200)などが即時返却で位置変化なし（-15,66,1のまま）。navigate(cow/pig/chicken/sheep, max_distance=300)も全て"No X found"。朝（morning phase）でも動物ゼロ。birch_forestバイオームで動物スポーンが機能していない可能性。
- **Coordinates**: x=-15, y=66, z=1 (birch_forest)
- **Last Actions**: mc_reload → moveTo複数試行（全失敗） → navigate(全動物種, 300ブロック) → 全て失敗 → 食料0、HP1.7で生存限界
- **Error Message**: moveTo: エラーなし（即時返却・位置不変）。navigate: "No cow found within 300 blocks"
- **Root Cause推測**: 1) moveToのpathfinderが経路を計算できない地形 2) birch_forestバイオームでの動物スポーン問題 3) combat()も即時返却で機能していない
- **Status**: Reported。HP:1.7 Hunger:0 で生存危機継続。Session 87のmoveTo問題が未修正のまま持続。

## [2026-03-26] Bug: Session 87 - moveTo/navigate完全無効（位置が変わらない）

- **Cause**: moveTo(200, 65, 0), moveTo(0, 65, 200) など全方向への移動が成功を返すが座標が変化しない（実行時間 ~300ms で即時返却）。navigate("village"), navigate("villager") も同様。bot.flee()は短距離動く（7→36ブロック変化を確認）が、moveTo/navigateは全て無効。mc_reload・再接続後も改善なし。
- **Coordinates**: x=-8, y=60, z=16 (birch_forest) → flee後はx=-1, z=1付近
- **Last Actions**: flee()で一部動作 → moveTo(200,65,0) × 3回試行 → mc_reload → 再接続 → moveTo再試行 → 全て即時返却で位置変化なし
- **Error Message**: エラーなし（~300msで成功を返すが位置変化なし）
- **Root Cause推測**: pathfinderが目標地点を計算した結果「移動不要（already at destination）」と判断しているか、pathfinder自体が無効化されている可能性。
- **Status**: Reported。HP:1.7 Hunger:0 で生存危機。敵（zombie,skeleton,creeper）が30分以上近くに存在し続けている。コードレビュー必須。

## [2026-03-26] Bug: Session 86 - 死亡4: 溺死 (シェルター内でHP1になった後)

- **Cause**: シェルター内でHP9→HP1に削られた後、溺死した。シェルターが水際に建設されてbot.flee()が水中に移動させた可能性、またはシェルター内に水源があった可能性。
- **Coordinates**: Y=48付近 (シェルター x=6, y=48, z=-8)
- **Last Actions**: 長期待機ループ中にHP:9→HP:1→溺死
- **Error Message**: `<[Server]> Claude1 drowned`
- **Status**: Reported。シェルター建設位置の水源チェックが必要。

## [2026-03-26] Bug: Session 86 - 致命バグ: gather()/combat()/craft()が副作用なしで成功を返す

- **Cause**: gather("cobblestone"), gather("iron_ore"), combat("cow"), combat("zombie"), craft("furnace"), craft("stone_hoe") 全てが「成功」を返すが、インベントリに何も追加されない。gather()はdrop取得処理が機能していない。smelt()は例外的に動作（charcoal:2を取得できた）。
- **Coordinates**: x=-6, y=62, z=28 付近 (birch_forest)
- **Confirmed**: smelt("birch_log", 2) → charcoal:2 成功（唯一機能するアクション）
- **Failed**: gather, combat (全動物・mob), craft (stone_hoe, furnace)
- **Impact**: 食料0 + リソース増加なし = 完全停滞。HP2.8 Hunger0で生存限界。
- **Status**: Reported。

## [2026-03-26] Bug: Session 86 - クリティカル総括 (全アクション機能不全)

- **Cause**: 複数のコアバグが同時に発生し、生存が不可能な状態。
  1. **combat()ドロップ取得不可**: cow/pig/chicken/sheep/zombie全て「成功」するが食料がインベントリに追加されない。Session 84から継続。
  2. **gather()タイムアウト**: birch_log, short_grass, oak_leaves 全てで60秒タイムアウト。
  3. **craft()タイムアウト**: craft("furnace") が20-30秒でタイムアウト。
  4. **moveTo()不正確**: moveTo(-6,62,2)がx=2,y=58,z=-14等の全く別の座標に移動。
  5. **wait()中に攻撃でHP低下**: wait()の自動flee処理が引き金でタイムアウト。
  6. **pillarUp失敗**: cobblestone 243個持参中でも「No blocks placed」エラー。
- **State**: HP2.8 Hunger6 食料0 深夜。シェルター内でも生存困難。
- **Impact**: 完全プレイ不能。コードレビューなしに継続不可能。
- **Status**: Reported。緊急コードレビュー要。

## [2026-03-26] Bug: Session 86 - 死亡3: gather()中に落下 (birch_log採取中にY=72→高所落下)

- **Cause**: bot.gather("birch_log", 8)実行中に高所から落下。gather()が崖際や木の上で作業中に落下防止なし。
- **Coordinates**: x=-14, y=72, z=-2 (birch_forest)
- **Last Actions**: gather("birch_log", 8) タイムアウト60秒後に落下死
- **Error Message**: `<[Server]> Claude1 fell from a high place`
- **HP at death**: 4.3 (HP4.3の状態で採取中に落下→即死)
- **Status**: Reported。gather()に落下防止ロジックが必要。Y変化が大きい場合にcancelすべき。

## [2026-03-26] Bug: Session 86 - 死亡: 落下死 (HP1.2→リスポーン後も瀕死フェーズで落下)

- **Cause**: HP1.2、Hunger1の瀕死状態でリスポーン。リスポーン後「hit the ground too hard」で落下死。Y=75の高地にスポーン後に落下したと推測。
- **Coordinates**: x=-2, y=75, z=3 (birch_forest付近)
- **Last Actions**: combat("cow"), eat() 後に死亡メッセージ
- **Error Message**: `<[Server]> Claude1 hit the ground too hard`
- **Root Cause**: moveTo()が逆方向に移動するバグにより、HP1.2+Hunger1の状態でチェストに到達できず飢餓死→落下死のコンボ。
- **Status**: Reported。keepInventoryでアイテムは保持されていることを確認済み。

## [2026-03-26] Bug: Session 86 - combat()でドロップが取得できない (継続バグ)

- **Cause**: bot.combat("cow"), combat("pig"), combat("chicken"), combat("sheep"), combat("zombie") 全て成功するが、ドロップアイテムがインベントリに追加されない。
- **Coordinates**: x=3, y=70, z=-2 付近
- **Last Actions**: combat("chicken"), combat("pig"), combat("cow"), combat("sheep") → 全完了 → inventory確認 → 食料0個
- **Error Message**: なし（エラーなしで成功するが結果が空）
- **Impact**: 食料が全く確保できない。飢餓→瀕死のループが発生。
- **Status**: Reported。bot.combat()のアイテムピックアップロジックに問題あり。

## [2026-03-26] Bug: Session 86 - 瀕死サバイバル不能 (HP3.2 食料0 creeper×7 戦闘・待機・シェルター全失敗)

- **Cause**: HP3.2、食料0、creeper×7に囲まれた状態でHP回復手段が全くない。wait()中も攻撃されHP5.2→3.2に低下。bot.combat("zombie")が60秒タイムアウト。bot.build("shelter")が60秒タイムアウト。pillarUpが「No blocks placed」エラー（cobblestone 246個持参中）。食料なしHunger12ではHP自然回復しない（Hunger18以上必要）。
- **Coordinates**: x=-6, y=64, z=9 (birch_forest)
- **Last Actions**: flee → wait(30s) → combat("zombie") timeout → build("shelter") timeout
- **Error Message**: pillarUp: "Failed to pillar up. No blocks placed." / combat: timeout 60000ms / build shelter: timeout 60000ms
- **Critical Issue**: Hunger14でHP回復しないのにwait()が敵に攻撃されてHP低下。食料入手手段が全て機能しない状態で生存不可能。
- **Status**: Reported。緊急コードレビュー必要。

## [2026-03-26] Bug: Session 85 - 完全地形スタック (moveTo/flee/pillarUp全て機能しない)

- **Cause**: botがX=0, Y=58, Z=9に完全固定。moveTo/flee/pillarUp全てタイムアウトまたは座標変化なし。mc_reloadでも解消せず。
- **Coordinates**: x=0, y=58, z=9 (birch_forest / 拠点付近)
- **State**: HP:7.2, creeper×4, skeleton×2, zombie, enderman に囲まれた状態でスタック
- **All failed**: moveTo(×20回), flee(×3), pillarUp(タイムアウト)
- **Impact**: 完全プレイ不能。敵に攻撃され続けて死亡するか永久スタック。
- **Status**: Reported。緊急コードレビュー必要。pathfinderのスタック解消ロジックが必要。または移動に失敗し続けた場合の強制テレポート/ジャンプ等のフォールバック。

## [2026-03-26] Bug: Session 85 - moveTo()が完全に機能しない (pathfinder詰まり)

- **Cause**: moveTo()を10回以上呼び出しても座標が全く変化しない。bot の位置がX=-1, Z=8に固定されている。
- **Coordinates**: x=-1, y=63, z=8 (birch_forest)
- **Last Actions**: moveTo(x+10)×10回 → 全て失敗(座標変化なし) → moveTo(z+10)×10回 → 全て失敗
- **Impact**: 逃走不能。HP7.2で敵多数（creeper3, skeleton2, zombie, enderman）に囲まれたまま動けない
- **Suspected Cause**: pathfinderが拠点構造物の地形で詰まっている。掘った穴や設置したブロックで経路が閉塞している可能性。
- **Status**: Reported。緊急修正必要。mc_reloadで解消するか要確認。

## [2026-03-26] Bug: Session 85 - 死亡8: 高所落下 (combat中にY=76から)

- **Cause**: combat("cow")実行中にY=76から崖に落下して死亡
- **Coordinates**: x=47, y=76, z=-92
- **Last Actions**: combat("cow") → HP6 → gather("iron_ore") → "Claude1 fell from a high place"
- **Status**: Reported。combatのnavigateも崖落下防止なし。

## [2026-03-26] Bug: Session 85 - 死亡7: 溺死再発 (Y=57付近の水域)

- **Cause**: navigate("birch_log")実行後、Y=57付近の水中に入り溺死。HP3の状態だったため短時間で死亡。
- **Coordinates**: x=35, y=57, z=40
- **Last Actions**: gather("birch_log")失敗(木材ゼロ) → HP3まで低下 → drowned判定
- **Status**: Reported

## [2026-03-26] Bug: Session 85 - 自然HP回復が機能しない

- **Cause**: HP=5、Hunger=14-16の状態で敵がいない場所に60秒以上いるが、HPが全く回復しない。
- **Coordinates**: x=39, y=63, z=38 (birch_forest)
- **Last Actions**: flee(100) → 敵ゼロの安全地帯 → wait(30000) → HP変化なし
- **Expected**: Hunger > 9.5 (=19/2食料ポイント以上) で自然回復開始するはず
- **Actual**: Hunger14-16でも自然回復ゼロ。bot.eat()後もHP変化なし。
- **Impact**: HP5のまま回復手段がなく、次の攻撃で死亡する可能性が高い
- **Status**: Reported。自然HP回復のロジックまたはbotのhealthUpdateの追跡に問題がある可能性。

## [2026-03-26] Bug: Session 85 - 死亡6: 溺死 (水中でdrowned×2に攻撃されながら脱出不能)

- **Cause**: Y=53付近の水中でdrowned×2に攻撃されながらmoveTo/pillarUpが全て失敗。水中から脱出できずHP2→0で溺死。
- **Coordinates**: x=0, y=53, z=3
- **Last Actions**: pillarUp(25)実行後なぜかY=56→53の水中に戻った → moveTo(y+10)失敗×4 → drownedに攻撃される → "Claude1 drowned"
- **Error Message**: Server: Claude1 drowned
- **Context**: リスポーン後Y=89の場所でpillarUpしたが、水中のY=53に移動してしまった。pillarUpが水中では機能しない。moveTo()も水中では動作しない。
- **Root Cause**: pillarUp()が水中にいる場合の対処なし。水中検出・脱出ロジックが必要。
- **Status**: Reported。水中脱出ロジックが必要。wait()のoxygen depleting検出はあるが脱出できていない。

## [2026-03-26] Bug: Session 85 - 死亡5: Skeleton射殺 (夜間pillarUp中)

- **Cause**: 夜間にpillarUp中、skeleton×2に囲まれ矢で射殺。pillarUp後もY=66にとどまり敵射程内だった
- **Coordinates**: Y=66-79付近
- **Last Actions**: pillarUp(6) → HP:20→4 (pillarUp中に被弾) → auto-flee → skeleton attack → death
- **Error Message**: Server: Claude1 was shot by Skeleton
- **Context**: 夜間に敵が大量発生（skeleton2, zombie3, creeper3, spider, enderman, zombie_villager）する場所でpillarUpしたが、skeletonは射程が長く高所でも狙われた。
- **Root Cause**: pillarUp の高さが不十分 (6ブロック)。skeletonの射程は約16ブロック。少なくとも20ブロック以上登る必要がある。
- **Status**: Reported。pillarUp後も狙われる場合の回避策が必要。

## [2026-03-26] Bug: Session 85 - 死亡4: gather()中に高所落下 (Y=119から)

- **Cause**: bot.gather("birch_log", 16) 実行中にY=119の高所から落下して死亡
- **Coordinates**: Y=119付近 (birch_forest 山の上)
- **Last Actions**: gather("birch_log", 16) → タイムアウト(120秒) → "Claude1 fell from a high place"
- **Error Message**: Server: Claude1 fell from a high place
- **Context**: リスポーン後Y=119の高い場所にいた状態でgatherを実行。navigate中に崖から落下した可能性。gather()の経路生成も崖落下防止が必要。
- **Status**: Reported。**gather()/navigate()の経路生成に崖落下防止ロジックが必要。flee()と同様の問題。**

## [2026-03-26] Bug: Session 85 - 死亡3: 高所落下 (flee()後にY=55に落ちた)

- **Cause**: flee(50)実行後、bot がY=55付近の崖下に落下して死亡
- **Coordinates**: x=-39, y=55, z=-18 (birch_forest)
- **Last Actions**: flee(50) → 逃走先がY=63→Y=55へ急落下 → "Claude1 fell from a high place"
- **Error Message**: Server: Claude1 fell from a high place
- **Context**: flee()が崖の端や高低差を考慮せずに経路生成している可能性。HP4.2で既にHP低下中だったため落下ダメージで死亡。
- **Status**: Reported。**flee()の経路生成に崖落下防止ロジックが必要**

## [2026-03-26] Bug: Session 85 - 死亡: Zombie に殺された (HP回復中に)

- **Cause**: HP1.3から4.7に回復途中にZombieに殺された。flee()で逃走したが、逃走先にcreeper×3/endermanがいた。逃走先の安全確認が不十分。
- **Coordinates**: x=2, y=74, z=0 (birch_forest 高台)
- **Last Actions**: flee(50) → Pos(2, 74, 0)付近で敵に遭遇 → "Claude1 was slain by Zombie"
- **Error Message**: Server: Claude1 was slain by Zombie
- **Context**: アイテムピックアップバグで食料ゼロ。HP1.3で長時間過ごした後、flee先に敵が密集していた。
- **Status**: Reported

## [2026-03-26] Bug: Session 85 - アイテムピックアップ不能が継続。HP1.3で生存限界

- **Cause**: combat()/gather()/farm() が「成功」を返すがインベントリにアイテムが追加されない。Session 84から継続している未修正バグ。
- **Coordinates**: x=-5, y=62, z=2 (birch_forest)
- **Last Actions**:
  - bot.combat("cow") → 牛を倒したが beef/cooked_beefがインベントリに入らない
  - bot.combat("chicken") × 3回 → 全て食料ゼロ
  - bot.combat("zombie") × 2回 → 腐肉ゼロ
  - bot.farm() → wheat/seeds ゼロ
  - チェスト(x=-6, y=61, z=2) → 空
- **State**: HP:1.3, Hunger:0。食料確保手段が全滅。HP回復不可能。
- **Impact**: このバグが修正されない限り、食料確保・HP回復・進行が全て不可能
- **Status**: Reported。**緊急修正必要。combat/gather後のアイテムピックアップ処理を修正せよ。**

## [2026-03-26] Bug: Session 84 - クリティカル：全アイテム獲得手段が機能せずプレイ不可能

- **Cause**: gather/combat/farm/smelt 全てが「成功」と返すがインベントリにアイテムが入らない。食料確保不可能。
- **Coordinates**: x=-2, y=62, z=9 (birch_forest)
- **Affected APIs**:
  - `bot.gather("birch_log", 4)` → 成功メッセージだがインベントリ変化なし
  - `bot.combat("cow/sheep/pig/chicken")` × 4回 → 成功だが raw_meat 入手なし
  - `bot.farm()` → wheat:0, seeds:0（農場Y=79付近で発見済み）
  - `bot.smelt("raw_iron", 3)` → 成功だがiron_ingot=0
- **Root Cause推定**: アイテム収集後の pickup処理の欠如。または gather()がタイムアウト後に部分実行になっている。
- **Impact**: 食料0 → 飢餓 → HP回復不可 → HP:1.3, Hunger:2の危機的状態
- **Status**: Reported。緊急修正必要。このセッション中のプレイ継続は困難。

## [2026-03-26] Bug: Session 83 - 継続バグ総括（未解決・code-reviewer対応要請）

### 未解決バグ（優先度高）
1. **combat()ドロップ未取得**: 全動物・敵のcombatでインベントリに追加されない
2. **pillarUp() "No blocks placed"**: cobblestone200個超あるのに失敗
3. **gather() タイムアウト**: short_grass等の地上採掘が頻繁にタイムアウト
4. **moveTo() 遠距離失敗**: 遠距離は座標変化なし
5. **smelt() raw_iron未認識**: インベントリにあるのにslot 3-39で見つからない
6. **tunnel("down") Y=40スタック**: Y=40付近で詰まり、Y=-59到達不能

### Session 83 統計: 死亡4回、ダイヤ0個、食料確保0個

## [2026-03-26] Bug: Session 84 - Y=52の洞窟内で溺死（5回目の死亡）

- **Cause**: Y=40の洞窟から地上脱出のためにcobblestone pillarを試みていたところ、Y=52付近で溺死。洞窟内の水域に入った可能性。
- **Coordinates**: Y=52付近（x=27, z=21付近）
- **Last Actions**: bot.place("cobblestone") × 50回ループ（地上脱出試み） → drowned
- **Error Message**: "Claude1 drowned"
- **Root Cause**: 洞窟内でpillarUpしていた際に水中に移動してしまった。place()が水中ブロックを探して移動させた可能性。また、wait()のたびにエンダーマン自動fleeが発動して上昇を妨害されていた。
- **Contributing bugs**: (1) gather("stone")がタイムアウト、(2) pillarUp()が足場なしで失敗、(3) wait()のfleeがpillarを妨害、(4) place()のループが水中に誘導
- **Status**: Reported。リスポーン後にゲームプレイ再開。

## [2026-03-26] Bug: Session 84 - bot.combat()でドロップが収集されないバグ

- **Cause**: bot.combat("cow"), bot.combat("sheep"), bot.combat("pig"), bot.combat("chicken") を4回実行。全て「成功」と返るが、インベントリにraw_meatが一切入らない。
- **Coordinates**: x=20, y=94, z=19付近（birch_forest）
- **Last Actions**: combat("cow") → combat("sheep") → combat("pig") → combat("chicken") → 全て入手なし
- **Error Message**: なし（エラーは出ないが結果が空）
- **Root Cause**: combat()が動物を攻撃するが、ドロップアイテムを収集できていない可能性。または動物を実際には倒せていない可能性。
- **Status**: Reported。ゲームプレイに戻る。farm()で食料確保に切り替え。

## [2026-03-26] Bug: Session 84 - bot.smelt()後にiron_ingotがインベントリに入らないバグ

- **Cause**: bot.smelt("raw_iron", 3)が成功メッセージを返したが、その後のinventory()でiron_ingotが0個だった。後でcobblestone整理後に1個だけ出現（精錬前からあった可能性）。
- **Coordinates**: x=20, y=94, z=19付近
- **Last Actions**: navigate("furnace") → smelt("raw_iron", 3) → inventory()でiron_ingot=0
- **Error Message**: なし
- **Root Cause**: smelt()がかまどからアイテムを取り出せていない可能性。furnaceのGUI操作の問題。
- **Status**: Reported。

## [2026-03-26] Bug: Session 83 - シェルター内で落下死（4回目の死亡）

- **Cause**: HP=7でシェルター内に待機中、HP=0になって死亡。「fell from a high place」のメッセージ。直前の行動はgather("short_grass")とgather("oak_leaves")でHP変化なしだった。理由不明。
- **Coordinates**: x=-5, y=62, z=3（死亡地点）
- **Last Actions**: gather("short_grass") → gather("oak_leaves") → HP=0 → 落下死
- **Error Message**: "Claude1 fell from a high place"
- **Root Cause**: シェルター内でHPが突然0に。考えられる原因: (1) シェルター内に落下ダメージを受ける穴がある、(2) gather()が危険な場所に移動させた、(3) mob攻撃
- **Status**: Reported。4回目リスポーン。HP=20、Hunger=20、朝、Y=107。

## [2026-03-26] Bug: Session 83 - 矢で弱ってからの落下死（3回目の死亡）

- **Cause**: tunnel("down")ループ中にスケルトンの矢を受けてHP=4.8まで低下。その後「doomed to fall by Arrow」で落下死。
- **Coordinates**: x=-3, y=67, z=6（死亡推定地）
- **Last Actions**: tunnel("down") × 17回実行中 → HP=4.8 → 落下死
- **Error Message**: "Claude1 was doomed to fall by Arrow" + "Claude1 fell from a high place"
- **Root Cause**: tunnel()実行中にHP監視が不十分。HP<8になっても採掘を止めなかった（設定HP<8で停止するはずが機能しなかった）。
- **Status**: Reported。3回目リスポーン。HP=7、Hunger=17、夜間。
- **追加情報**: tunnel()中にY=1まで降りたがその後Y=104にテレポートしたような動きがある（Y=104→再度降下中に死亡）。tunnel()の挙動が不安定。

## [2026-03-26] Bug: Session 83 - スケルトンに射殺（2回目の死亡）

- **Cause**: 食料探索中にHPが3.5まで低下。moveTo()で複数地点を探索中にスケルトンの矢を受け続けた。flee()中にHP=0になりリスポーン。
- **Coordinates**: x=-43, y=48, z=-17（死亡地点）
- **Last Actions**: 動物探索でmoveTo(0,65,-200)実行中 → スケルトン接近 → HP 3.5 → flee中に死亡
- **Error Message**: "Claude1 was shot by Skeleton"
- **Root Cause**: 探索中のHP監視不足。moveTo実行中にスケルトンに追われてHP激減。flee時にはHP=0直前まで落ちていた。
- **Status**: Reported。2回目リスポーン。HP=20、Hunger=20。
- **教訓**: moveTo探索中にも敵チェックが必要。HP<8になったら即探索中断してflee。

## [2026-03-26] Bug: Session 83 - 落下死亡（高所スタックから脱出不能）

- **Cause**: Y=109高所スタックからdig+water方法で徐々に降下。Y=97で再びスタック。その後「fell from a high place」で死亡。keepInventoryでアイテム保持。リスポーン後HP=20、Hunger=20に回復。
- **Coordinates**: x=-64, y=97, z=5（死亡地点付近）
- **Last Actions**: dig+水流で降下試行 → Y=97でスタック → 落下死亡
- **Error Message**: "Claude1 fell from a high place"
- **Status**: Reported。リスポーン後にゲームプレイ再開。

## [2026-03-26] Bug: Session 83 - 全移動手段失敗 + combat()ドロップ取得不可（CRITICAL）

- **Cause**: mc_reload後も以下の全操作が機能しない：
  1. `moveTo(x,y,z)` - 成功を返すが座標変化なし（全方向試験済み）
  2. `setControlState('forward', true)` - 10秒間前進させても座標変化なし
  3. `combat('cow'/'pig'/'chicken'/'sheep'/'zombie')` - ドロップが一切インベントリに入らない
  4. `navigate()` - 近傍のみ機能（遠距離不可）
- **Coordinates**: x=-66, y=97, z=5 （固定）
- **Last Actions**: reconnect × 3回、mc_reload × 2回でも改善なし
- **Status**: CRITICAL。Hunger=0、食料0、移動不能。HP=7。
- **必要な修正**: moveTo/pathfinder/setControlState/combatドロップ取得の全面的な修正が必要。

## [2026-03-26] Bug: Session 83 - combat()後に肉ドロップが取得できない + 地形スタック継続

- **Cause**: mc_reload後もcombat("cow"/"pig"/"chicken"/"sheep")を実行すると「成功」を返すが、インベントリに肉が追加されない。navigate()で動物に近づいてcombat()しても同様。
- **Coordinates**: x=-72, y=109, z=4
- **Last Actions**: mc_reload → navigate("cow") → combat("cow") × 5回 → インベントリ変化なし。navigate("chicken") × 3回も同様。
- **Error Message**: エラーなし（成功と表示されるが肉がインベントリに入らない）
- **Status**: Reported。Hunger=0、食料0の緊急状態。地形スタックも継続中。
- **Additional**: moveTo()/navigate()が同じ座標(-72,109,4)に戻り続ける。flee()でわずかに動くが戻る。pillarUp後に高地スタックの状態が継続している。

## [2026-03-26] Bug: 地形スタック - Y=109山頂から移動不能（Session 81-82）

- **Cause**: Y=109のold_growth_birch_forest山頂に閉じ込められ、全移動手段が失敗。
- **Coordinates**: x=-71, y=109, z=3 (変動なし)
- **Last Actions詳細**:
  - moveTo(全方向、複数距離100-150ブロック) → 座標変わらず（成功返すが移動なし）
  - pillarUp(8) → "No blocks placed"（cobblestone 138個あるのに失敗）
  - navigate(cow/pig/chicken/sheep) → 「成功」返すが肉ドロップなし
  - bot.place("cobblestone", ...) → 設置は成功するがそのブロックに移動できない
  - bot.flee(50) → 3ブロック程度しか移動しない
  - navigate(grass_block, oak_log) → 成功返すが現在地に戻る
  - bot.gather("birch_log") → タイムアウト（60秒）
  - bot.build("shelter") → タイムアウト（60秒）
- **Error Message**: moveTo成功を返すが座標変わらず。pillarUp: "Failed to pillar up. No blocks placed."
- **Session**: Session 82 (2026-03-26)
- **Root Cause**: Pathfinderが山頂（Y=109断崖）から降りるルートを完全に見つけられない。bot.place()でブロック設置は可能だが、moveToでその位置に移動できない。pathfinderの問題かbot位置認識の問題か不明。
- **Status**: 完全スタック継続。HP=10 Hunger=0。combat dropバグも継続。code-reviewer緊急対応要請。
- **必要な修正**: moveToが実際に移動するかチェック、pathfinderがY軸降下経路を見つけられるよう改善、またはスタック検出して再接続等の回復手段を実装。

## [2026-03-26] Bug: Session 81 - Death: gather()中にzombieに殺される

- **Cause**: bot.gather("iron_ore")実行中、zombie接近に気づかず死亡。HP1.7まで落ちてからfleeしたが間に合わず。
- **Coordinates**: x=-11, y=90, z=-17
- **Last Actions**: navigate iron_ore → gather iron_ore → HP急落 → flee間に合わず死亡
- **Error Message**: "Claude1 was slain by Zombie"
- **Session**: Session 81 (2026-03-26)
- **Root Cause**: gather()中に敵モニタリングとhp安全チェックが機能していない。HP<5でも採掘を続ける。
- **Status**: Reported

## [2026-03-26] Bug: moveTo()が完全に機能しない（bot完全停止）

- **Cause**: bot.moveTo()がどの座標を指定しても現在地のまま。全方向（X±50/100, Z±50/100, Y±35）で失敗。bot自体が動けない状態。
- **Coordinates**: x=20, y=55, z=-14（動けない）
- **Last Actions**: mc_reload後にmoveTo()を複数方向に試みるが全て失敗。navigateも失敗。pillarUpも失敗。
- **Error Message**: エラーなし（成功を返すが位置が変わらない）
- **Session**: Session 81 (2026-03-26)
- **Status**: Reported。bot完全停止状態。

## [2026-03-26] Bug: craft()がインベントリに反映されない

- **Cause**: bot.craft("iron_sword")・bot.craft("iron_pickaxe")・bot.craft("crafting_table")が「成功」を返すがインベントリに変化なし。iron_ingotもstickも消費されない。
- **Coordinates**: x=17, y=56, z=-11
- **Last Actions**: mc_reload後にbot.craft("crafting_table")→bot.craft("iron_sword")→bot.craft("iron_pickaxe")を実行
- **Error Message**: エラーなし（成功と表示されるが反映されない）
- **Session**: Session 81 (2026-03-26)
- **Status**: Reported

## [2026-03-26] Bug: Session 80 - Death: flee()で水中に移動して溺死（3回目）

- **Cause**: ゾンビ2体+スパイダーから逃走中、bot.flee()が水中に移動させ溺死。"Claude1 drowned"
- **Coordinates**: x=-21, y=115, z=13（flee後の位置）
- **Last Actions**: 周囲に敵 → flee(30) → y=115, x=-21に移動 → 溺死
- **Error Message**: "Claude1 drowned"
- **Root Cause**: flee()が安全な陸地ではなく水中に移動させる。flee()は逃走先の安全性（水・溶岩・落下）を確認していない
- **Status**: Reported 2026-03-26 Session 80。3回目の死亡（flee→水死）。

## [2026-03-26] Bug: Session 80 - Death: bot.farm()タイムアウト中にゾンビに殺される（2回目）

- **Cause**: bot.farm()を実行中（180秒タイムアウト）に、実行がハングし敵対的エンティティへの防御ができずゾンビに殺された。farm()が敵接近を検知して中断する機能がない。
- **Coordinates**: y=112付近（またも高所でリスポーン）
- **Last Actions**: navigate → farm()開始 → 180秒タイムアウト → "Claude1 was slain by Zombie"
- **Error Message**: "Execution timed out after 180000ms"
- **Root Cause**: bot.farm()が長時間ブロッキング実行されている間、HP/安全チェックが行われない
- **Status**: Reported 2026-03-26 Session 80。2回目のゾンビ死亡。

## [2026-03-26] Bug: Session 80 - combat()でアイテムドロップが取得できない

- **Cause**: bot.navigate(animal) → bot.combat(animal) を実行しても、動物のドロップアイテム（raw_beef, raw_chicken等）が一切インベントリに追加されない。複数の動物種（chicken, pig, sheep, cow）で試したが全て同様。
- **Coordinates**: x=1, y=82, z=-5 付近
- **Last Actions**: navigate("chicken") → combat("chicken", 18) → wait(5000) → インベントリ確認 → 変化なし
- **Error Message**: なし（エラーは出ないが効果もない）
- **Evidence**: invBefore.length == invAfter.length == 24 (全て同じアイテム)
- **Status**: Reported 2026-03-26 Session 80。食料確保の大きな障害。

## [2026-03-26] Bug: Session 80 - Death: place()で足場を作って上昇中に溺死（4回目）

- **Cause**: place("cobblestone")で足場を作ってY=58から上昇中、Y=89に到達した時に溺死。「Claude1 drowned」。cobblestoneを置く過程で水の中に入った可能性。
- **Coordinates**: x=51, y=58-89, z=29
- **Last Actions**: place("cobblestone", x, y+1, z) × 5回 → y=89に移動 → drowned
- **Error Message**: "Claude1 drowned"
- **Root Cause**: place()で足場を作る際に水が存在する位置を経由している。地下の水域付近でplace()が安全でない
- **Status**: Reported 2026-03-26 Session 80。4回目の死亡。

## [2026-03-26] Bug: Session 80 - 洞窟スタック（5回目）: X/Z方向に全く移動できない

- **Cause**: x=-9付近、y=54-59、z=-9付近に完全にスタック。moveTo(x,y,z)でX/Z方向の移動が全く効かない。Y方向のみ少し変化する。navigate()も同じ場所に留まる。飢餓状態でチェスト(x=-6,y=61,z=2)まで12ブロック先にあるが到達できない。
- **Coordinates**: x=-9, y=54-59, z=-9
- **Last Actions**: moveTo(様々な座標) → x=-9,y=変化,z=-9に留まる × 10回以上
- **Error Message**: なし（エラーなしで移動失敗）
- **Status**: Reported 2026-03-26 Session 80。前回Session 79と同じ洞窟スタックバグ。飢餓死不可避。

## [2026-03-26] Bug: Session 80 - craft()全般がcrafting_table前でも失敗（鉄ピッケル・鉄剣）

- **Cause**: iron_ingot×4、stick×7、crafting_table直前にいるにもかかわらずcraft("iron_pickaxe")とcraft("iron_sword")が失敗する。素材は充分にある。
- **Coordinates**: x=-8, y=59, z=-9
- **Last Actions**: navigate("crafting_table") → (到達) → craft("iron_pickaxe") → 失敗 → craft("iron_sword") → 失敗
- **Error Message**: なし
- **Root Cause**: crafting_tableとの接触判定か、設置されたcrafting_tableの使用に問題がある可能性
- **Status**: Reported 2026-03-26 Session 80。furnace、iron_pickaxe、iron_sword全て同じバグで失敗。

## [2026-03-26] Bug: Session 80 - craft("furnace")がcrafting_tableの直前でも失敗

- **Cause**: crafting_tableを設置しその直前(0ブロック距離)にいても、bot.craft("furnace")が失敗する。インベントリにcobblestone124個あり。autoGather=trueでも同様に失敗。
- **Coordinates**: x=-8, y=46, z=4
- **Last Actions**: navigate("crafting_table") → (到着) → craft("furnace") → "失敗"
- **Error Message**: なし（エラーなしで失敗）
- **Root Cause**: craft()がcrafting_tableの検知に失敗しているか、furnaceのレシピ解決に問題がある可能性
- **Status**: Reported 2026-03-26 Session 80。furnace作成不可で鉄精錬できない。

## [2026-03-26] Bug: Session 80 - gather("iron_ore")が複数回タイムアウト

- **Cause**: bot.gather("iron_ore", 8-16)を実行すると120秒タイムアウトする。iron_oreの位置(x=27,y=75,z=5)は発見済みで、navigate()で到達もできているが、gather()がタイムアウトする。周囲に敵(enderman,skeleton,creeper)がいる。
- **Coordinates**: x=27-28, y=75, z=5
- **Last Actions**: navigate("iron_ore") → gather("iron_ore", 8) → 120s timeout × 3回
- **Error Message**: "Execution timed out after 120000ms"
- **Status**: Reported 2026-03-26 Session 80。gather()が敵がいる環境でタイムアウトする可能性。

## [2026-03-26] Bug: Session 80 - Death: ゾンビに殺される（夜明け直前）

- **Cause**: HP1、Hunger0の飢餓状態で夜間待機中、夜明け（ticks=23719）にゾンビが接近。wait()がauto-fleeで中断されたが、flee cooldown（30s）により逃走できず、ゾンビに殺された
- **Coordinates**: x=-2, y=111, z=-5（死亡時）
- **Last Actions**: pillarUp → flee → 夜間待機 → wait()がauto-flee中断 → flee cooldown中でゾンビに殺される
- **Error Message**: "Claude1 was slain by Zombie"
- **Root Cause**: flee cooldownが30秒あるため、auto-fleeから30秒以内に再び敵が接近した場合に逃走できない。夜明けのゾンビは日光で燃えず、このシナリオで特に危険。
- **Status**: Reported 2026-03-26 Session 80。keepInventory ON。

## [2026-03-26] Bug: Session 79 - 洞窟スタック継続 + 全移動API失敗

- **Cause**: x=-7, y=52, z=-10 の洞窟に完全に閉じ込められた状態が続いている。gather("stone"), gather("birch_log"), moveTo, pillarUp, flee 全てがタイムアウトまたは微小移動のみ。2時間以上同じ場所に固定。
- **Coordinates**: x=-7, y=52, z=-10
- **APIs Failing**: gather(any,any), moveTo(any,any,any), pillarUp(any), flee(50) = y変化なし, place(cobblestone) = 設置するが自分は動かない
- **Working APIs**: status(), inventory(), eat(), chat(), wait()
- **Error**: gather → timeout 60-120s; pillarUp → "Failed to pillar up. No blocks placed."
- **Status**: Reported 2026-03-26 Session 79. CRITICAL ONGOING.

## [2026-03-26] Bug: Session 79 - Death: 溺死 (3回目)

- **Cause**: Y=49の水中に閉じ込められた。moveTo(x,70,z)を試みていたがガザガザと動けない状態。gather("stone")後にmoveToが成功してY=95に移動したが、その前に溺死。
- **Coordinates**: x=-3, y=49, z=-5 (溺死場所)
- **Last Actions**: gather("stone",1) → moveTo(-3,70,-5) → "Claude1 drowned"
- **Root Cause**: 地下の水中に誤って移動し、脱出できなかった
- **Status**: Reported 2026-03-26 Session 79. 3回目の死亡。keepInventory ON。

## [2026-03-26] Bug: Session 79 - Death: スケルトンから逃げて落下死 (2回目)

- **Cause**: HP:3.8、Hunger:0の飢餓状態でスケルトンと戦闘。逃走中に高所から落下死。"Claude1 hit the ground too hard while trying to escape Skeleton"
- **Coordinates**: x=119, y=70, z=16 付近
- **Last Actions**: navigate("skeleton") → combat("skeleton") → 落下死
- **Root Cause**: 食料ゼロ(gather/farmバグ継続) → HP飢餓ダメージ → 夜間戦闘で落下死
- **Status**: Reported 2026-03-26 Session 79. 2回目の死亡。keepInventory ON。

## [2026-03-26] Bug: Session 79 - Death: ゾンビに殺された (pillarUp後夜間)

- **Cause**: Hunger:0でHP:0.2の瀕死状態。pillarUp(5)でY=111まで上がったが、そこでゾンビに倒された。pillarUpが高所で止まり、夜間にゾンビが追いかけてきた。
- **Coordinates**: x=9, y=111, z=-8 (リスポーン位置)
- **Last Actions**: pillarUp(5) → Y=111 → "Claude1 was slain by Zombie"
- **Root Cause**: 食料ゼロ(gather/farmバグ) → HP:0.2瀕死 → pillarUp中にゾンビ攻撃
- **Status**: Reported 2026-03-26 Session 79. keepInventory ON でアイテム保持。

## [2026-03-26] Bug: Session 79 - moveTo/navigate/gather が全てタイムアウト・移動不能

- **Cause**: bot.moveTo(0,77,20), bot.moveTo(0,77,9) 等を呼び出しても全く移動せず同じ座標のまま。navigate("birch_log"), navigate("oak_log"), navigate("furnace")も複数回タイムアウト。gather("birch_log",4), gather("oak_log",4) も120秒タイムアウト。
- **Coordinates**: x=-112, y=77, z=20 (old_growth_birch_forest)
- **Last Actions**: moveTo(0,77,9) → 3回試行 → 全て(-112,77,20)のまま変化なし
- **Error Message**: Timed out (120000ms, 180000ms, 300000ms), moveTo3回失敗
- **Impact**: 拠点に戻れない、木材収集不可、農場作業不可 — 完全に詰まった状態
- **Status**: Reported 2026-03-26 Session 79. CRITICAL.

## [2026-03-26] Bug: Session 79 - craft("crafting_table", 1, true) がタイムアウト

- **Cause**: autoGather=trueでcraft("crafting_table")を呼び出すと60秒タイムアウト。木材収集フェーズで止まる模様。
- **Coordinates**: x=-112, y=77, z=21
- **Last Actions**: craft("crafting_table", 1, true) → 60秒タイムアウト
- **Status**: Reported 2026-03-26 Session 79.

## [2026-03-26] Bug: Session 78 - Death: 高所からの落下死亡 (navigate("item")後)

- **Cause**: navigate("item")を実行後、Y=114の高い場所にテレポートまたは移動し、そこから落下死亡
- **Coordinates**: x=-8.5, y=114, z=7.5 (リスポーン後の位置)
- **Last Actions**: navigate("item") → "fell from a high place" メッセージ
- **Error Message**: Server: "Claude1 fell from a high place"
- **Status**: keepInventory ON でアイテム保持。HP/Hunger全回復。Reported 2026-03-26 Session 78.

## [2026-03-26] Bug: Session 78 - gather/combat が実行完了してもアイテムがインベントリに追加されない

- **Cause**: bot.gather("iron_ore", 16) および bot.combat("cow"), bot.combat("chicken") が "完了" と返るがインベントリにアイテムが追加されない
- **Coordinates**: x=-16.7, y=67, z=8.3 (old_growth_birch_forest biome), その後Y=58まで移動
- **Last Actions**:
  1. bot.combat("cow") → "牛狩り完了" と表示されるが cooked_beef / beef なし
  2. bot.combat("chicken") → チキン発見・戦闘成功と表示されるが cooked_chicken / chicken なし
  3. bot.gather("iron_ore", 16) → 採掘完了と表示（Y=67→58まで移動）されるが raw_iron / iron_ore なし
- **Inventory check**: 全アイテムが変化なし（stone_hoe, bucket, cobblestone等の初期アイテムのみ）
- **Status**: HP:9 Hunger:15 (まだ生存中)。gather/combat が成功しているように見えるが実際にアイテムを取得できていない。
- **Impact**: 食料ゼロのまま進行できない。鉄装備作成も不可。
- **Status**: Reported 2026-03-26 Session 78. CRITICAL.

## [2026-03-25] Bug: Session 68 - SAME CRITICAL BUG as Session 76/77: All bot.* APIs fail with "Not connected" immediately after mc_connect

- **Cause**: After mc_reload + mc_connect, bot.log() works but ALL other bot.* APIs (status, inventory, moveTo, navigate, gather, place, farm, build, combat, etc.) fail with "Not connected" within 1-2ms.
- **Session 68 Timeline**: mc_reload × 5+, mc_connect × 20+, mc_execute fails on all substantive calls.
- **What DID work during session**: Some calls to status()/moveTo() worked intermittently (right after first connect) before the pattern degraded.
- **Deaths in Session 68**: 4 confirmed deaths (respawn at Y=82-112 each time). All from no-food starvation since combat() produces no drops and farm()/build() fail with "Bot not found".
- **Status**: Same root cause as Session 76/77. BLOCKING. Game completely unplayable.

## [2026-03-26] Bug: Session 77 - bot.log() のみ動作、他の全API (inventory/navigate/chat/gather等) が即時 "Not connected" エラー

- **Cause**: mc_connect後、bot.log()は動作するが、他の全てのbot.*APIが即時(1-2ms)に "Not connected to any server" エラーになる。
- **Reproduction**:
  1. mc_connect → mc_execute `{ bot.log("test"); "ok"; }` → SUCCESS (1ms)
  2. mc_connect → mc_execute `{ await bot.chat("msg"); }` → FAIL 2ms
  3. mc_connect → mc_execute `{ await bot.inventory(); }` → FAIL after 2000ms (wait completed but inventory failed)
  4. mc_connect → mc_execute `{ await bot.gather("oak_log", 3); }` → TIMEOUT 60s
  5. mc_connect → mc_execute `{ await bot.navigate("birch_log"); }` → FAIL 2ms
- **Pattern**: bot.log()はサンドボックス内で完結するためOK。botManagerを使うAPIは全てbotsMapが空になっているためFAIL。
- **Root Cause**: botsMapがmc_execute実行完了後にクリアされる既知バグ (Session 76報告済み)。今セッションでも完全再現。
- **Coordinates**: x=-6, y=55, z=16 (old_growth_birch_forest biome)
- **Bot state**: HP=20, Hunger=16 (接続直後の確認値)
- **Impact**: GAME COMPLETELY UNPLAYABLE. No bot.* API works except bot.log().
- **Status**: Reported 2026-03-26 Session 77. CRITICAL BLOCKING. Code reviewer fix needed.

---

## [2026-03-25] Bug: Session 68 - farm() and build("shelter") fail with "Bot Claude1 not found"

- **Cause**: bot.farm() and bot.build("shelter") both throw "Bot Claude1 not found". This matches the Session 76 bug: botManager.bots Map gets cleared after bot death (respawn), so when farm/build try to look up the bot by username, it's gone.
- **Confirmed Pattern**: bot.status(), bot.inventory(), bot.moveTo() still work after respawn (these might use a different code path). But bot.farm() and bot.build() fail.
- **Root Cause**: These high-level functions use botManager.getBotByUsername("Claude1") which returns null after respawn clears the Map.
- **Fix Needed**: botManager should re-register the bot after respawn, or farm/build should use the bot reference directly.
- **Status**: Reported - same root cause as Session 76 non-deterministic "Not connected" bug

## [2026-03-26] Bug: Session 76 - CRITICAL: mc_execute non-deterministically fails with "Not connected"
- **Symptom**: After mc_connect or mc_reload, mc_execute sometimes succeeds (1-2 times) then ALWAYS fails with "Not connected" on subsequent calls. Non-deterministic: same code succeeds one time, fails the next.
- **Key Evidence**:
  - `await bot.wait(500); bot.log("A"); await bot.navigate("cow");` → SUCCESS (1034ms)
  - Same code executed immediately after mc_connect: → FAILS after 504ms (bot.log OK, navigate fails)
  - bot.log() (no botManager call): ALWAYS succeeds
  - bot.navigate(), bot.status(), bot.inventory() etc. (botManager API): UNPREDICTABLE
- **Root Cause**: mc_execute completes → bot.on("end") fires → botManager.bots Map cleared → all subsequent mc_execute fail
- **Why end fires**: Either (1) Minecraft server kicks bot after each mc_execute, or (2) mc_execute cleanup triggers bot disconnection, or (3) bot deaths (HP=0) trigger respawn which fires end event
- **Impact**: GAME IS UNPLAYABLE. Cannot reliably execute any game action.
- **Fix Needed**: After bot.on("end"), do NOT delete from botsMap if bot is respawning. OR handle reconnection transparently in mc_execute instead of failing.
- **Status**: Reported - CRITICAL BLOCKER

## [2026-03-25] Bug: Session 68 - Death 3 (starvation HP=6, Y=66 underground), build("shelter") throws "Bot Claude1 not found"

- **Cause**: HP=6, Hunger=8, no food, underground at Y=66. Died from starvation damage. Also: bot.build("shelter") throws error "Bot Claude1 not found" - indicates botManager.bots map doesn't have the correct key during shelter building.
- **Death Pattern**: All 3 deaths this session from same cause: no food (combat() produces no drops, can't find/eat animals), mob attacks while at low HP
- **build() bug**: `bot.build("shelter")` fails with "Bot Claude1 not found" error. This is likely a botManager key mismatch - the bot is registered under a different key than the username.
- **Coordinates**: Death 3: (~-40, 66, -10)
- **Status**: Reported - 3 deaths total in Session 68

## [2026-03-25] Bug: Complete movement failure - bot stuck underground Y=55-68 (Session 65 SUMMARY)

- **Cause**: Multiple compounding failures in Session 65:
  1. pillarUp() - always times out or Y stays same
  2. tunnel("up") - times out or completes instantly with no Y change ("No pickaxe" despite having stone_pickaxe)
  3. moveTo(x, HIGH_Y, z) - bot moves to wrong Y (downward), pathfinder finds path at lower Y
  4. gather() - timeouts when target block exists (navigate returns success but gather does nothing)
  5. Connection drops every few operations requiring constant reconnect
- **Coordinates**: (-36, 59-68, 0) to (-4, 60, 2)
- **Root Cause Analysis**: The area around spawn (0, 60-82, 0) appears to have massive terrain destruction (previous dig operations) creating disconnected cave systems. Pathfinder cannot route upward through the destroyed terrain. moveTo to high Y coordinates routes through lower passages instead.
- **Pattern**: Bot was at Y=37 (Session 64), died→respawned at Y=90, fell back underground multiple times across Session 65. Each death causes respawn at Y=90-115, but bot always returns to Y=55-70 range due to flee/movement pushing it down.
- **Fix Needed**:
  1. pillarUp: Fix upward movement to actually use jump+place cobblestone loop
  2. moveTo: Should climb up when Y target > current Y, even if no direct path
  3. tunnel("up"): Should not fail silently when pickaxe is in inventory
  4. Connection stability: bot disconnects during long operations
- **Status**: Reported. Session 65. ALL movement tools broken underground. 3 deaths this session.

---

## [2026-03-26] Bug: bot.status() call causes immediate disconnect from Minecraft server (CRITICAL)

- **Cause**: Calling `await bot.status()` inside mc_execute causes the bot to immediately disconnect. `bot.log()` and `await bot.wait()` work fine. `bot.status()` specifically triggers the disconnect.
- **Reproduction**:
  1. mc_connect → mc_execute `{ await bot.wait(100); bot.log("ok"); }` → SUCCESS
  2. mc_connect → mc_execute `{ await bot.wait(100); const s = await bot.status(); }` → FAIL "Not connected" after 103ms
  3. mc_connect → mc_execute `{ const s = await bot.status(); }` → FAIL after 2ms
- **Hypothesis**: bot.status() may be calling bot.entity or bot.inventory or another property that doesn't exist when the Minecraft bot is in a disconnecting/reconnecting state, causing an error that closes the connection.
- **Impact**: CRITICAL - Cannot check HP, position, inventory, or any game state. All meaningful gameplay impossible.
- **Status**: Reported 2026-03-26. CRITICAL BLOCKING.

---

## [2026-03-26] Bug: Session 65 - gather() navigates but collects 0 iron_ore after 120s (CRITICAL)

- **Cause**: bot.gather("iron_ore", 8) runs for 120s, bot moves ~20 blocks around cave at Y=59-61, but returns 0 raw_iron. The bot IS navigating (position changes) but no items collected.
- **Coordinates**: Start (-3.5, 61, 3), End (-23.7, 59, 5.5)
- **Last Actions**: gather("iron_ore", 8) timeout 300000ms → ran for 120s → 0 raw_iron
- **Possible Cause**: (1) Stone pickaxe not being equipped, (2) Navigation finds block but mining fails silently, (3) Item pickup fails after mining
- **Status**: Reported. Session 65.

---

## [2026-03-26] Bug: bot.eat() returns success but no food items consumed (Session 65)

- **Cause**: bot.eat() called with hunger=11, HP=6. Returns "Ate food" but food count stays at 0. No food items in inventory.
- **Coordinates**: (-39.5, 63, 3)
- **Last Actions**: eat() → "Ate food" logged but HP stays at 6, hunger stays at 10
- **Impact**: HP cannot recover without food. HP=6 stuck state.
- **Status**: Reported. Session 65.

---

## [2026-03-26] Bug: mc_connect reports "Connected" but mc_execute immediately fails (Session 2026-03-26 - CRITICAL BLOCKING)

- **Cause**: mc_connect reports "Connected to localhost:25565 as Claude1" but subsequent mc_execute calls fail in 1-2ms with "Not connected to any server". This happens almost every call. Occasionally 1 mc_execute succeeds right after mc_connect (non-deterministic), but then next mc_execute immediately fails.
- **Pattern**:
  - mc_connect → mc_execute (FAIL 1ms) - most common
  - mc_connect → mc_chat → mc_execute (FAIL) - mc_chat may trigger disconnect
  - mc_reload (auto-reconnect) → mc_execute (FAIL) - reload's auto-connect not recognized
  - mc_connect → mc_execute (SUCCESS - rare) → mc_execute (FAIL) - 2nd always fails
- **Coordinates**: x=-5, y=61, z=9 (birch_forest biome)
- **Bot state**: HP=6 (danger), food=0, wheat_seeds=103
- **Error**: "Not connected to any server. Use minecraft_connect(...) first."
- **Impact**: COMPLETELY BLOCKS ALL GAMEPLAY. Bot cannot eat, move, or survive.
- **Status**: Reported 2026-03-26. CRITICAL BLOCKING. Needs immediate code reviewer fix.

---

## [2026-03-26] Bug: mc_execute disconnects after every single call (Session current - CRITICAL BLOCKING)

- **Cause**: mc_execute succeeds exactly once after mc_connect or mc_reload, then ALL subsequent mc_execute calls immediately fail with "Not connected to any server". Pattern: mc_reload → mc_execute (success) → mc_execute (FAIL). mc_connect → mc_execute (FAIL). This makes any multi-step gameplay impossible.
- **Coordinates**: x=-5, y=61, z=9 (birch_forest biome)
- **Last Actions**: mc_reload → mc_execute status check (success) → mc_execute second call (immediate fail 1ms)
- **Error Message**: "Not connected to any server. Use minecraft_connect(host="localhost", port=25565, username="Claude1", agentType="game") first."
- **Impact**: Cannot perform any sequential operations. Even simple 2-step workflows break. Bot stuck with 0 food items, HP=9, wheat_seeds=103.
- **Status**: Reported. Session 2026-03-26. CRITICAL BLOCKING.

---

## [2026-03-25] Bug: Session 66 - Multiple deaths + Critical API failures (BLOCKING)

- **Deaths this session**: 5+ deaths. Starvation, fall from extreme height via flee(), mob attacks.
- **Critical Bug 1 - combat() drops not collected**: All animal/mob combat returns immediately without drops. raw_beef/rotten_flesh never obtained via combat(). Confirmed: navigate("cow")→combat("cow") → no raw_beef in inventory.
- **Critical Bug 2 - gather() timeout**: gather("oak_log", 4) times out at 90-120 seconds without collecting any wood. Pathfinder fails silently.
- **Critical Bug 3 - farm() no output**: farm() runs for 40-50 seconds but produces no wheat or bread, despite wheat_seeds x100 in inventory and stone_hoe equipped.
- **Critical Bug 4 - flee() extreme altitude**: flee() sent bot to Y=117 causing fatal fall damage ("hit the ground too hard"). flee() must not use pillarUp to extreme heights.
- **Coordinates**: Spawn area (-3, 65, 9) and surrounding area
- **Status**: Reported. Session 66. CRITICAL - bot cannot obtain food through any mechanism.

---

## [2026-03-25] Bug: MCP Connection drops every ~10s causing repeated reconnects - Session current

- **Cause**: MCP server connection drops every 5-15 seconds requiring repeated mc_connect calls. Any mc_execute call longer than ~5s results in "MCP error -32000: Connection closed" or "Bot Claude1 not found". This makes any meaningful gameplay loop impossible.
- **Coordinates**: N/A (affects all sessions)
- **Last Actions**: flee(40) → disconnect. pillarUp(30) → disconnect. moveTo() → disconnect. Even wait(10000) sometimes disconnects.
- **Error Message**: "MCP error -32000: Connection closed" or "Not connected to any server"
- **Root Cause**: Unknown. May be related to mineflayer bot disconnect events, server timeout, or MCP server instability when bot performs long navigation.
- **Impact**: Cannot complete any operation longer than ~3-5 seconds. Cannot gather resources, build shelter, craft items effectively.
- **Fix Needed**: MCP server or bot manager should handle reconnection automatically, or bot should stay connected longer during operations.
- **Status**: Reported. Session current. CRITICAL - blocks all gameplay.

---

## [2026-03-25] Bug: gather() sends bot underground even from surface - Session current

- **Cause**: bot.gather("birch_log") called from Y=82-84 (surface) but bot ends up at Y=47, Y=34, Y=52 underground. gather finds underground logs via cave systems and navigates through them, pulling bot underground.
- **Coordinates**: Start ~(-2,84,-4), End ~(-7,47,3)
- **Last Actions**: gather("birch_log",4) from Y=84 → Y=47 after 90s. gather("oak_log",4) from Y=82 → Y=60.
- **Error Message**: No error, but bot ends up underground.
- **Root Cause**: gather() uses navigate() which can route through caves. Once underground, the birch_log target may be in the cave above the bot's position, but pathfinder descends further.
- **Fix Needed**: gather() should constrain Y coordinate to stay above terrain surface (Y >= current surface Y).
- **Status**: Reported. Session current.

---

## [2026-03-25] Bug: Session 68 continued - Death 2 at Y=21 underground, Death 1 at Y=47 underground

- **Cause**: 1) HP=1.5 at Y=47 underground, mob attack → death. 2) HP=6 at Y=21, gather("oak_log") sent bot underground during dawn → died. Both deaths from same pattern: no food + underground + mobs.
- **Key Bugs**: combat() not killing entities (entity count unchanged after 5+ rounds), flee() times out with 4+ skeletons (ranged_mob_danger blocks all directions), gather() finds underground resources → bot goes underground even during daytime
- **Coordinates**: Death1: (-7, 47, 3), Death2: (~5, 21, -5)
- **Fix Needed**: gather() should filter to surface blocks only (Y > 62) when game phase is day/morning/evening. flee() should have fallback when all directions blocked by ranged mobs.
- **Status**: Reported

## [2026-03-26] Bug: Session 76 - Death loop with no food: HP drops during wait → dies → respawns → repeat
- **Cause**: Bot is in a death loop: HP:6-10, no food (food=0), night time, hostiles everywhere. bot.wait() aborts after 10-15s because HP drops from mob attacks. Bot dies, respawns (keepInventory), then botManager.bots Map is cleared (respawn triggers bot.on("end")). mc_reload needed each cycle. Net result: bot cannot recover food or HP.
- **Death count this session**: 3+
- **Root Cause**: 1) combat() does not produce food drops (known bug), 2) No food in chests, 3) wheat_seeds in inventory but no farmland/time to grow, 4) Night time prevents safe navigation
- **Fix Needed**: One of: a) Make bot.wait() detect low HP + no food and immediately go to bed/chest instead of waiting, b) Fix combat() to reliably return food drops, c) Add emergency food provision if HP<5 and food=0 (nav to chest, kill mob for rotten flesh)
- **Coordinates**: (~5, 68, 0) birch_forest
- **Status**: Reported - ongoing death loop

## [2026-03-26] Bug: Session 74c - Death underground at Y=47, HP=1.5 no food (3rd death this session)
- **Cause**: Bot was at Y=47 underground with HP=1.5 and no food. Took damage from enderman/creeper hits while trying to wait for dawn and climb to surface. Died.
- **Coordinates**: ~(-6, 47, 2) underground cave
- **Last Actions**: Underground shelter dig → HP 1.5 → wait() ABORTED multiple times (damage) → tried to moveTo surface → died → respawned at spawn (6, 67, 1) with HP:10
- **Error Message**: HP=1.5 with no food recovery option. bot.wait() repeatedly aborted.
- **Root Cause Analysis**: (1) Underground at Y=47 during night - enderman aggro and mob spawns in cave. (2) No food = no HP regen = death spiral. (3) bot.wait() being aborted is correct but there's no recovery path at HP=1.5.
- **Fix Suggestion**: When HP<3 with no food, bot should spam-dig upward immediately to get to light. Also, bot.eat("rotten_flesh") should work even with hunger>9.
- **Status**: Reported (Session 74c)

## [2026-03-25] Bug: Session 68 - Death at Y=47 underground (HP=1.5, multiple mobs)

- **Cause**: Bot went from Y=65 surface → Y=47 underground (flee went DOWN not up). At Y=47, surrounded by skeleton, zombie, creeper in cave. HP=1.5 from prior mob damage. no food. Died to mob attack.
- **Coordinates**: (-7, 47, 3) approximate
- **Last Actions**: flee(60) from skeleton x4+creeper x2 → resulted in bot going deeper underground to Y=47 → mob kill
- **Error Message**: Connection dropped (death). Respawned at (6, 112, 9) with HP=20, Hunger=20
- **Root Cause**: flee() with canDig=true underground routes through stone, going DOWNWARD instead of upward. Exits into deeper cave with more mobs.
- **Status**: Reported

## [2026-03-25] Bug: Session 68 - combat() kills 0 entities - no drops, entity count unchanged after repeated attacks

- **Cause**: bot.combat("zombie") and bot.combat("cow") called repeatedly (10+ times). nearbyEntities count never decreases. No food drops, no XP. combat() appears to not deal damage or not detect kills properly.
- **Coordinates**: (~5, 68, -3) and others
- **Last Actions**: for loop calling combat("zombie") x5 → entity count unchanged (zombie:3 before AND after)
- **Error Message**: No error thrown. Returns success with no effect.
- **Related**: This was reported in Session 67 (combat drops bug ea6cf7d fix). Drops bug may be fixed but KILL detection is broken - mobs survive combat.
- **Status**: Reported

## [2026-03-25] Bug: Session 68 - flee() always TIMES OUT when skeleton/creeper >3 are nearby

- **Cause**: flee(60) consistently times out (30-60 second timeout) when surrounded by skeleton x4-6 + creeper x2-3. Logs show "Fleeing mobs..." then timeout without any position change.
- **Coordinates**: (~5, 68, -3)
- **Last Actions**: flee(60) called → 30-60s timeout → same position
- **Error Message**: "Execution timed out" after exactly the timeout duration
- **Pattern**: flee() succeeds when mobs are 1-2, fails completely when 4+ skeletons present. The ranged_mob_danger check likely aborts the pathfinding immediately for all 4 directions.
- **Status**: Reported

## [2026-03-25] Bug: Session 68 - Mobs follow bot across 80+ block distances during daytime

- **Cause**: After aggroing during nighttime, mob cluster (skeleton:5-6, creeper:2-3, zombie:3-4) follows the bot regardless of distance. moveTo(50,65,50) and moveTo(200,65,200) both show same mob counts. Mobs should stop following at ~40 blocks in daylight.
- **Coordinates**: Started at (2, 68, -8), persisted at (50, 68, 50)
- **Last Actions**: moveTo to various positions - mob count unchanged at all locations
- **Error Message**: None - just observational pattern
- **Status**: Reported

## [2026-03-25] Bug: Session 63 - Bot disconnects during wait(3000) at HP=1.5 underground - Death by mob

- **Cause**: Bot at HP=1.5, Y=47 underground, morning (ticks=1233). wait(3000) call causes disconnect at exactly 3002ms. Bot being killed underground by mobs during the 3-second wait, resulting in death + disconnect.
- **Coordinates**: (-7.5, 47, 3.5)
- **Root Cause**: HP=1.5 is not safe for any wait(). Even with the HP<3 abort fix, a single mob hit kills bot at 1.5 HP. Disconnect follows death.
- **Status**: Reported. Continuing gameplay with shorter wait() calls to avoid death.

---

## [2026-03-25] Bug: Session 70d - Repeated deaths from creepers/zombies at night near spawn (Y=73-109)

- **Cause**: Bot kept dying to creepers/zombies near spawn (0,0) at night. Pattern: respawn → HP=20 → night mob attacks → die again → repeat x4-5 times. Spawn point Y=95-117 is on high mountain with dense mob spawns. flee() couldn't escape creeper clusters (4 creepers tracked bot). bot.build("shelter") failed with "Bot Claude1 not found" error. Frequent disconnects during wait().
- **Coordinates**: (3, 95, 4) → (-5, 61, 1) → various
- **Last Actions**: Repeated flee attempts → shelter build fails → night mob swarms → creeper explosions
- **Error Message**: "Bot Claude1 not found" (shelter build) + MCP connection closed errors
- **Pattern**: Spawn point Y=100+ on mountain has no natural shelter, bot exposed to infinite mob respawns at night
- **Contributing Factors**: (1) bot.build("shelter") crashes with "Bot Claude1 not found", (2) bot disconnects during long wait() calls, (3) flee() not moving away from mob cluster effectively
- **Item losses**: coal x8, torch x2, crafting_table, chest x2 lost across multiple deaths
- **Status**: Reported

## [2026-03-26] Bug: Session 76 Death - HP:1.5 + death from mob underground (Y=44) - bot auto-respawned
- **Cause**: Bot was at HP:1.5 underground (Y=44) with no food. Mob killed bot. Auto-respawn triggered (keepInventory=ON).
- **Root Cause of Low HP**: Bot was stuck underground with HP:1.5 and no food. Could not reach chest to get food due to disconnect bug.
- **Coordinates**: (-8, 44, 5) underground birch_forest
- **Post-Death**: Bot respawned at Y=112 surface with HP:20 Hunger:20. keepInventory maintained all items.
- **Pattern**: This is the ongoing pattern where bot dies underground with no food. See also Session 63 bug.
- **Status**: Reported - Death #1 this session

## [2026-03-26] Bug: Session 76 - CRITICAL: await bot.status() disconnects bot, making game unplayable
- **Cause**: After mc_connect succeeds, bot.log() (sync, no botManager call) works fine multiple times. But ANY call to `await bot.status()` causes the bot to disconnect from botManager. After the disconnect, ALL subsequent mc_execute calls fail with "Not connected" (1ms).
- **Pattern**: mc_connect → mc_execute{bot.log("A")} SUCCESS → mc_execute{bot.log("B")} SUCCESS → mc_execute{await bot.status()} → SUCCESS ONCE (HP:1.5) → all subsequent calls FAIL
- **Reproduced multiple times**: The pattern is: bot.status() sometimes succeeds once (HP:1.5 returned), but then bot is disconnected. Rarely it fails immediately (1ms).
- **Root Cause**: bot.status() calls mc_status() which is an async function. Something inside mc_status() or its promise chain causes bot.on("end") to fire, deleting the bot from botManager.bots Map. This disconnects the bot from the game.
- **Additional Evidence**: mc_execute{await bot.moveTo()} also causes immediate failure - moveTo() never starts (0ms failure), meaning botManager.requireSingleBot() fails instantly when called inside moveTo's implementation.
- **Coordinates**: (-8, 44, 5) Y=44 underground birch_forest
- **Current Game State**: HP:1.5, Hunger:8, no food, skeleton+creeper nearby, chest at (-6,61,2), morning
- **Impact**: CANNOT PLAY THE GAME. Bot dies at HP:1.5 with no way to recover food. All game actions that use botManager (status, moveTo, flee, etc.) disconnect the bot.
- **Fix Needed**: Investigate why mc_status() or botManager calls cause bot disconnection. Root cause is likely death → Mineflayer respawn → bot.on("end") fires → botsMap cleared. After mc_reload the bot reconnected at HP:20 (post-respawn), confirming this theory.
- **Status**: Reported - prevent deaths to prevent this disconnect cycle

## [2026-03-25] Bug: Session 75 - Death: Zombie climbed pillar, no food to recover

- **Cause**: Bot pillarUp to Y=79-81 at night. Zombie pathfound up cobblestone pillar and attacked. HP=1. eat() failed (no food). flee() moved but HP remained at 1. Died.
- **Coordinates**: (123, 88, 93)
- **Last Actions**: pillarUp(10) → wait(30000) → zombie attacked → HP=1 → eat() failed → fled → died
- **Pattern**: Zombies CAN climb cobblestone pillars. Pillar alone is NOT a safe night strategy.
- **Root Cause**: No food + zombie pillar climbing = death. Need enclosed shelter with roof.
- **Status**: Reported

## [2026-03-25] Bug: Session 75 - combat() returning no drops from animals or hostile mobs

- **Cause**: bot.combat() for cow/pig/chicken/sheep AND zombie/skeleton yields no drops. navigate() finds animals but combat() leaves inventory unchanged.
- **Coordinates**: (12, 72, -7) and (134, 83, 94)
- **Error Message**: No error, but zero drops after multiple animal combat attempts.
- **Impact**: Cannot get food via hunting. Primary cause of starvation deaths this session.
- **Status**: Reported

## [2026-03-25] Bug: Session 69d - Death while waiting for night to pass (HP=1 mob attack)
- **Cause**: Bot waited with wait(25000) at night with skeleton+creeper x3 nearby. During the 25s interval, mobs attacked bringing HP from 9 to 1. flee() triggered but death occurred before it could escape.
- **Coordinates**: (~134, 80, 88) old_growth_birch_forest
- **Last Actions**: craft(furnace) → wait(25000) → HP 9→1 during wait → flee too late → death
- **Error Message**: Death not caught in chat, confirmed by HP=20 Hunger=20 after reconnect
- **Status**: Reported

## [2026-03-25] Bug: Death at (132,83,90) - furnace placement near mobs - Session current

- **Cause**: HP was 9 on reconnect. Placed furnace+crafting_table with zombie×2 and skeleton×1 nearby. HP dropped to 1 immediately. flee(50) didn't save. Respawned after 5s.
- **Coordinates**: (132, 83, 90)
- **Last Actions**: place("furnace") + place("crafting_table") → zombie×2 skeleton×1 nearby → HP=1 → flee → respawn HP=20 Hunger=20 at (4, 117, 10)
- **Fix Needed**: equip armor and flee hostiles before placing blocks.
- **Status**: Reported. keepInventory=true. stone_pickaxe×3, stone_sword×1 intact.

---

## [2026-03-26] Bug: Session 74b - Death during night flee, HP 9→1 then respawn
- **Cause**: HP was 9 at night with skeleton+zombie. bot.flee(50) ran ~8s but HP dropped to 1 during flight (mobs were hitting during flee). No food available to recover. Bot died and respawned.
- **Coordinates**: ~(136, 83, 100) old_growth_birch_forest
- **Last Actions**: night detected → flee(50) → HP=9→1 → eat() failed (no food) → place cobblestone walls → death → respawn at (-1, 99, 10)
- **Error Message**: HP dropped to 1 then to 0 during flee. Respawned with HP:10.3 at spawn.
- **Root Cause Analysis**: Flee runs into mobs rather than away from them, or mobs can hit while bot is running. At night with multiple hostiles and low HP, flee alone is insufficient. Need: (1) flee check actual direction away from mobs, (2) when HP<5 at night, dig into ground/pillar instead of running.
- **Status**: Reported (Session 74b)

## [2026-03-25] Bug: Session 74 - HP dropped to 1 during night crafting despite flee at hostiles detection
- **Cause**: During night crafting session, zombies attacked and HP dropped from ~9 to 1. The flee logic in mc_execute code ran but was too slow - by the time flee() completed HP was already 1. craft_chain also detected HP=1 and aborted. Bot nearly died.
- **Coordinates**: ~(131, 80, 86) old_growth_birch_forest
- **Last Actions**: Fled from skeleton+zombie x2 during night → placed crafting_table → craft(stone_pickaxe,2) → HP dropped to 1 mid-craft → flee(80) x2 → HP recovered to 20
- **Error Message**: "craft_chain ABORTED: HP critically low (1.0/20) while crafting stone_sword"
- **Root Cause**: Night crafting with hostiles nearby is dangerous. Flee was triggered but damage came in between flee and crafting. Need: abort crafting if night + hostile within N blocks, or ensure flee is called MORE aggressively during night operations.
- **Status**: Reported - survived but near death

## [2026-03-26] Bug: Session 73 - mc_connect returns "Connected" but mc_execute still fails with "Not connected"
- **Cause**: mc_connect returns "Connected to localhost:25565 as Claude1" but subsequent mc_execute and mc_chat calls return "Not connected" error. mc_reload auto-reconnect also reports "Connected" but mc_execute still fails. The connection state is inconsistent between mc_connect and bot-core.
- **Coordinates**: N/A (cannot get position)
- **Last Actions**: mc_connect (version auto-detect failed first, then 1.21.4 succeeded) → mc_execute fails → mc_reload → mc_execute still fails
- **Error Message**: "Not connected to any server. Use minecraft_connect(host="localhost", port=25565, username="Claude1", agentType="game") first."
- **Root Cause**: mc_connect may be returning success before the bot is fully initialized in bot-core, or there is a MCP session mismatch between tool calls.
- **Status**: Reported

## [2026-03-26] Bug: Session 72f - Death by Skeleton at HP:1.3, moveTo safety block created inescapable trap
- **Cause**: moveTo blocked at HP:1.3 ("HP too low even for food search"). Bot could not move to escape. Skeleton arrow killed bot.
- **Coordinates**: (4, 110, -1) birch_forest
- **Last Actions**: moveTo blocked with "SAFETY: Cannot move 255.8 blocks with critical HP" → Short moveTo returned "Navigation stopped: pathfinder climbed too high" → "Claude1 was shot by Skeleton"
- **Error Message**: "Claude1 was shot by Skeleton"
- **Root Cause Analysis**: The moveTo safety block at low HP creates a death trap — bot cannot move to flee OR find food. Need a flee-always exception that ignores HP checks, or automatic flee to water/safe zone when HP drops below 2.
- **Related**: Same session 72e bug - HP:1.3 trap compound failure
- **Status**: Reported - 4th death in Session 72

## [2026-03-26] Bug: Session 72e - HP:1.3 trap, no food, moveTo blocked below HP threshold
- **Cause**: HP dropped to 1.3 from unknown source. moveTo completely blocked (returns immediately without moving). No food in inventory. Natural regen not working (hunger:13 < 18 threshold). Bot completely stuck.
- **Coordinates**: (60, 80, -2) birch_forest
- **Last Actions**: gather("birch_log") loop → HP dropped to 2.3 → fled → HP stayed at 1.3 → moveTo blocked → stuck
- **Error Message**: moveTo returns without movement. HP:1.3 threshold check blocks movement.
- **Contributing Factors**: 1) moveTo has a HP minimum check that blocks at HP<1.5. 2) No food escape route available. 3) Could not gather food animals. 4) admin authorized respawn as last resort.
- **Status**: Reported - Respawn required as last resort per admin instruction

## [2026-03-26] Bug: Session 72d - moveTo completely non-functional, always returns to same position
- **Cause**: bot.moveTo() returns immediately but position doesn't change. Calling moveTo(100,100,100) or moveTo(startX+30, y, z) all return position (5, 80, -9) after execution. No movement at all.
- **Coordinates**: (5, 80, -9) birch_forest - this is the position bot keeps returning to
- **Last Actions**: Multiple moveTo calls with different targets → all show position unchanged at (5, 80, -9)
- **Error Message**: No error thrown, moveTo returns success but bot stays in place
- **Contributing Factors**: Pathfinder may be blocked in all directions. Y=80 is inside a hill or blocked area. Bot also shows hostile mobs (skeleton, creeper) in daylight, suggesting underground spawn points nearby.
- **Status**: Reported

## [2026-03-26] Bug: Session 72c - Death by Zombie while stuck underground with HP:5.2
- **Cause**: Bot got stuck in underground cave at Y=70-75. pillarUp failed (no blocks placed), moveTo couldn't change Y. HP dropped to 5.2 from unknown source. flee() timed out during emergency escape attempt.
- **Coordinates**: (-22, 70, -29) old_growth_birch_forest underground cave
- **Last Actions**: gather("iron_ore") → HP:5.2 warning → flee(50) attempt → timeout → "Claude1 was slain by Zombie"
- **Error Message**: "Claude1 was slain by Zombie", flee timed out after 30s
- **Contributing Factors**: 1) pillarUp completely non-functional in cave environment. 2) moveTo cannot increase Y coordinate when blocked by ceiling. 3) flee() timed out during emergency. 4) No food in inventory to eat for HP recovery. 5) Multiple deaths in same session from underground cave trap.
- **Root Cause**: Cave navigation creates death traps - no reliable escape mechanism when underground.
- **Status**: Reported

## [2026-03-26] Bug: Session 72b - Death by drowning during farm() loop at night.
- **Cause**: farm() loop navigated bot into water body at night. HP dropped to 4.7 from drowning. No escape triggered during farm() execution.
- **Coordinates**: (~101, 63, -3) old_growth_birch_forest
- **Last Actions**: farm() loop (5x) → Loop 2 showed HP:4.7 → "Claude1 drowned"
- **Error Message**: "Claude1 drowned"
- **Contributing Factors**: farm() navigation can lead bot into water. wait() already has drowning protection (ABORTED messages seen) but farm() itself has no drowning check. Loop continued even after HP dropped to 4.7.
- **Status**: Reported

## [2026-03-26] Bug: Session 72 - Death by Zombie during food exploration. HP/Hunger not managed.
- **Cause**: bot.eat() called but Hunger=0 → no food in inventory → starvation + zombie attack. HP was 10 when moving, hunger hit 0, zombie killed.
- **Coordinates**: (~250, 103, -235) old_growth_birch_forest
- **Last Actions**: moveTo(-200,70,0) → navigate("cow") → combat animals → status showed HP:10 Hunger:0 → zombie slain Claude1
- **Error Message**: "Claude1 was slain by Zombie"
- **Contributing Factors**: bot.eat() cannot recover if no food in inventory. No flee triggered when hunger=0+hp=10. Safety check only checked hp<8 not hunger=0 combined with low hp.
- **Status**: Reported

## [2026-03-26] Bug: Session 71e - Death by drowning during gather(oak_log). 4th death in session.
- **Cause**: gather("oak_log", 8) triggered navigation that led bot into water, causing drowning death.
- **Coordinates**: (-9, 112, 7) at death attempt, birch_forest Y=112
- **Last Actions**: flee(50) to clear area → gather("oak_log", 8) → "Claude1 drowned"
- **Error Message**: "Claude1 drowned"
- **Contributing Factors**: gather() navigation routes through water without drowning protection. High altitude Y=112 area with water sources nearby. 4th death in single session.
- **Session Summary (71a-71e)**: Death by Skeleton x2, Zombie x1, Drowning x1. Root causes: pillarUp non-functional, build(shelter) timeout, combat/gather drops not collected, farm() immediate return, moveTo doesn't reach low Y targets.
- **Status**: Reported

## [2026-03-26] Bug: Session 71d - Death x3 in session (Zombie). Night survival completely broken.
- **Cause**: Multiple deaths this session. zombie killed bot at HP<10, Hunger=6, food=0. All night survival methods failing: pillarUp Y doesn't change, build("shelter") timeouts, wait() auto-flee from shelter position, place("cobblestone") doesn't create sealed room.
- **Coordinates**: ~(94, 71, -94) before death, respawn at (-4, 112, -9)
- **Last Actions**: flee repeatedly, place cobblestone walls, wait(30000) x8 loops all aborted by auto-flee creeper approach
- **Error Message**: "Claude1 was slain by Zombie"
- **Contributing Factors**:
  1. pillarUp(8) doesn't change Y coordinate - completely non-functional
  2. build("shelter") timeouts (120s)
  3. wait() auto-flee keeps moving bot away from any shelter position
  4. No food = hunger drop = can't recover HP
  5. Spawn area Y=100-112 has constant hostile mob density at night
- **Pattern**: This is the same night survival failure pattern as Sessions 67, 70, 70b, 70c
- **Status**: Reported

## [2026-03-26] Bug: Session 71c - Death by Skeleton during night, pillarUp non-functional + build("shelter") timeout
- **Cause**: Night survival failed. pillarUp(8) executed but Y stayed at 81 (no height gained). Skeleton continued attacking. build("shelter") timed out after 120s. Bot shot and killed at HP=8.5.
- **Coordinates**: (129, 72, 57) at death
- **Last Actions**: flee(60) → HP:8.5, build("shelter") → timeout 120s → "Claude1 was shot by Skeleton"
- **Error Message**: "Execution timed out after 120000ms" during build("shelter"). Then death message.
- **Contributing Factors**: pillarUp not increasing Y coordinate (Y=81 before and after pillarUp(8)). build("shelter") blocking for >120s. Skeleton ranged attack bypasses pillar safety.
- **Status**: Reported

## [2026-03-26] Bug: Session 71b - gather("iron_ore") always returns success but raw_iron never added to inventory
- **Cause**: bot.gather("iron_ore") returns immediately with no displacement and no items collected. Navigate to iron_ore works (moves bot to ore location), but gather() after navigation also collects nothing.
- **Coordinates**: (37, 77, 31) → moved to (46, 74, 29) after navigate
- **Last Actions**: gather("coal_ore", 8) succeeded and gave coal. gather("iron_ore", 8) at Y=74-95 returns success but raw_iron=0 every time. Tried 3 times.
- **Error Message**: No error thrown, just 0 iron in inventory after gather()
- **Contributing Factors**: Same as previous sessions - gather() drops collection bug for iron_ore specifically. coal_ore worked fine.
- **Status**: Reported

## [2026-03-26] Bug: Session 71 - Death by Skeleton (shot)
- **Cause**: Bot shot by Skeleton. Likely exposed outdoors with no armor equipped.
- **Coordinates**: Approximately (6, 100, -3) - birch_forest biome
- **Last Actions**: Previous session ended, reconnected and found death message "Claude1 was shot by Skeleton"
- **Inventory at reconnect**: stone_axe, stone_sword, stone_pickaxe x2 (kept due to keepInventory). Food=0.
- **Contributing Factors**: No food in inventory, likely hunger=0 so HP recovery impossible. Skeleton ranged attack.
- **Status**: Reported

## [2026-03-25] Bug: Session 70c - Death x2 by Zombie (dawn mob lingering at Y=103-109)

- **Cause**: Bot respawned at high mountain Y=109 at dawn. Zombie killed bot twice while transitioning to day (dawn zombies don't burn until full sunlight). Bot had stone tools from Phase 3 and was checking for iron_ore when killed.
- **Coordinates**: (3, 109, -3)
- **Last Actions**: gather(iron_ore) call → instantly returned (no iron nearby) → [Server] Claude1 was slain by Zombie. Same pattern x2 in quick succession
- **Error Message**: "Claude1 was slain by Zombie" x2
- **Contributing Factors**: High mountain spawn point (Y=103-109) with hostile mobs lingering at dawn; no armor equipped; gather() returned immediately instead of searching for iron
- **Post-death**: Respawned HP=20 Hunger=20 (keepInventory). Stone tools retained.
- **Status**: Reported

## [2026-03-25] Bug: Session 70b - Death by Zombie while navigating with HP=5.5 Hunger=0

- **Cause**: Bot was navigating to find food animals (sheep at -133,75,188) with HP=5.5, Hunger=0 from starvation. Zombies spawned nearby during navigation in old_growth_birch_forest. Bot killed by zombie.
- **Coordinates**: (~-89, 109, 135)
- **Last Actions**: mc_reload (ESM cache fix) → connect → flee(creeper) → navigate(sheep) → zombie encounter → death
- **Error Message**: "Claude1 was slain by Zombie"
- **Contributing Factors**: HP=5.5 from prior starvation; no food obtained all session; old_growth_birch_forest had no cows within 300 blocks; night mob spawns
- **Post-death**: Respawned HP=20 Hunger=20. Items retained via keepInventory.
- **Status**: Reported

## [2026-03-25] Bug: Session 70 - combat() zero drops STILL broken after 627a514 fix

- **Cause**: After mc_reload applying commits 627a514 (food drop fix) and f04fb2a (moveTo fix), combat() still produces ZERO drops for ALL mob types. Tested: cow x4, pig x2, sheep x1, chicken x1, zombie x2, drowned x1, skeleton x1 - total drops = 0 items. Only exception: skeleton previously gave arrows (pre-existing count), but all drops still broken.
- **Coordinates**: (-19, 83, 43)
- **Last Actions**: Session start → mc_reload x3 → connect → combat(cow/pig/sheep/chicken/zombie/drowned/skeleton) → zero drops every time
- **Error Message**: No errors - combat() silently succeeds with no items
- **Status at report**: HP=5.5, Hunger=0, starvation imminent. Underground Y=41-58 for most of session, finally reached surface Y=83-84
- **Critical**: The 627a514 fix applied to inventoryBefore timing + stationary bot + raw_* names is NOT working in runtime. Items are still not being collected after mob kills.
- **Pattern**: Zero drops is consistent across all mobs, suggesting a deeper issue - possibly the item pickup is still broken (stationary bot issue still present), OR the items are dropping in a place the bot can't reach, OR mc_reload is not properly applying the fix
- **Root Cause Analysis** (code review - Session 70):
  1. **ESM module caching**: Node.js caches ES Modules by URL. `mc_reload` called `import(url + '?v=' + timestamp)` for `core-tools.js` and `high-level-actions.js` but NOT for `bot-manager/bot-survival.js` or `bot-manager/bot-items.js`. `BotManager.fight()` and `.attack()` used static import bindings (`fightBasic`, `attackBasic`) that point to the original startup-cached `bot-survival.js`. No matter how many times `mc_reload` was called, `fight/attack` executed the OLD (pre-627a514) code.
  2. **Cascade via bot-survival.ts static import**: Even if `bot-survival.js?v=XXX` were loaded fresh, its own `import { collectNearbyItems } from './bot-items.js'` would still resolve to the cached (pre-627a514) `bot-items.js` — meaning the `inventoryBefore` parameter support added in 627a514 would be absent.
- **Fix Applied**:
  1. `mc_reload` (`src/index.ts`): added `bot-manager/bot-survival.js` and `bot-manager/bot-items.js` to the reload module list. Also calls `bumpBotManagerVersion()` after reloading.
  2. `BotManager.fight()`/`.attack()` (`src/bot-manager/index.ts`): changed from static binding to dynamic import via `_importBotSurvival()`. After `bumpBotManagerVersion()`, these methods import the freshly loaded `bot-survival.js?v=XXX`.
  3. `bot-survival.ts`: replaced static `import { collectNearbyItems, equipArmor } from './bot-items.js'` with dynamic wrapper functions that call `_getBotItems()`. `_getBotItems()` uses `bot-items.js?v=XXX` after `_setBotItemsVersion(v)` is called. `_setBotItemsVersion` is exported and called from `bumpBotManagerVersion()` in index.ts.
  4. Result: after `mc_reload`, the entire `fight() → collectNearbyItems()` chain uses the freshly loaded code, not the startup-cached version.
- **Status**: Fixed (commit pending).

## [2026-03-25] Bug: Session 69c - Bot drowned at Y=58 underground

- **Cause**: Bot was repeatedly navigating underground to Y=58 area near water. moveTo() consistently failed to navigate to far coordinates (100,73,100), instead moving the bot TOWARD the same underground water area each time. Eventually the bot ended up submerged in water at Y=58 with HP=4.5. forceEscape detected 4/4 solid sides (underwater), dug through, but bot respawned after drowning.
- **Coordinates**: (48, 58, 22)
- **Last Actions**: moveTo() x5 large targets all failed → navigate("item") → reconnect → flee → forceEscape → [Server] Claude1 drowned
- **Error Message**: "Claude1 drowned" + "[wait] ABORTED: oxygen depleting underwater with HP=4.5"
- **Contributing Factors**: Items lost from inventory (iron_axe, crafting_table disappeared), combat drops still broken pre-reload
- **Pattern**: moveTo() consistently moves bot TO THE SAME UNDERGROUND WATER LOCATION regardless of target coordinates. This suggests the water area is near spawn point and pathfinder routes through it.
- **Status**: Reported

## [2026-03-25] Bug: Session 69b - Total food system failure, bot starving to death

- **Cause**: ALL food acquisition APIs are completely broken: (1) bot.combat() for all mob types (cow/sheep/pig/chicken/zombie/spider/skeleton) returns success but ZERO drops in inventory. (2) bot.gather("wheat") finds wheat crops but returns no wheat item - only adds to wheat_seeds. (3) bot.gather("sugar_cane") finds sugar cane but returns nothing. (4) bot.craft("bread") silently fails with no wheat. (5) bot.farm() times out at 120s. No food can be acquired through any API.
- **Coordinates**: (66, 74, 35)
- **Last Actions**: Session started with HP=20 Hunger=20 (post-respawn). combat() x7 mob types = 0 drops. navigate(wheat) → gather(wheat,10) = 0 wheat items. farm() = timeout. craft(bread) = silent fail. reconnect() = no hunger reset. Bot starved from Hunger=20 → Hunger=0 over ~30 minutes.
- **Error Message**: "Claude1 starved to death" (anticipated - Hunger=0, HP=8.5 and falling)
- **Root Cause Hypothesis**: keepInventory gamerule or some server config may have caused item collection to stop working entirely. Or the bot's item pickup/collection code has a regression that prevents any item from being added to inventory via drop pickup or harvest.
- **Critical Note**: gather() correctly navigates to blocks and mines them (cobblestone count changed: was 60, gained some from gather) BUT food items don't appear. Stone/cobblestone from gather() DO appear in inventory. ONLY food/mob drops are affected.
- **Root Cause Analysis** (code review - Sessions 67-69):
  1. **`inventoryBefore` timing bug** (bot-items.ts + bot-survival.ts): `collectNearbyItems()` captured `inventoryBefore` at function entry, AFTER `fight()`/`attack()` had already waited 1s (`itemSpawnDelay`). During that 1s wait, Mineflayer auto-collects nearby items (Minecraft's 10-tick pickup delay = 0.5s). Items picked up during `itemSpawnDelay` were already counted in `inventoryBefore` → `actuallyCollected = 0` → "No items nearby" despite items being in inventory. Fix: capture `inventoryBefore` BEFORE `itemSpawnDelay` in `fight()`, `attack()`, and bow-kill paths, then pass as `options.inventoryBefore` to `collectNearbyItems`.
  2. **Stationary bot after GoalNear stops** (bot-items.ts): `GoalNear(pos, 1)` stops pathfinder when within 1.5 blocks of item. At that point, bot is STATIONARY — Minecraft server requires physical bot movement to trigger item auto-pickup. Fix: added explicit 600ms sprint-through-item when `reachedItem=true` and item entity still exists.
  3. **`EDIBLE_FOOD_NAMES` pre-1.13 names** (minecraft-utils.ts): Set had `"beef"`, `"porkchop"`, `"chicken"` etc. — pre-1.13 names. Minecraft 1.13+ flattening renamed these to `"raw_beef"`, `"raw_porkchop"`, `"raw_chicken"`. Auto-eat after kills never triggered because raw meat items didn't match the set. Fix: added `raw_*` variants.
  4. **`mc_farm()` far-water `moveTo` timeout** (core-tools.ts): 200-block water search called `botManager.moveTo()` without `Promise.race` timeout, causing 120s+ hangs. Fix: wrapped in `Promise.race` with remaining farm budget.
- **Fix Applied** (commit pending): All 4 fixes applied to bot-items.ts, bot-survival.ts, minecraft-utils.ts, core-tools.ts.
- **Status**: Fixed.

## [2026-03-25] Bug: Session 69 - Bot killed by Zombie during farm() timeout + combat() drops broken

- **Cause**: Two compounding bugs caused death: (1) bot.farm() timed out after 120s without returning, leaving bot exposed to mobs. (2) bot.combat() for cow/sheep/pig/chicken all find the animals successfully but ZERO food drops appear in inventory after kills. All 4 animal types affected - navigate() finds them, combat() succeeds, but no raw_beef/raw_chicken/etc in inventory afterward. Bot died from Zombie at Y=60 while farm() was blocking.
- **Coordinates**: (-35, 60, 37)
- **Last Actions**: reconnect → forceEscape x3 → flee → navigate(cow/sheep/pig/chicken) x4 → combat x4 (no drops) → farm() → TIMEOUT (120s) → [Server] Claude1 was slain by Zombie
- **Error Message**: "Claude1 was slain by Zombie" in chat
- **State at death**: HP=6.3, Hunger=0, all food hunting failed due to combat drop bug
- **Key Bug**: combat() NEVER yields ANY drops for ANY mob. Tested: cow, sheep, pig, chicken, zombie, spider, skeleton - ALL produce zero drops. This is NOT just passive mobs - ALL mob types affected. String x2 and arrows x3 in inventory are pre-existing from earlier sessions. This is the same bug reported in Session 67 but still not fixed, and now confirmed to affect hostile mobs too.
- **Secondary Bug**: farm() hangs indefinitely (120s+ timeout). Does not complete or return.
- **Root Cause Analysis**: See Session 69b entry above (same compounding bugs). `inventoryBefore` timing + stationary bot after GoalNear + EDIBLE_FOOD_NAMES wrong names + farm() missing timeout.
- **Status**: Fixed.

## [2026-03-25] Bug: Session 68 - Bot permanently stuck at Y=72, moveTo/navigate/flee all return with zero displacement

- **Cause**: After reload (commit ea6cf7d + b0eddfc applied), bot spawned at Y=74-75 on a pillar. flee(80) doesn't move the bot at all (X stays at ~12, Y stays at 72). moveTo() with targets at Y=64-68 (even 100+ blocks away) all return with Y=72. Placed 10-step staircase (X=13-22, Y=71-62) but walking the staircase steps also returns Y=72 every time. The bot is completely frozen in horizontal movement - X doesn't change either (12.6 throughout).
- **Coordinates**: (12.6, 72, -6.3)
- **Last Actions**: mc_reload → mc_connect → flee(80) → moveTo() x6 far positions → place() staircase x10 → moveTo() staircase steps x10 → navigate() x3 → gather() x5 → all return without position change
- **Error Message**: No errors thrown. All navigation APIs succeed instantly with no movement. X coordinate stays at 12.6 entire session.
- **State**: HP=9.3, Hunger=0, entities: enderman:2, zombie:3, creeper:2, skeleton:5, drowned:1, bat:5
- **Root Cause Analysis** (code review):
  1. **Self-built cage**: Session 67 bot pillarUp'd to Y=75, stayed at (12,75,-7). Session 68 agent placed a 10-step staircase at X=13-22, Y=71-62. Combined with the original pillar column, this formed a closed enclosure around the bot at Y=72. flee(canDig=false) counted all 8 flee directions as obstructed (staircase blocks + pillar on adjacent sides), collapsed distance to 5 blocks, pathfinder found no 5-block path inside the enclosure → 0 displacement every call.
  2. **moveTo instant abort**: skeleton x5 within 16 blocks triggered `ranged_mob_danger` check at 500ms, aborting every moveTo call before the pathfinder could compute a path.
  3. **mc_reload doesn't fix pathfinder deadlock**: mc_reload reloads TypeScript modules but does NOT disconnect/reconnect the bot. The Minecraft server entity stays at Y=72, pathfinder state is preserved (deadlocked). A reconnect would have created a fresh entity and cleared the deadlock.
- **Fix Applied** (commit 546d4f6):
  1. `flee()` surface cage last resort: after all directional retries fail at Y>=65 with <5 blocks moved, detect cage by counting solid sides (≥3/4 sides blocked at feet+head level). If caged: manually dig through lowest-hardness wall, then sprint+jump through the gap. If not caged but frozen: bypass pathfinder via raw setControlState(forward+sprint+jump) toward each open direction.
  2. `bot.forceEscape()` in mc-execute sandbox: new bot API agents can call when all navigation returns 0 displacement. Detects cage, digs out, falls back to recommending reconnect.
  3. `bot.reconnect()` in mc-execute sandbox: exposes mc_reconnect() (disconnect+reconnect) as a bot API. Resets bot entity, server-side position sync, and pathfinder state. Solves the "mc_reload didn't fix the freeze" problem from all 3 sessions.
- **Status**: Fixed.

## [2026-03-25] Bug: Session 67 - Bot stuck on pillar at Y=75 surrounded by mobs, all movement blocked, Hunger=0 starvation

- **Cause**: Bot pillarUp'd to Y=75 (birch_forest) to escape night mobs, but mobs persisted into daytime. drowned kept triggering wait() abort, preventing movement. moveTo() returns instantly without movement when mobs nearby.
- **Coordinates**: (12, 75, -7)
- **Last Actions**: pillarUp(10) → wait(20000) aborted by drowned → combat(drowned) failed to kill → moveTo(210, 72, 193) returned instantly without movement
- **Error Message**: moveTo returns in <1s with no position change. wait() aborted repeatedly by drowned at 7-8 blocks.
- **State**: HP=9.3, Hunger=0, 15 mobs nearby (enderman:1, zombie:3, creeper:3, skeleton:2, drowned:1, bat:2)
- **Root Cause Hypothesis**: moveTo() is being blocked by mob safety checks (creeper x3 + skeleton x2 nearby). Bot is stuck because: 1) can't move due to mob checks, 2) can't eat (no food), 3) can't combat (drops not registering), 4) pillarUp is the only working API but barely.
- **Bug Pattern**: Same as Session 66 - mob cluster + movement block = total immobility. Starvation death likely.
- **Impact**: Bot will die from hunger in ~5 minutes without intervention.
- **Root Cause Analysis** (code review):
  1. `post-pillar descent race condition` (bot-movement.ts): The descent interval checked `!bot.pathfinder.isMoving()` at 300ms after setGoal(). Pathfinder needs 500-1500ms to compute a path from pillar top. isMoving() was false at the first check → interval exited with 0 movement → bot stayed stuck on pillar. The previous fix from commit 73caabd added the descent code but introduced this subtle race condition.
  2. `wait() missing vertical clearance` (mc-execute.ts): midWaitClosestDist used 3D distance. Drowned at Y=68 with bot at Y=75 = 7 blocks 3D distance, triggering abort every 500ms even though the drowned cannot melee the bot on the pillar. Same problem as moveTo's melee check, but wait() had no vertical exception.
- **Fix Applied** (commit b0eddfc):
  1. `pillarUp() post-descent`: Added `descentElapsed > 2000` guard before using `!isMoving()` as exit condition (same pattern as flee()'s elapsed > 2000). Also added `flee(20)` as fallback when pathfinder descent moves < 1 block — flee's multi-retry/elevated-terrain logic handles pillar tops better than raw setGoal().
  2. `wait() hostile check`: Added `vertOffset >= 4` skip for mobs ≥4 blocks below the bot (same exception as moveTo check B2). Prevents repeated abort loops when bot is safely elevated on a pillar.
- **Status**: Fixed.

## [2026-03-25] Bug: Session 67 - combat() not yielding drops

- **Cause**: bot.combat() for cow/pig/chicken/sheep returns success but no food drops appear in inventory
- **Coordinates**: (12, 72, -7)
- **Last Actions**: navigate(cow) → combat(cow) → inventory check shows no raw_beef/cooked_beef
- **Error Message**: No error thrown, but inventory unchanged after combat
- **Status**: Reported

## [2026-03-25] Bug: Session 66 - Bot completely stuck at Y=56, all movement/combat APIs non-functional

- **Cause**: All navigation/escape APIs failing silently. moveTo(), flee(), pillarUp(), combat() all return instantly without movement or effect.
- **Coordinates**: (-1, 56, 2)
- **Last Actions**: Attempted moveTo(100,65,100), pillarUp(10), flee(50), combat("skeleton") - all failed without error, bot stays at same position Y=56
- **Symptoms**:
  - moveTo() returns in 3 seconds without movement
  - flee() returns in 56 seconds without movement
  - pillarUp() returns in 50 seconds without Y change
  - combat() returns instantly, no entity kills, skeleton count unchanged
  - wait() aborted immediately by "skeleton at 0.4 blocks"
  - arrow x20 in nearbyEntities shows bot is being shot continuously
- **Environment**: Y=56 (underground), surrounded by skeleton x3, zombie x2, creeper x4, drowned x1
- **HP**: 15.5, Hunger: 14
- **Impact**: Bot cannot escape, cannot fight, cannot farm. Completely immobilized.
- **Root Cause Hypothesis**: Bot may be in a cave/enclosed space blocking pathfinder. Skeletons preventing all wait() calls. Possible pathfinder deadlock similar to Session 65 bug.
- **Root Cause Analysis** (code review):
  - `combat()`: Hard REFUSED because `creeper x4` within 8 blocks (per-spec REFUSED, intentional)
  - `moveTo()`: ranged_mob_danger fires at 500ms for skeleton at 0.4 blocks (armorCount<=2, skeleton within 16 blocks). Aborts every call.
  - `flee()`: `canDig=false` means pathfinder cannot route through stone cave walls at Y=56. Pathfinder finds no path. All direction retries also fail (canDig=false).
  - `pillarUp()`: Hits 5s dig timeouts on thick cave ceiling (4+ solid blocks above). Burns the 45s global timeout without any Y gain.
- **Fix Applied** (commit after 0ccb7e4):
  1. `pillarUp()`: Underground (Y<65) + 4+ solid blocks above → immediately delegate to `emergencyDigUp()` instead of slow jump-place loop
  2. `flee()`: Underground (Y<65) → enable `canDig=true` for initial pathfinding AND directional retries, so pathfinder can dig through cave walls
  3. `flee()`: After all retries fail (moved <5 blocks) AND underground → call `emergencyDigUp()` as last resort
- **Status**: Fixed.

---

## [2026-03-25] Bug: Death by Skeleton (HP=2 from Hunger=0 starvation) - Session 65 death #2

- **Cause**: HP=2 from hunger damage (Hunger=0 for extended period). While moving (Z-direction exploration), skeleton shot bot. "Claude1 was shot by Skeleton". HP too low to survive one arrow.
- **Coordinates**: (-3, 50, 20) approx
- **Last Actions**: moveTo() Z-direction exploration → skeleton attack at HP=2
- **Root Cause**: Hunger=0 reduced HP to dangerous level. Combined with hostile mob encounter, resulted in death. No food available to recover.
- **Contributing factors**: moveTo non-functional prevented escape from spawn area; gather() timeouts prevented wood/food collection; no animals near spawn.
- **Status**: Reported. Session 65. Death #2.

---

## [2026-03-25] Bug: moveTo() non-functional near spawn (-10,82,13) - Session 65 CRITICAL

- **Cause**: bot.moveTo(x, y, z) called with coordinates far away (200m+). Bot stays at (-10, 82, 13). moveTo(200,82,0), moveTo(0,82,0), moveTo(-100,82,-100) all leave bot at same position. Short moves (< 5 blocks) show tiny movement.
- **Coordinates**: (-10, 82, 13)
- **Symptoms**: gather() timeouts (can't reach target), navigate() immediate return without movement, pillarUp() timeout or no Y change, bot stuck near (-10, 82, 13)
- **Root Cause**: Pathfinder fails silently - no path found from current position, moveTo returns without error or movement. Possibly terrain around spawn blocks all paths.
- **Impact**: Bot cannot gather food, wood, or escape night hostiles. HP=10, Hunger=0, stuck.
- **Fix Needed**: moveTo should throw error if no path found. Debug pathfinder from (-10, 82, 13).
- **Status**: Reported. Session 65. CRITICAL BLOCKING.

---

## [2026-03-25] Bug: Bot drowned at Y=46 underground (water pocket) - Session 65 death

- **Cause**: Bot was stuck at Y=46 underground. dig(px, py+10, pz) failed with "Digging aborted" (hit water block). Bot was in or near an underground water pocket. Server: "Claude1 drowned".
- **Coordinates**: (6, 46, 3)
- **Last Actions**: Sequential bot.dig from Y+1 to Y+9 succeeded, then Y+10 failed with "Digging aborted" (water). Bot drowned in water pocket.
- **Error**: "[Server] Claude1 drowned"
- **Root Cause**: Underground water pocket at Y=56 area. bot.dig hit water block, water flowed into bot's location. No way to detect water before digging.
- **Fix Needed**: bot.dig should check for water blocks before digging adjacent to them. Or, provide a way to check block type before digging.
- **Status**: Reported. Session 65. Death.

---

## [2026-03-25] Bug: pillarUp() always times out underground - Session 65 CRITICAL

- **Cause**: bot.pillarUp(30) called at Y=57-66 underground. Cobblestone available (135 blocks). Method either times out (120s) or completes but bot Y doesn't change. Even after placing cobblestone at feet first, pillarUp still times out.
- **Coordinates**: (7.5, 57, 4.5)
- **Last Actions**: pillarUp(30) → 50s timeout → Y=57 unchanged. pillarUp(20) → timeout → Y unchanged. pillarUp(5) → timeout.
- **Error**: "Execution timed out after Xs" OR completes but Y stays same
- **Root Cause**: pillarUp appears to place block at Y-1 (feet) but bot doesn't actually move upward. Scaffold placement loop may be checking wrong conditions or bot is unable to jump underground (ceiling too low? invalid terrain?).
- **Impact**: Bot stuck underground at Y=57-62 with HP=7.5, food=0, night, creepers x5. Cannot escape.
- **Fix Needed**: pillarUp should: 1) check clearance above, 2) dig ceiling if needed, 3) use reliable jump+place loop
- **Status**: Reported. Session 65. BLOCKING - bot cannot escape underground.

---

## [2026-03-25] Bug: bot.flee() navigated through lava - Session 65

- **Cause**: bot.flee() was called when HP=2.3 at y=37 (underground). Bot tried to swim in lava during escape. Server message: "Claude1 tried to swim in lava". Bot survived (HP went to 20 after escape to y=90), but lava navigation is dangerous.
- **Coordinates**: (-9.7, 37.0, 12.0)
- **Last Actions**: flee(30) → lava contact → escaped to y=90
- **Error**: "[Server] Claude1 tried to swim in lava"
- **Root Cause**: bot.flee() pathfinding does not avoid lava blocks. When underground with hostiles, flee may route through dangerous terrain.
- **Fix Needed**: flee() should treat lava as impassable/high-cost terrain during pathfinding.
- **Status**: Reported. Session 65.

---

## [2026-03-25] Bug: Death by zombie during bot.build("shelter") - Session 64 death #2

- **Cause**: Bot at (1.9, 92, -7.9) HP=15.2 Hunger=20 (admin feed active). bot.build("shelter") call timed out after 60s. During timeout, zombie attacked and killed bot. Bot had no armor equipped.
- **Coordinates**: (1.9, 92, -7.9)
- **Last Actions**: build("shelter") → timeout 60s → slain by zombie
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Root Cause**: build() timed out (60s limit), leaving bot vulnerable in place. No armor = full damage from zombie. This is the back near the spawn cliff area where hostiles are constantly present.
- **Fix Needed**: build() should have shorter timeout, or bot should flee before building if hostiles nearby.
- **Status**: Reported. Session 64 death #2.

---

## [2026-03-25] Bug: Bot trapped at y=36-50 cave - all escape methods fail - Session 64 SEVERE

- **Cause**: Bot fell to y=36 (from y=50 underground). tunnel("up") sent bot DOWN to y=36. tunnel("north/south/east/west") all kept bot at y=36. navigate() to all block types returns y=50 blocks (underground grass/dirt). pillarUp fails "no solid ground". gather(stone) returns 0. All movement stays within y=36-55 zone. HP=2.3 from hostiles/starvation.
- **Coordinates**: (-3.7, 36, 13.1)
- **Last Actions**: tunnel("up") → y=36 (went down!), all directions tunnel → y=36, all gather → y=40 (no change)
- **Root Cause**: Bot is in an enclosed cave at y=36-55 that has no pathfindable exit. The cave has grass_block/dirt blocks at y=50 (cave ceiling/floor). All pathfinding leads to these underground blocks. pillarUp fails because either cave ceiling blocks movement, or no "solid ground" detected correctly underground.
- **Fix Required**:
  1. tunnel("up") should actually dig UPWARD (positive Y) not move bot down
  2. pillarUp() needs to detect cave ceiling and dig through it
  3. Alternatively: admin /tp is truly the only solution
- **Status**: SEVERE. Session 64. Bot trapped underground for >30 minutes.

---

## [2026-03-25] Bug: Drowned during wait() loop - Session 64 death #6

- **Cause**: Bot at (-2,90,5) HP=20 waiting for dawn. Drowned during wait interval. The wait() auto-flee moved bot into water nearby. This is the 3rd drowning in this session.
- **Error**: "[Server] Claude1 drowned"
- **Status**: Reported.

---

## [2026-03-25] Bug: Death by zombie - Session 64 death #5

- **Cause**: Bot HP=20 during midnight wait at (4.5,94,8.5). Slain by zombie during wait interval.
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Status**: Reported.

---

## [2026-03-25] Bug: Death by zombie - Session 64 death #4

- **Cause**: Bot HP=20 during midnight wait, zombie killed during server-side movement. Position changed from (4.5,94,8.5) to somewhere else between wait iterations.
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Status**: Reported. Session 64 death #4.

---

## [2026-03-25] Bug: Spawn area terrain prison - all paths return to x=0-10,z=-10-5 - Session 64 ROOT CAUSE

- **Cause**: pathfinder cannot find any path AWAY from spawn area (x=0-30,z=-25 to 10). ALL movement functions (moveTo, navigate, flee, gather) return the bot to the same spawn center within 100 blocks. moveTo(200,70,200) → arrived at (4,65,-3). flee(200) → moved 0.1 blocks. This is the ROOT CAUSE of all prior stuck-at-cliff bugs.
- **Evidence**: Tested moveTo to (50,70,50), (100,70,100), (150,70,150), (200,70,200) - all arrived within (0-5, 64-70, -8 to 5).
- **Fix Required**: Admin /tp to plains biome (x=300,y=70,z=300) AND change spawn point. OR pathfinder larger search radius.
- **Status**: CRITICAL ROOT BUG. Session 64.

---

## [2026-03-25] Bug: bot.navigate() ALWAYS returns 0.0 distance - Session 64 CRITICAL

- **Cause**: bot.navigate({type:'entity',name:'cow'}) and bot.navigate({type:'block',name:'iron_ore'}) both return immediately without moving the bot. Distance moved = 0.0 in ALL cases. navigate("furnace") worked once (moved 3 blocks) but navigate with object type never moves bot.
- **Coordinates**: Tested at multiple positions: (10.3,100,-0.5), (39.7,76,-2.5), (8.7,92,9.8)
- **Evidence**: "Navigate cow: moved 0.0 blocks", "Navigate iron: moved 0.0 to same pos"
- **Root Cause Theory**: navigate() with {type:'entity/block', name:...} format may not be the correct API call format, OR pathfinder fails to find entities/blocks, OR navigate() crashes silently.
- **Impact**: Cannot reach animals for food. Cannot reach iron ore. Cannot make any gameplay progress.
- **Status**: CRITICAL. Session 64.

---

## [2026-03-25] Bug: bot.flee() moves toward more hostile mobs - Session 64

- **Cause**: flee(250) from position (-15,72,-4) with 3 threats → moved to (2,72,-4) with 6 threats. flee() is running TOWARD more mobs instead of away. This is extremely dangerous (HP dropped from 7 to near-death).
- **Expected**: flee() should find direction away from all mobs and move there
- **Actual**: flee() navigated toward spawn area (x=0,z=0) which has highest mob density
- **Status**: CRITICAL BUG. Session 64.

---

## [2026-03-25] Bug: Bot drowned - moveTo navigated into water - Session 64 death #3

- **Cause**: moveTo(4,82,14) sent bot to (1,95,18) instead. Bot drowned. The pathfinder navigated through/into water while trying to reach chest.
- **Coordinates**: (1, 95, 18) — water location near spawn
- **Last Actions**: moveTo(4,82,14) → arrived (1,95,18) → drowned
- **Error**: "[Server] Claude1 drowned"
- **Root Cause**: moveTo() is pathfinding through water. Bot cannot swim. Pathfinder should avoid water blocks when bot has no water breathing potion.
- **Status**: Reported. Session 64 death #3.

---

## [2026-03-25] Bug: bot.combat() NEVER drops food - All sessions - CRITICAL

- **Cause**: bot.combat() against cow/pig/chicken/sheep/zombie returns 0 food drops in ALL sessions. bot.navigate({type:'entity',name:'cow'}) confirms it finds and reaches the animal (position changes), but after combat(), inventory has no new food items. This is not related to gamerule (doMobLoot is TRUE per earlier confirmation). The combat() API kills mobs but doesn't collect drops.
- **Evidence**: Session 64 - tested cow/pig/sheep/chicken/zombie at multiple locations, all 0 drops after combat().
- **Expected**: raw_beef, raw_porkchop, raw_chicken etc. should appear in inventory after combat.
- **Actual**: Zero food items added to inventory after any animal combat.
- **Impact**: Bot CANNOT get food naturally. Relies entirely on admin /feed.
- **Status**: CRITICAL ONGOING. All sessions. Needs urgent fix to item pickup in combat API.

---

## [2026-03-25] Bug: moveTo/navigate silently fails for long distances - Session 64

- **Cause**: bot.moveTo(x+200, y, z+200) only moves 1-3 blocks instead of 200. No error thrown. bot.navigate({type:'entity',name:'cow'}) "finds" target but doesn't move bot far (position changes by <10 blocks then returns success). bot.navigate({type:'block',name:'iron_ore'}) navigates bot to same position and gather() returns 0 items. Pathfinder silently fails for anything beyond ~10 blocks.
- **Coordinates**: Multiple locations: (26,77,-6), (51,95,3), (88,70,90), (78,71,79)
- **Evidence**: moveTo(278,70,277) from (78,71,77) → arrived at (78,71,79). moveTo(126,77,-6) from (26,77,-6) → arrived at (29,77,-7).
- **Impact**: Bot cannot explore, cannot find food/resources, cannot make progress on any phase.
- **Root Cause Theory**: Pathfinder path limit too short, or terrain blocks all paths, or there is a max-distance cap on pathfinding that is too small (~10 blocks?).
- **Status**: CRITICAL. Pathfinder distance bug. Session 64.

---

## [2026-03-25] Bug: Death by zombie - HP=1.5 no food recovery - Session 64

- **Cause**: Bot at (-14.7, 72.6, -2.4), HP=1.5 (zombie attack). No food items in inventory. bot.combat() does not drop food from any animal (cow/chicken/pig/zombie - all 0 drops). bot.eat() cannot eat because no food. bot.flee() moved bot to y=101 with HP=20 (admin refill again). Then slain by zombie.
- **Coordinates**: (-14.7, 72.6, -2.4) at time of critical HP
- **Last Actions**: flee(50) → HP became 20 briefly → "Claude1 was slain by Zombie"
- **Error Message**: "[Server] Claude1 was slain by Zombie"
- **Root Bug**: bot.combat() NEVER drops food items from any animal type. This has persisted across all sessions. Without food drops, hunger cannot be managed naturally.
- **Status**: Reported. Session 64 death #1.

---

## [2026-03-25] Bug: Bot STILL stuck at cliff (26,83,-3) after wait() fix - Session 64 ONGOING

- **Cause**: After wait() fix (67e5137), bot reconnected at HP=1, Hunger=0, same cliff location (26.7,83,-2.3) as Sessions 58-63. wait() no longer aborts BUT movement still completely fails: moveTo/flee/navigate/pillarUp ALL return bot to same position. bot.gather() works (slight position shifts 0.5-1 block) but bot cannot leave the cliff zone. 17 hostiles nearby (skeleton x4, creeper x9-10, zombie x1, drowned x1, spider x1). Survived night at HP=1 (hostiles not killing = confirmation of terrain trap).
- **Coordinates**: (26.7, 83, -2.3) — SAME cliff zone as Sessions 58-63
- **Last Actions**:
  1. mc_reload after connection
  2. flee(50) → no movement
  3. pillarUp(8) → Y unchanged (44s spent)
  4. navigate('cow') → combat('cow') → 0 food drops
  5. moveTo(100,83,100) → no movement
  6. step-by-step moveTo → all fail, return to (26,83,-3)
  7. Waited full night (ticks 13813→23933 = ~2.5 hours game time)
  8. navigate('furnace') → no movement
  9. navigate('coal_ore') → position shifted 0.2 blocks only
  10. gather('coal_ore') → slight position shift only
  11. farm() → no wheat, no food
- **Root Cause**: Pathfinder CANNOT navigate from this terrain. Bot stands on/near cliff edge. pathfinder finds no valid path away. moveTo silently "succeeds" without moving. wait() fix did NOT fix movement — the problem is deeper in pathfinder terrain handling.
- **Critical**: 7+ consecutive sessions (58-64) stuck at same cliff. Admin /tp + /feed REQUIRED to escape this terrain trap. Code fix needed: pathfinder must handle no_path gracefully with jump/place-block fallback, OR spawn point must be changed.
- **Status**: CRITICAL ONGOING. Session 64.

---

## [2026-03-25] Bug: wait() HP=1 abort makes ALL movement impossible - Sessions 58-63 CRITICAL ROOT CAUSE

- **Cause**: bot.wait() aborts at HP<3 even when HP is STABLE at 1.0. This creates an infinite loop: HP=1 → wait() aborts → no movement possible → no food → no HP recovery → HP stays at 1. ALL movement APIs (flee, moveTo, pillarUp, setControlState) use wait() internally and fail. The only way to move is without wait(), but the sandbox has no setTimeout/setInterval.
- **Coordinates**: (26.3, 83, -2.5) — same cliff zone Sessions 58-63
- **Root Cause**: wait() function has `if (hp < 3) abort` check. At HP=1 (stable, not dropping), this fires every single time regardless of actual danger. Bot cannot move AT ALL when HP=1.
- **Fix Required**: In bot.wait(): if HP is stable at 1 (same as previous check), do NOT abort. Only abort if HP is actively dropping (hpDroppedSinceStart > 0). The stable HP=1 case means minecraft's natural half-heart protection — bot is not in active danger.
- **Evidence**: 7 sessions (58-63) all stuck at same location. wait() shows "ABORTED: HP dropped to 1.0" even though HP is STABLE at 1.0 (not dropping).
- **Status**: CRITICAL ROOT BUG. Needs code fix to wait() in mc-execute.ts/core-tools.ts

---

## [2026-03-25] Bug: Bot stuck at cliff (26.5,83,-2.3) - HP=1, no food, all movement fails - Session 63

- **Cause**: Bot at (26.5, 83, -2.3), HP=1, Hunger=0, no food in inventory. SAME cliff area as Sessions 58-62. All movement APIs fail: moveTo, flee, navigate, pillarUp, setControlState all leave bot at same position. 7+ hostiles nearby (pillager x1, bat x11, skeleton x3, creeper x7, zombie x1, drowned x1, spider x1). combat('zombie') does not produce rotten flesh. ender_pearl in inventory but no API to throw it. wait() ABORTS immediately due to HP=1.
- **Coordinates**: (26.5, 83, -2.3) — same cliff zone as Sessions 58-62
- **Last Actions**:
  1. Connected with Claude1 — bot already at HP=1, Hunger=0 with no food
  2. flee(30) → no movement
  3. setControlState all directions + jump → no horizontal movement
  4. pillarUp(5) → Y unchanged
  5. moveTo(50,84,50) → returns to (26.5,83,-2.3)
  6. combat('zombie') → no rotten flesh dropped
  7. navigate('cow') → no movement
  8. placed cobblestone N/S/E/W → still can't move
- **Error Message**: "[wait] ABORTED: HP dropped to 1.0 during wait" — all wait() calls abort
- **Critical Issues**:
  1. Bot has been stuck at this specific cliff (26,83~86,-3) for Sessions 58-63 (6 sessions!)
  2. No food obtainable — combat drops nothing, no animals reachable
  3. moveTo pathfinder completely broken at this terrain — always returns to same spot
  4. HP=1 prevents any wait() calls from completing
  5. ender_pearl in inventory but no API to throw/use items directly
- **Status**: CRITICAL RECURRING. Session 63. Admin /tp + /feed required to escape. Root terrain bug at (26,83,-3) persists across all code fixes.
- **Suggested Fix**: Admin needs to /tp bot away from (26,83,-3) spawn point and /feed. Also: bot.use(item) or ender pearl throw API needed. Also: pathfinder must be fixed to not return to same stuck point.

---

## [2026-03-25] Bug: Bot STILL stuck at (26,84,-4) - moveTo always returns to same location - Session 62

- **Cause**: Bot at (26.5, 84, -3.7), HP=1, Hunger=0. mc_reload + reconnect performed (commit 5d42734 fix). moveTo(35,85,5), moveTo(26,84,0), moveTo(26,84,10) ALL return bot to (26,84,-4). Bot is stuck in pathfinder loop despite cobblestone placed at (25-29,84,-3), (26,84,-2 to 0). flee(20) also returns to same location.
- **Coordinates**: (26.5, 84.0, -3.7)
- **Last Actions**:
  1. mc_reload (build + hot-reload after 5d42734 fix)
  2. moveTo(35,85,5) → returns to (26,85,-4)
  3. Placed cobblestone at multiple locations around bot
  4. moveTo(26,84,0) → returns to (26,84,-4)
  5. moveTo(26,84,10) → returns to (26,84,-4)
  6. flee(20) → no movement
- **Error Message**: No error thrown but position never changes from (26,84,-4) regardless of target
- **Critical Issues**:
  1. moveTo always returns bot to same location (26,84,-4) — pathfinder may be using this as a "safe" spot
  2. HP=1 with no food, cannot recover
  3. Bot has been stuck at this cliff area for Sessions 58-62
- **Status**: CRITICAL - ONGOING. Additional findings from Session 62 continued:
  - pillarUp(3/6) → always times out (30s)
  - flee(30) → returns to same position (26,84,-3)
  - navigate({type:'entity',name:'cow',max_distance:200}) → no movement
  - navigate('cow'/'pig'/'sheep'/'chicken') → no movement
  - Morning phase (ticks=973) still has skeleton x3, creeper x7 nearby
  - combat('cow') → returns immediately, no food dropped (food drop bug confirmed again)
  - ALL movement APIs fail: moveTo, flee, navigate, pillarUp all return bot to (26,84,-3)
  - Root cause: pathfinder is completely broken at this specific terrain location
  - Admin /tp is REQUIRED to escape. Bot cannot self-rescue.

---

## [2026-03-25] Bug: Bot STILL stuck at cliff edge Y=86 - HP1 Hunger0 - pillarUp not working - Session 61

- **Cause**: Bot starts at (26.5, 86, -3.5) same birch_forest cliff area. HP=1, Hunger=0, no food in inventory. pillarUp(8) logs "executed" but Y stays at 86.0. bot.eat() returns but hunger stays 0 (no food items). bot.combat("cow") returns immediately with no food. wait() ABORTS immediately due to "HP dropped to 1.0". Night phase "midnight" persists for 1300+ ticks. Creeper x6-7, skeleton x3, zombie x2, drowned x1, spider x1 nearby.
- **Coordinates**: (26.5, 86, -3.5) - same cliff area as previous sessions
- **Last Actions**:
  1. bot.flee(30) → HP still 1, position unchanged
  2. bot.pillarUp(5) then pillarUp(8) → Y stays at 86.0 (not working)
  3. bot.eat() → hunger stays 0 (no food)
  4. bot.combat("cow") → returns immediately, no food
  5. bot.build("shelter") → success but HP still 1
  6. bot.wait(5000) → ABORTS "HP dropped to 1.0 during wait"
- **Error Message**: "[wait] ABORTED: HP dropped to 1.0 during wait — auto-fleeing from danger" x14 times
- **Critical Issues**:
  1. pillarUp does not change Y position (claimed "success" but Y unchanged)
  2. Night phase "midnight" persists abnormally long (1300+ ticks in this session alone)
  3. No food in inventory after multiple sessions - combat food drop bug persists
  4. HP cannot go below 1 but also cannot recover without food
  5. Bot is completely stuck with no way to get food or escape
- **Status**: CRITICAL. Bot survival is impossible without admin intervention. Need: /feed + /tp away from cliff + food items. Same location as Sessions 58-60.
- **Additional Findings (Session 61 continued)**:
  - bot.wait() ABORTS every time due to "HP dropped to 1.0" even during daytime (ticks 6093-6393)
  - Daytime (phase:day) started but mobs still attacking (creeper, skeleton in daytime = bug or mob behavior)
  - moveTo(27, 86, -4) always returns to (26.7, 86.0, -3.5) — pathfinder is completely unable to path from this exact location
  - cobblestone place() succeeds at nearby coords but moveTo after place() still fails
  - This is the SAME location (26.5-26.7, 86.0, -3.5 to -4.0) as Sessions 58-60 — the bot always spawns/ends up here
  - Root cause theory: The spawn/respawn point is set to this exact cliff edge location, and the pathfinder cannot navigate FROM this specific location (possibly the block structure prevents it)

---

## [2026-03-25] Bug: Bot still stuck at cliff edge Y=89 - moveTo/navigate/flee all fail - Session 60

- **Cause**: Bot is still stuck at same cliff edge (27, 89, -14) as Session 59. moveTo to 6 different far coordinates all return immediately without moving. navigate("cow"), navigate("chicken") return immediately. flee(50) returns without moving. Position stays at (27, 89, -14) regardless of command.
- **Coordinates**: (27, 89, -14) - same cliff edge in birch_forest biome as previous sessions
- **Last Actions**:
  1. moveTo(80, 89, -12) → position unchanged (27, 89, -14)
  2. moveTo(-30, 89, -12) → position unchanged
  3. navigate("cow") → returns in 447ms, position unchanged
  4. flee(50) → returns but position unchanged
  5. pillarUp(10) → "Failed to pillar up. No blocks placed" after 59s timeout
- **Error Message**: moveTo returns silently with no movement, pillarUp times out after 59s
- **Status**: CRITICAL - Bot survived at HP=1 for extended period but cannot escape. flee() always returns to (26.5,86,-3.5). Night has been ongoing for 3000+ ticks without ending (possible time bug or gamerule issue). Mob count constantly 14+ entities including creeper x5, skeleton x3-4, zombie, drowned, spider, pillager. Hunger=0 entire session, combat food drops still not working. Needs admin /tp + /heal + /feed OR code fix for: 1) pathfinder escape from cliff 2) food drops from combat 3) night ending normally.

---

## [2026-03-25] Bug: Bot completely stuck at cliff edge Y=90 - all actions timeout - Session 59

- **Cause**: Bot is stuck at cliff edge at Y=90-91. ALL navigation actions (moveTo, navigate, flee, gather, combat) timeout after 60-120 seconds without moving more than 1-2 blocks. cobblestone place() succeeded but subsequent moveTo fails.
- **Coordinates**: (27.5, 91.0, -10.1) - cliff edge in birch forest biome
- **Last Actions**:
  1. All moveTo attempts in 6 directions → position unchanged
  2. bot.pillarUp(4) → "success" but Y unchanged
  3. bot.navigate("chest") → position unchanged
  4. bot.flee(30) → timeout
  5. bot.gather("stone", 3) → timeout
  6. bot.gather("iron_ore", 8) → timeout
- **Error Message**: Execution timed out after 60000ms / 120000ms
- **Status**: Reported. Bot is completely unable to navigate from cliff edge. Likely pathfinder cannot find valid path. Need admin /tp or code fix to handle cliff-edge stuck state.

---

## [2026-03-25] Bug: bot.setControlState is not a function - Session 59

- **Cause**: `bot.setControlState('forward', true)` throws `TypeError: bot.setControlState is not a function` inside mc_execute sandbox. Admin instructed using setControlState to escape cliff, but the method is not exposed in the bot API object.
- **Coordinates**: (27.6, 90.0, -12.2) stuck on cliff at Y=90
- **Last Actions**: Tried all moveTo directions (6 directions) but position unchanged. Admin suggested setControlState as workaround.
- **Error Message**: `TypeError: bot.setControlState is not a function`
- **Status**: Reported. Need to expose bot.setControlState in mc_execute sandbox, or add bot.moveForward()/bot.jump() helpers.

---

## [2026-03-25] Bug: bot.combat() kills animals but NO food drops collected - Session 58

- **Cause**: bot.combat("cow"), bot.combat("chicken"), bot.combat("pig") all return success, but no food items (raw_beef, raw_chicken, raw_porkchop, etc.) appear in inventory after repeated kills.
- **Coordinates**: (28, 92, -10) in birch_forest biome
- **Last Actions**: Session 58. /tp脱出後にbot.combat("cow"), combat("chicken"), combat("pig")を各1回実行。全て即座にリターンするが食料ドロップなし。インベントリ変化なし。
- **Error Message**: No error thrown, just no items dropped/collected
- **Evidence**: Inventory before/after combat identical (21 item types, 0 food). wheat_seeds:54, cobblestone:114 unchanged.
- **Previous Session Note**: Session56バグ報告にも "bot.combat returns immediately without finding/killing animals" との記述あり。動物を本当に殺せているかも疑わしい。
- **Status**: Reported. Workaround: use bot.farm() with wheat_seeds instead.

---

## [2026-03-25] Bug: ALL movement/action tools non-functional - Session 57 (CRITICAL継続)

- **Cause**: Session56のバグが継続。Bot完全スタック at (29.7, 91, -6.5). pillarUp/gather("stone")/flee全てタイムアウト/失敗。
  - bot.moveTo(50, 92, -7): x方向移動0（29のまま）
  - bot.navigate({target_block:"iron_ore", max_distance:128}): "Path blocked" 到達不能
  - bot.gather("iron_ore", 16): 120sタイムアウト
  - bot.gather("stone", 10): 120sタイムアウト
  - bot.pillarUp(4): 60sタイムアウト
  - bot.flee(30): 位置変化なし
  - bot.build("shelter"): 120sタイムアウト
- **Coordinates**: Bot stuck at (29.7, 91, -6.5) in birch_forest biome. iron_ore最近距離: (68, 54, -14) at 54 blocks
- **Last Actions**: 夜間待機→朝に鉄採掘試みるも全失敗。前回置いたcobblestone壁が閉じ込めを悪化させた可能性あり。
- **Navigation Error**: "Navigation stopped after 2/2 segments: Cannot reach (18.15, 92, -52.87). Path blocked."
- **周囲の状況**: grass_blockがY=93-98に分布（丘の上）。石と土に完全に囲まれた地形。
- **Status**: Critical. Phase4鉄採掘完全停止。code-reviewerによる pathfinder根本修正が必要。
- **追加調査 (Session57)**:
  - 周囲地形: 東西南北のY=91は石(stone)。南(z=-4〜-6)は空気→dirtを設置可能。
  - 足元の南側(z=-6, y=90)は空洞(崖になっている)。
  - bot.craft()もタイムアウト(crafting_tableが近くにない)。
  - 再接続しても状況変わらず。
  - place()は南方向のみ機能。他は全てタイムアウトか即リターン。
  - bot.moveTo()は即座にリターン(965ms)、位置変化なし = pathfinder がパスなしと即判定。
  - **根本原因仮説**: ボットが石の塊(Y=90足元が石、東西北が石)に囲まれており、南方向には崖(y=90が空洞)があるため、pathfinderが有効な経路を見つけられない。落下を避けるためにどの方向にも動けないと判定している可能性。
  - **解決策候補**: pathfinderに落下許可オプションを渡す、またはforce-teleportでスタック位置から脱出させるリセット機能の追加。

---

## [2026-03-25] Bug: ALL movement/action tools non-functional - Session 56 (CRITICAL)

- **Cause**: Bot is completely stuck at position (29-30, 92-95, -4 to -7). ALL action tools fail:
  - bot.moveTo(): Returns without moving (5-38s, no error). Tried 5+ different coordinates with 40-100 block offsets.
  - bot.navigate(): Returns immediately without moving (pos unchanged).
  - bot.gather(): Timeouts after 30-120s even for count=1.
  - bot.farm(): Timeouts after 60-120s.
  - bot.build("shelter"): Timeouts after 60s.
  - bot.pillarUp(): Timeouts after 60s.
  - bot.combat("cow"/"pig"/"chicken"/"sheep"): Returns immediately without finding/killing animals (no animals exist nearby).
- **Coordinates**: Bot stuck at (29-30, 92-95, -5) in birch_forest biome.
- **Last Actions**: All the above tools attempted multiple times, all fail silently or timeout.
- **Working Tools**: bot.status(), bot.inventory(), bot.craft(), bot.place(), bot.wait(), bot.eat() — stationary/inventory operations work fine.
- **Root Cause Hypothesis**: Pathfinder may be completely broken at current position. Possible terrain issue, stuck in/near a structure, or pathfinder state corruption.
- **Impact**: Cannot progress at all. Food=1 bread. Phase 4 iron mining blocked. Bot cannot move.
- **Status**: Reported. Critical bug — code reviewer must investigate pathfinder state at (29, 92, -5) in birch_forest.

---

## [2026-03-24] Bug: Death by zombie - pillarUp placement failure during night - Session 55

- **Cause**: bot.pillarUp(6) returned "Pillared up 17.0 blocks (Y:97→114, placed 0/6). PARTIAL: Stopped early (6 blocks short). Reason: Placement failed" — zombie at 14.9 blocks south killed bot during the 19s pillarUp execution. pillarUp already elevated Y:97→114 (17 blocks) but then failed to place the final 6. Bot was exposed to zombie during the process.
- **Location**: `src/tools/core-tools.ts` pillarUp() — placement failure at elevated position
- **Coordinates**: (38.3, 97, -52.7) start, zombie at south 14.9 blocks
- **Last Actions**: status() showed zombie nearby → pillarUp(6) called → zombie killed bot during execution
- **Root Cause**: pillarUp reported "placed 0/6" meaning it was already at Y=114 before trying to place blocks, but placement still failed. Bot was vulnerable during the 19s execution window. Zombie walked to bot and attacked while pillarUp was failing.
- **Fix Needed**: pillarUp() should detect nearby threats and immediately place 1 block under feet as emergency shelter, then attempt higher pillar. Or should flee first before pillaring.
- **Status**: Recorded. Bot died at Y:97, z:-52.7. Respawned at (-9.5, 114, -7.5).

---

## [2026-03-24] Bug: Death by zombie - pillarUp failed during night - Session 54

- **Cause**: bot.pillarUp(6) failed with "No blocks placed" despite having 106 cobblestone in inventory. Bot had already fled from zombie but pillarUp failed twice. Zombie caught and killed bot.
- **Location**: `src/tools/core-tools.ts` pillarUp() — fails to place blocks even when scaffold blocks (cobblestone x106, dirt x71) are available
- **Coordinates**: ~(-3, 114, -12) at midnight in birch_forest biome
- **Last Actions**: flee(20) succeeded → pillarUp(6) failed (attempt 1, 34s) → pillarUp(6) failed (attempt 2, 17s) → zombie slain bot
- **Root Cause**: pillarUp() may be failing because the bot is on terrain that's not flat/solid, or the bot can't equip cobblestone to hand properly at Y=114 elevation
- **Fix Needed**: pillarUp() should fall back to dirt if cobblestone fails, and should explicitly select scaffold blocks before attempting to place
- **Status**: Recorded. Bot died. Reconnecting.

---

## [2026-03-24] Bug: Death by drowned during bot.farm() - Session 53

- **Cause**: bot.farm() navigated bot close to water at (2, 72, 5) to use it for irrigation. Drowned mob in water killed bot. flee() reported success (hp=20, threats=0) but death had already occurred.
- **Location**: `src/tools/high-level-actions.ts` farm() — moves bot to water source for irrigation, drowned spawns from water and kills bot
- **Coordinates**: (1.4, 50, 4.4) at death (fell to y=50 underground near water)
- **Last Actions**: bot.farm() timed out after 120s during dirt placement, then attempted to harvest nearby wheat near water → drowned attack
- **Root Cause**: farm() finds water at (2,72,5) for irrigation, moves bot near water, drowned at 14.9 blocks attacks. Filter "within 4 blocks of water" filtered farmCoords but still moved bot to water area.
- **Fix Needed**: farm() should not navigate bot within 20 blocks of any drowned mob. Check threats before/during navigation to water.
- **Status**: Recorded. Bot respawned at (−5.5, 118, 2.1) with keepInventory. HP=20.

---

## [2026-03-24] Bug: Death by drowned - HP=0.5 unable to recover - Session 52

- **Cause**: Bot started with HP=0.5 from previous session. Drowned spawned from water at coordinates near base. flee() repeatedly returned to same location (x=2,y=70,z=5). Could not pillarUp (failed), could not escape. Drowned killed bot at dawn.
- **Location**: `src/tools/core-tools.ts` flee() — fails to navigate away from water mob (drowned), returns to same coordinates
- **Coordinates**: (2, 70, 5) — death confirmed by "[Server] Claude1 drowned"
- **Last Actions**: flee(40) x3 (all returned to same pos), wall building (cobblestone 4 sides), then waited 5s → death
- **Root Cause 1**: flee() does not avoid water sources, drowned can chase bot in/around water indefinitely
- **Root Cause 2**: At HP=0.5, hunger=11 — natural regen requires hunger>=18, so HP could not recover
- **Root Cause 3**: pillarUp() failed with "No blocks placed" despite having 81 dirt in inventory — no solid ground detection issue
- **Fix Needed**: (1) flee() should move bot away from water/drowned direction, (2) pillarUp() should work reliably when inventory has scaffold blocks
- **Status**: Recorded. Bot respawned with keepInventory, HP=20.

---

## [2026-03-24] Bug: Double death - zombie kill + fall damage - Session 50

- **Cause**: bot.farm() hung 180s letting mobs damage bot (HP 9→4). bot.flee(40) ran bot into zombie → death. Then "Claude1 fell from a high place" death also occurred (likely flee sent bot to Y=110 and fell).
- **Location**: flee() in `src/tools/core-tools.ts` — flees to dangerously high elevation (Y=110)
- **Coordinates**: (-3, 69, -8) → zombie death → (9, 110, -7) → fall death
- **Last Actions**: farm() 180s timeout → flee(40) → "slain by Zombie" → "fell from a high place"
- **Root Cause 1**: bot.farm() no timeout, allows prolonged mob exposure
- **Root Cause 2**: bot.flee() pathfinds to Y=110+ causing fall death after zombie death
- **Fix Applied**: Recording only. Fixes: (1) farm() 60-90s global timeout, (2) flee() should cap Y movement
- **Status**: Recorded. Two deaths in sequence.

---

## [2026-03-24] Bug: Death during flee - zombie killed at HP=4 - Session 50

- **Cause**: bot.farm() hung for 180s during which mobs damaged bot from HP=9 to HP=4. After farm timeout, flee() was called but zombie killed bot during flee movement.
- **Location**: `src/tools/high-level-actions.ts` farm() — no timeout guard allowing mob damage during hang
- **Coordinates**: (-3, 69, -8) → death at (9, 110, -7)
- **Last Actions**: bot.farm() 180s timeout (HP went from 9→4 during hang) → bot.flee(40) → "Claude1 was slain by Zombie"
- **Root Cause 1**: bot.farm() has no timeout, allows prolonged exposure to mobs during daytime farming
- **Root Cause 2**: bot.flee() runs into zombie while fleeing (no path safety check)
- **Fix Applied**: Recording only. Fixes needed: (1) bot.farm() global timeout 60-90s, (2) flee should check threats along path
- **Status**: Recorded. DEATH. Respawn needed.

---

## [2026-03-24] Bug: bot.farm() timeout after 180s - never returns - Session 50

- **Cause**: bot.farm() hangs indefinitely, exceeding 180s timeout. No logs output even after start. Likely stuck in farmland preparation loop or waiting for water source placement when pathfinder is obstructed.
- **Location**: `src/tools/high-level-actions.ts` or `src/tools/core-tools.ts` farm implementation
- **Coordinates**: (-6, 73, -3) birch_forest
- **Last Actions**: Dawn just started. 10 threats >10 blocks away. Called bot.farm() with 43 wheat_seeds in inventory. No output after 180s.
- **Root Cause**: farm() likely tries to till/navigate terrain and hits pathfinder deadlock or infinite loop without timeout guard.
- **Fix Applied**: Recording only. Fix: Add global 120s timeout to bot.farm() similar to bot.gather(). Add progress logging inside farm loop.
- **Status**: Recorded.

---

## [2026-03-24] Bug: moveTo() タイムアウト - pathfinder詰まり - Session 49

- **Cause**: bot.moveTo() が全方向でタイムアウト。bot.flee()も移動できず同じ場所に留まり続ける。farm()が穴掘り作業中に地形を変えてpathfinderが通れなくなった可能性。
- **Location**: `src/bot-manager/pathfinder.ts` または `src/tools/core-tools.ts` moveTo実装
- **Coordinates**: (2, 71, 6) — y=71、birch_forest
- **Last Actions**: bot.farm()実行中に地形変化（dirt配置・穴掘り）。その後flee()・moveTo(-50,70,0)・moveTo(2,71,-10)が全てタイムアウト
- **Root Cause**: farm()が地形変更（空中にdirt設置、穴掘り）を行いpathfinderが迷路化。CLAUDE.mdの「掘った穴は埋め戻せ」ルール違反。
- **Fix Applied**: 記録のみ。Fix: farm()が地形変更した箇所を完了時に元に戻す、またはpathfinder timeout後に代替経路計算を試みる。
- **Status**: 記録済。HP9 Hunger7で敵12m圏内。深刻な状況。

---

## [2026-03-23] Bug: mc_farm continues stationary operation when HP=2.5 + zombie 0.7 blocks away → death - Session 48

- **Cause**: mc_farm issues WARNING but continues when HP < 8 or hostiles nearby. At HP=2.5 with zombie 0.7 blocks away, continuing farm operation is fatal. Should abort and flee, not just warn.
- **Location**: `src/tools/core-tools.ts` mc_farm function (~line 716-784)
- **Coordinates**: (14, 70, 3) — near water source at (13, 72, -1)
- **Last Actions**: bot.farm() was running. Tilling failed 4 times. HP dropped to 2.5. Zombie at 0.7 blocks. Farm WARNING logged but continued. Result: "Claude1 was slain by Zombie", then "Claude1 fell from a high place" x2
- **Root Cause**: mc_farm converted ABORT → WARNING for HP < 8 and hostiles nearby (to prevent "deadlock"). But WARNING-only mode allows lethal continuation. Need: flee immediately when HP < 5 OR hostile within 2 blocks, regardless of deadlock concerns.
- **Fix Applied**: 記録のみ。Fix: add ABORT condition inside farm loop: if (hp < 5 || hostile_within_2_blocks) { flee(); return error_message; }
- **Status**: 記録済。

---

## [2026-03-23] Bug: bot.wait() aborts when HP=5.0 even though HP is stable (not dropping) - Session 47

- **Cause**: `bot.wait()` has HP threshold check that triggers "auto-flee" when HP <= 5.0, even when HP is not actually dropping. This creates an infinite abort loop when bot is at exactly 5.0 HP.
- **Location**: `src/tools/core-tools.ts` or `src/tools/mc-execute.ts` (wait implementation)
- **Coordinates**: (12, 90, 5)
- **Last Actions**: Bot pillarUp'd for night safety at HP=5. Called bot.wait(5000) to wait for morning. Wait immediately aborted with "ABORTED: HP dropped to 5.0 during wait — auto-fleeing from danger" even though HP was not dropping.
- **Root Cause**: wait() checks if `currentHP <= threshold` but should check if `currentHP < previousHP` (actual drop). HP=5.0 stable is NOT dangerous — HP=5.0 and dropping is dangerous.
- **Fix Applied**: 記録のみ。Fix: change wait() HP check from `hp <= 5` to `hp < startingHp` (actual decrease detection).
- **Status**: 記録済。

---

## [2026-03-23] Bug: No mob food drops - cow/pig/chicken combat yields 0 food items - Session 47

- **Cause**: `bot.combat("cow")`, `bot.combat("pig")`, `bot.combat("chicken")` all complete successfully but no food items (raw_beef, raw_porkchop, raw_chicken) appear in inventory.
- **Location**: birch_forest around (-18, 94, -16) to (25, 79, -6)
- **Last Actions**: Called bot.combat("cow"), bot.combat("pig"), bot.combat("chicken") in sequence. All returned success. No food drops.
- **Root Cause**: Either (1) entity drops are not working despite doMobLoot=true gamerule, or (2) combat() kills mob but bot doesn't collect the drops (moves away before items land), or (3) combat() bug in item collection.
- **Fix Applied**: 記録のみ。Previous session noted doMobLoot=true but drops still failing.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 fell from high place - moveTo Y=64 on mountain - Session 46b

- **Cause**: Called `bot.moveTo(3, 64, 30)` from mountain at Y=117. Pathfinder walked bot off cliff edge to reach Y=64, resulting in fall death.
- **Location**: (~3, 117, 10) mountain top
- **Coordinates**: (3, 117, 10)
- **Last Actions**: Loop trying moveTo with Y=64 in different XZ directions to find lower terrain
- **Root Cause**: `bot.moveTo(x, Y, z)` does not prevent falling off cliffs. Should use pathfinding with fall damage protection or check terrain before moving.
- **Fix Applied**: コード修正禁止のため記録のみ。`bot.moveTo` should have cliff-edge detection.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 drowned underground - bot.place() hang - Session 46

- **Cause**: Bot was at Y=47 underground with HP=4.8, Hunger=0. Called `bot.place("dirt", ...)` in a loop — execution timed out after 30s while still underwater/underground. Bot drowned before getting to surface.
- **Location**: (~2, 47, -2) underground
- **Coordinates**: (2, 47, -2)
- **Last Actions**:
  1. `bot.flee(20)` — only moved slightly, still underground
  2. `bot.navigate("grass_block")` — did not reach surface
  3. `bot.pillarUp(30)` — failed: "No blocks placed"
  4. `bot.moveTo(x, 65, z)` — did not reach Y=65
  5. `bot.place("dirt", ...)` loop — timed out 30s, bot drowned
- **Root Cause**: `bot.pillarUp()` fails when bot is underwater (cannot place blocks underwater). `bot.navigate("grass_block")` does not reliably path to surface. No swim-up mechanism available.
- **Fix Applied**: コード修正禁止のため記録のみ。`bot.pillarUp()` should detect water and use swim-up logic instead.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 drowned at surface - flee() not escaping hostiles - Session 48

- **Cause**: Bot spawned/was at (8, 74, 2) surrounded by 8 creepers, 2 zombies, 2 skeletons at HP=3. Bot had previously drowned (seen in chat "[Server] Claude1 drowned"). flee(), pillarUp(), moveTo() all failed to change position — bot stayed at exactly (8,74,2) throughout.
- **Location**: (8, 74, 2) birch_forest
- **Coordinates**: (8, 74, 2)
- **Last Actions**:
  1. `bot.flee(40)` — position unchanged (8,74,2)
  2. `bot.pillarUp(8)` — position unchanged
  3. `bot.moveTo(58, 74, 52)` — position unchanged
  4. `bot.wait()` — auto-flee triggered 6+ times but position unchanged
- **Root Cause**: flee() and moveTo() appear to not actually move the bot when surrounded by dense mob clusters. Pathfinder may be blocked by mob entities or terrain. The bot was previously drowned - possibly was in water/underground and position reporting was incorrect.
- **Fix Applied**: 記録のみ。flee() should work even when surrounded — may need to jump/break blocks to escape.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 shot by Skeleton - HP dropped during wait auto-flee cycle - Session 48b

- **Cause**: HP=5.3 surrounded by 6 creepers, 3 zombies, 4 skeletons in morning daylight. Auto-flee from wait() was triggered but flee() did not move bot far enough away. Skeleton shot bot to HP=2.3 then death.
- **Location**: (2, 74, 0) birch_forest
- **Coordinates**: (2, 74, 0)
- **Last Actions**:
  1. `bot.navigate("cow")` — navigated but entities unchanged
  2. `bot.combat("cow")` — triggered
  3. `bot.wait(2000)` — auto-flee triggered (skeleton at 7.7 blocks), flee completed at HP=2.3
  4. Shot by skeleton, died
- **Root Cause**: Mobs in daylight not burning (possibly in shaded area or mob shade behavior). flee() not moving bot far enough from dense mob clusters. wait() auto-flee threshold may be too close (7.7 blocks is within skeleton arrow range).
- **Fix Applied**: 記録のみ。Skeleton arrow range is 15 blocks — flee threshold should trigger at >15 blocks or flee distance should be >20 blocks.
- **Status**: 記録済。

---

## [2026-03-23] Bug: bot.moveTo() と bot.gather() が完全に機能しない - Session 45

- **Cause**: `bot.moveTo(x, 30, z)` を実行しても位置が全く変わらない。`bot.gather("iron_ore")` や `bot.gather("coal_ore")` もタイムアウトまたは即終了してアイテムが取れない。
- **Location**: birch_forest, (5.8, 68.4, 2.3)
- **Coordinates**: (5.8, 68.4, 2.3)
- **Last Actions**:
  1. `bot.moveTo(5, 30, 2)` → 1秒で終了、位置変化なし (y=68.4のまま)
  2. `bot.moveTo(x+100, 64, z)` → 即終了、位置変化なし
  3. `bot.gather("iron_ore", 8)` → 即終了、raw_iron取得ゼロ
  4. `bot.gather("coal_ore", 8)` → 61秒かかって終了、coal取得ゼロ
- **Root Cause**: pathfinderが動作していない可能性。または内部でエラーが起きて移動を諦めている。
- **Fix Applied**: コード修正禁止のため記録のみ。コードレビューアーに調査を依頼。
- **Status**: 記録済。代替手段を模索中。

---

## [2026-03-23] Bug: Claude1 drowned - moveTo through water - Session 44

- **Cause**: Called `bot.moveTo(1, 88, -3)` from position (8, 101, 29). Pathfinder routed bot through water body, causing drowning death.
- **Location**: (~3, 101, 27)
- **Coordinates**: (8, 101, 29) → drowned en route
- **Last Actions**:
  1. Status check: hunger=6, pos=(8,101,29), biome=birch_forest
  2. Called `bot.moveTo(1, 88, -3)` to return to base
  3. Pathfinder routed through water - bot drowned
  4. keepInventory ON so items preserved
- **Root Cause**: moveTo pathfinder does not avoid water bodies. Bot submerged and could not escape in time. Y difference (101 → 88) combined with water crossing = drowning.
- **Fix Applied**: None (game agent, report only). Need pathfinder to avoid water.
- **Status**: Recorded. Reconnecting and using alternate navigation strategy.

---

## [2026-03-23] Bug: Claude1 died - starvation/hostile in cave - Session 43

- **Cause**: Bot was in underground cave at Y=77-82. Hunger dropped to 0. HP=6.8 with multiple hostiles (drowned, skeleton, zombie). Connection dropped (death). keepInventory ON but stone_pickaxe was missing after reconnect.
- **Location**: (~3, 82, 12)
- **Coordinates**: (3.5, 82, 11.7)
- **Last Actions**:
  1. Trying to get to surface from cave at Y=77
  2. navigate("grass_block") triggered hostile warnings
  3. flee() called, moved to Y=78-82
  4. moveTo(3, 88, 13) - connection closed (death)
  5. Reconnected with hunger=0, missing stone_pickaxe
- **Root Cause**: Bot navigated into cave system while looking for coal_ore. Got trapped by hostile mobs. No food to recover HP. pillarUp failed (no solid footing). Path to surface blocked.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded. Need surface escape + food urgent.

---

## [2026-03-23] Bug: Claude1 killed by Zombie at night - Session 42

- **Cause**: Bot had HP=4.2 at midnight surrounded by skeletons/zombies. flee() ran but bot was teleported to Y=112 (respawn location?) and zombie killed it there. No shelter found during night.
- **Location**: (1.5, 112, 6.5)
- **Coordinates**: (1.5, 112, 6.5)
- **Last Actions**:
  1. Sheltering at night near base (7, 100, -6)
  2. Skeletons surrounded, HP dropped from 20 to 4.2 via arrow damage
  3. flee() couldn't escape mobs
  4. wait(5000) completed, HP showed 20 (respawn?) but then "Claude1 was slain by Zombie"
  5. Respawned at (1.5, 112, 6.5) HP=20 (keepInventory)
- **Root Cause**: Night shelter is inadequate - bot is at Y=102-104 which is elevated open terrain. No enclosed room to hide in. `bot.wait()` with auto-flee doesn't prevent arrow damage from skeletons. During midnight with 4.2 HP, need to be inside fully enclosed shelter.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 shot by Pillager during day - Session 41

- **Cause**: Bot was near (7, 104, -4) examining chests/building shelter. Pillager patrol found and shot bot. No armor equipped, no flee triggered.
- **Location**: (7, 104, -4)
- **Coordinates**: (7, 104, -4)
- **Last Actions**:
  1. Building shelter and placing chests
  2. Examining chest contents with mc_execute
  3. Pillager shot bot — "Claude1 was shot by Pillager"
  4. Respawned at (7.5, 104, -4.5) HP=20, hunger=20 (keepInventory)
- **Root Cause**: No armor equipped (NO ARMOR warning ignored). Pillager patrol in area. Bot needs to craft and equip armor before doing base-building activities.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 killed by Spider while fleeing - Session 41

- **Cause**: Bot had HP=6, hunger=0 with spider at 1.8 blocks distance. Called `bot.flee(20)` but was killed by spider during flee execution before escaping.
- **Location**: (103.9, 73.2, 13.3) old_growth_birch_forest
- **Coordinates**: (103.9, 73.2, 13.3)
- **Last Actions**:
  1. Status showed HP=6, hunger=0, spider at 1.8 blocks
  2. Called `bot.flee(20)`
  3. Spider killed bot during flee — "Claude1 was slain by Spider"
  4. Respawned at (13.6, 102, 6.4) with HP=20, hunger=20 (keepInventory)
- **Root Cause**: `bot.flee()` does not protect against melee damage during execution when mob is already within attack range (1.8 blocks). Bot should attack back or use pillarUp when mob is <3 blocks, not flee.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 starved/died underground - Session 40

- **Cause**: Bot had HP=10, hunger=0 while underground (Y=52) at midnight. Skeleton/zombie nearby. No food. HP likely hit 0 from starvation + hostile damage.
- **Location**: (3.7, 52.5, -2.7) underground cave
- **Coordinates**: (3.7, 52.5, -2.7)
- **Last Actions**:
  1. HP=10, hunger=0, midnight, Y=52 underground, 3 hostiles nearby
  2. `bot.flee()` → succeeded but still at Y=52
  3. `bot.pillarUp(5)` → ended up in water
  4. `bot.navigate("crafting_table")` — connection closed
  5. Respawned at (77.5, 67, -16.5) with HP=17.5, hunger=14
- **Root Cause**: Starvation + being underground + hostile mobs = death. Need to ensure food supply before going underground.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: bot.gather() infinite hang - Session 40

- **Cause**: `bot.gather("birch_log", 20)` timed out after 120s. Likely caused by pathfinder being unable to navigate due to heavily excavated terrain (holes everywhere). The gather function found a target block but pathfinder could not compute a valid path.
- **Location**: (77.5, 67, -16.5) birch_forest
- **Coordinates**: (77.5, 67, -16.5)
- **Last Actions**:
  1. Session started: connected, HP=17.5, hunger=14, day
  2. `bot.gather("birch_log", 20)` — hung for 120s then timed out
  3. Bot did not move (same position before and after)
- **Root Cause**: Pathfinder deadlock due to terrain holes. gather() has no timeout fallback for when pathfinding is blocked.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded. Using alternative approach: moveTo() to new area.

---

## [2026-03-23] Bug: Claude1 drowned - Session 39

- **Cause**: "Claude1 drowned" — Bot had HP=10, hunger=17 at position (8.3, 79, 13.7) in birch_forest. After equipping armor, tried bot.combat("cow") but no cow found. Bot somehow drowned — likely fell into water while searching for cow, or pathfinder navigated through water.
- **Location**: ~(8, 79, 13) birch_forest
- **Coordinates**: (8.3, 79, 13.7)
- **Last Actions**:
  1. Session started: HP=10, hunger=17, morning
  2. `bot.equipArmor()` — succeeded
  3. `bot.combat("cow", 8)` — returned "No cow found nearby"
  4. Death message: "Claude1 drowned"
- **Root Cause**: bot.combat() with no target found apparently still navigated/moved and the pathfinder moved the bot into water. The bot drowned while searching for a cow to hunt.
- **Fix Applied**: None (code fix prohibited for game agents)
- **Status**: Recorded. Respawned at (-8.5, 117, -9.5).

---

## [2026-03-23] Bug: Claude1 drowned underground - Session 38

- **Cause**: "Claude1 drowned" — Started session with HP=16.8, hunger=5, midnight, no food in inventory. Fled from hostiles, ended up underground at Y=44-55. Attempted to build shelter but pillarUp timed out (30s). Bot was underwater/in cave with 6 hostile mobs, HP=0.6, starvation made it impossible to regenerate. Drowned while trying to place blocks.
- **Location**: ~(-1.5, 44, -8.7) underground cave
- **Coordinates**: (-1.5, 44, -8.7)
- **Last Actions**:
  1. Session started: HP=16.8, hunger=5, midnight, 8 hostiles nearby, NO food in inventory
  2. `bot.flee(30)` → HP dropped to 0.6 during flee
  3. `bot.pillarUp(6)` → timed out after 30s (likely blocked underground)
  4. `bot.flee(50)` → Only moved 9/50 blocks, terrain constrained, now at Y=55
  5. Navigate to chest failed - path blocked underground
  6. `bot.place()` shelter attempt → timed out, bot drowned
- **Root Cause**: Session resumed with critical hunger=5 and no food in inventory at midnight. The critical HP drop happened during flee (before flee: unknown, after: 0.6). The flee tool dropped HP from ~16.8 to 0.6 - possibly ran into hostile during flee? Or hunger damage during flee? Navigation sent bot underground where it couldn't escape.
- **Fix Applied**: None (code fix prohibited for game agents)
- **Status**: Recorded. Death by drowning at Y=44. Respawned.

---

## [2026-03-22] Bug: bot.gather() が iron_ore/iron_ingot を取得できない

- **Cause**: `bot.gather("iron_ore", N)` および `bot.gather("iron_ingot", N)` が即時終了し、0個しか収集できない。インベントリに変化なし。
- **Location**: src/tools/core-tools.ts (gather実装)
- **Coordinates**: (4.5, 94.9, 32.5)
- **Last Actions**:
  1. `bot.gather("iron_ore", 10)` → 47ms で終了、0個
  2. `bot.gather("iron_ore", 5)` → 43ms で終了、0個
  3. `bot.craft("iron_pickaxe", 1, true)` → autoGather でも iron_ingot 0/3
- **Fix Applied**: なし（コード修正禁止のため記録のみ）
- **Status**: Investigating

---

## [2026-03-22] Bug: bot.navigate() 座標指定で移動しない（夜間 HP=10 Hunger=0）

- **Cause**: `bot.navigate({x, y, z})` を呼び出しても現在位置から動かない。夜間(midnight ticks=22193)、HP=10、Hunger=0の状態。同じ座標(-32, 97, 13)に留まり続ける。
- **Location**: src/tools/core-tools.ts (navigate実装)
- **Coordinates**: (-32.3, 97, 13) old_growth_birch_forest
- **Last Actions**:
  1. 接続後にflee(20) → 17秒かかって同エリアに留まる
  2. navigate({x:-6, y:98, z:4}) → 27.8 blocks awayエラー（チェストから離れすぎ）
  3. navigate({x:-35, y:98, z:9}) → 3秒で完了するが位置変わらず
  4. navigate({x:-20, y:97, z:13}) → 20秒タイムアウト後も位置変わらず
- **Fix Applied**: None（コード修正禁止）
- **Status**: 調査中。夜間のHP/移動ガードが原因の可能性。

---

## [2026-03-22] Bug: Claude1 moveTo完全不動 - (28.7, 69.2, 16.9)でスタック

- **Cause**: moveTo/navigate/flee(repeat)が全て(28.7,69.2,16.9)から動かない。flee()一回は動くが2回目以降は同座標。pathfindingが何かにブロックされていると思われる。
- **Location**: (28.7, 69.2, 16.9) birch_forest
- **Coordinates**: (28.7, 69.2, 16.9)
- **Last Actions**: flee(20)→28.7,69→moveTo(50,70,50)→動かず→flee x5→全て同座標
- **Fix Applied**: None (コード修正禁止)
- **Status**: 調査中。HP=9.2, Hunger=8, 食料ゼロで生存危機。

---

## [2026-03-22] Bug: Claude1 溺死 - moveTo(0, 72, 80)が水中y=114に誘導

- **Cause**: `bot.moveTo(0, 72, 80)` を呼んだところ、bot がy=114の水中に誘導された。水中で溺死。
- **Location**: (9, 114, 1) - 水中
- **Coordinates**: (9, 114, 1)
- **Last Actions**: flee(30) → moveTo(0, 72, 80) → 到達後y=114水中 → 溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡。keepInventoryによりアイテム保持。moveTo が水中経路を選択するバグ要調査。

---

## [2026-03-22] Bug: Claude1 HP 0.2 瀕死 - 食料ゼロ+飢餓ダメージ+密集モブで詰み状態

- **Cause**: セッション開始時から食料ゼロ。HP 17.2→14.2→8.2→4.2→0.2と連続ダメージ。スケルトン矢+飢餓ダメージ+移動中の落下で瀕死に。moveTo失敗でパスがブロックされ、地下のY=79-82エリアから脱出できない。
- **Location**: (-1, 80, 7) birch_forest
- **Coordinates**: (-1, 80, 7) / 現在HP=0.2
- **Last Actions**: mc_flee(20) → 12.8m逃げた → moveTo(chest) → path blocked → 飢餓ダメージ → HP 0.2
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡確認（"hit the ground too hard"）。リスポーン後HP=17.7/Hunger=20に。keepInventoryでアイテム保持。移動中にY=78から落下死。

---

## [2026-03-22] Bug: Claude1 スケルトンに射殺 - 朝なのに大量スケルトンが消えず、hunger=0でHP回復不可

- **Cause**: 夜間に(birch_forest、Y=60-72の地下・木の日陰エリア)スケルトンが7-10体周囲に密集。朝になっても木の日陰で燃えず消えない。hunger=0でHP回復不可能。mc_flee(50)でも3-8ブロックしか逃げられない（地形制約）。mc_build("shelter")がtimeout（60秒）して完了しない間にスケルトンに射殺。
- **Location**: (-0.5, 72, -9.5) birch_forest
- **Coordinates**: 死亡座標 (-0.5, 72, -9.5)。リスポーン後 (-0.6, 102, 13.5)
- **Last Actions**: 1. mc_flee(20) x3 → 数ブロックしか逃げられず 2. mc_build("shelter") → 60秒タイムアウト → その間にスケルトンに射殺
- **Fix Applied**: None (コード修正禁止)
- **Status**: 記録済み。教訓: hunger=0状態で夜間/朝の密集スケルトンエリアに居続けるのは致命的。mc_build がtimeoutするリスクが高い。代わりにcobblestoneを手動でplaceしてシェルターを構築すべき。

---

## [2026-03-22] Bug: craft("white_bed") がウールからのレシピではなく色変えレシピ（white_dye+black_bed）を選択

- **Cause**: `bot.craft("white_bed", 1, false)` が本来のベッドクラフトレシピ（white_wool x3 + planks x3）を使わず、色変えレシピ（white_dye x1 + black_bed x1）を選択してしまった。インベントリにwhite_wool x4があったにもかかわらず、black_bedが存在しないとして失敗。
- **Location**: `src/tools/core-tools.ts` — craft関数のレシピ選択ロジック。ベッドのような複数レシピがあるアイテムで間違ったレシピを優先している。
- **Coordinates**: (2, 66, -5) birch_forest, 作業台 at (3, 65, -4)
- **Last Actions**: `bot.craft("white_bed", 1, false)` — white_wool x4所持・作業台隣接 → 色変えレシピを選択して失敗
- **Fix Applied**: None (コード修正禁止)
- **Status**: Recorded. 回避策: `bot.craft("bed", 1, false)` または `autoGather=false` で明示的にウールからのレシピを使う試みをする。

---

## [2026-03-22] Bug: Claude1 クリーパーに爆殺 - 夜間mc_flee不十分+minecraft_pillar_up失敗

- **Cause**: 夜間にHP 9.3、食料なしの状態でクリーパーに爆破された。mc_flee(distance=30)を2回呼んでも6ブロックしか逃げられなかった。minecraft_pillar_up(height=15)も1.2ブロックしか上がれず逃げ場なし。
- **Location**: (2, 64, -3) birch_forest
- **Coordinates**: (2, 64, -3)
- **Last Actions**: mc_flee(30) x2 → 6ブロックしか逃げられず → minecraft_pillar_up(15) → 1.2ブロックのみ → クリーパーに爆殺
- **Fix Applied**: None - keepInventoryでアイテム保持。
- **Status**: 死亡確認。mc_fleeが短距離しか逃げられないバグ要調査。

---

## [2026-03-22] Bug: minecraft_pillar_up 繰り返し失敗

- **Cause**: minecraft_pillar_up が cobblestone/birch_planks 装備時に "Placement failed" で1ブロックしか上がれない。cobblestoneをmc_equipで手に持ってから試みても同様の失敗。
- **Location**: (-14, 66, 34) old_growth_birch_forest
- **Coordinates**: (-14, 66, 34)
- **Last Actions**: mc_equip(cobblestone) → minecraft_pillar_up(height=15) → "Pillared up 1.0 blocks, Placement failed"
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Bot stuck at Y=66, cannot reach chests at Y=89-90.

---

## [2026-03-22] Bug: Claude1 瀕死 - 飢餓+夜間ゾンビダメージ (Phase 2セッション)

- **Cause**: Phase 2食料確保中、草壊し(short_grass)でmc_gatherが120秒タイムアウト。その間に夜になりゾンビに攻撃されHP 6→4→3まで低下。hunger 0で飢餓ダメージも受け始め、HP 3で瀕死。食料がインベントリに全くなく回復不可能。
- **Location**: (-12, 63, 33) old_growth_birch_forest
- **Coordinates**: (-12, 63, 33)
- **Last Actions**: mc_gather(short_grass) timeout → mc_flee(zombie) → HP 4 → hunger 0 → HP 3瀕死
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 瀕死状態。食料確保が急務。

---

## [2026-03-22] Bug: mc_gather タイムアウト (birch_log / coal_ore)

- **Cause**: mc_gather が "coal_ore" と "birch_log" で連続して120秒タイムアウト。nearby_resources には両方 "nearby" と表示されているが採掘できない。
- **Location**: (6, 99, 70) old_growth_birch_forest
- **Coordinates**: (6, 99, 70)
- **Last Actions**: mc_navigate(coal_ore) → timeout, mc_navigate(birch_log) → timeout
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Suspected: block is shown nearby but path is blocked (y-level mismatch or terrain obstacle).

---

## [2026-03-22] Bug: Claude1 killed by Creeper during Phase 2 food gathering

- **Cause**: mc_farm caused bot to roam into dangerous terrain at night. HP dropped to 3 due to mob damage during farming. mc_flee executed but Creeper explosion killed bot at HP 3. Multiple hostile mobs (creeper x4, skeleton, zombie x3, enderman, pillager x2, drowned x2) surrounded the area.
- **Location**: (4, 67, -3) birch_forest
- **Coordinates**: (4, 67, -3)
- **Last Actions**: mc_farm (seed planting near water) → mc_flee from creeper → death
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Death caused by nighttime roaming during mc_farm with no armor. Needs respawn.

---

## [2026-03-22] Bug: Claude1 HP 4 - mc_farm失敗でファームランド変換できず食料確保不能

- **Cause**: mc_farm実行時に水源近くのdirtをtillしてもfarmlandに変換されない（"NOT farmland — skipping"）。農場が機能せず食料が得られないままHP 4まで低下。
- **Location**: (-3, 89, -2) birch_forest
- **Coordinates**: (-3, 89, -2)
- **Last Actions**: mc_farm → till失敗(farmland変換されない) → HP 4 → 食料ゼロ → 回復不可
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 緊急。食料ゼロ、HP 4。動物狩りで食料確保必須。

---

## [2026-03-22] Bug: mc_combat がスケルトン相手に必ずタイムアウト

- **Cause**: `bot.combat("skeleton", 5)` を呼ぶと、30秒・60秒どちらのタイムアウトでも常にタイムアウトエラーになる。戦闘が完了せず、スケルトンも倒せない。朝（tick 5093）でも消えないスケルトンが10m圏内にいて、mc_navigate/mc_farm もそのスケルトンをブロックとして移動拒否される。
- **Location**: `src/tools/core-tools.ts` — combat関数のattackループ
- **Coordinates**: (3, 64, 13) birch_forest
- **Last Actions**: bot.flee(25) → skeleton 10.8mまで逃げた → bot.navigate({x:60,y:63,z:4}) → ABORTED (skeleton 10.8m) → bot.combat("skeleton", 5) → 30秒timeout → bot.combat("skeleton", 5) → 60秒timeout
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 調査中。mc_combatのattackループが終わらない。fleeHp=5でも戦闘が始まらずタイムアウト。移動と農場作りも全てブロックされている。

---

## [2026-03-22] Bug: Claude1 shot by Skeleton during midnight

- **Cause**: Claude1 was killed by a Skeleton during midnight. No armor equipped, nighttime mob encounter while navigating.
- **Location**: Unknown (observed via chat: "Claude1 was shot by Skeleton")
- **Coordinates**: Unknown
- **Last Actions**: Navigating during midnight, no armor
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Claude1 died to Skeleton at midnight. Claude2 also at HP 7.5 before fleeing.

---

## [2026-03-22] Bug: Claude1 HP 1 with no food - imminent death risk

- **Cause**: Session started with HP 4 and zero food. No animals found within 200 blocks. HP dropped to 1 due to mob attacks during night. No recovery path available (hunger 7, no food items, no animals).
- **Location**: (1, 51, 10) birch_forest
- **Coordinates**: (1, 51, 10)
- **Last Actions**: mc_flee x1, mc_navigate to furnace (failed), mc_navigate to find cow/chicken/pig (all failed within 200 blocks)
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Bot at HP 1, food=0, hunger=7. Attempting to survive by staying still and finding alternative food source.

---

## [2026-03-22] Bug: Claude1 Death - HP 1.2 mob attrition, no food, no escape path

- **Cause**: HP dropped from 5.3 to 1.2 through continuous mob damage (14+ mobs surrounding: creepers x5, skeletons x3, pillager x2, drowned x1, enderman x1, zombie x2). No food in inventory. mc_flee failed to escape (only moved 8-12 blocks each attempt). mc_navigate blocked in all directions due to terrain. Safety check blocked all movement at HP <2. Bot died from mob damage.
- **Location**: (2, 75, -2) birch_forest
- **Coordinates**: (2, 75, -2)
- **Last Actions**: mc_flee x3 (insufficient distance) → mc_navigate(100,75,100) blocked → mc_navigate(-100,64,100) safety check blocked → death
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Respawned at (-10, 109, 9) with near-empty inventory (2 dirt only, all tools lost). Root cause: persistent extreme mob density at spawn area with no food supply.

---

## [2026-03-22] Bug: Claude1 Death - 夜間クリーパー/モブ被弾, HP 5.8から20に回復

- **Cause**: 夜間にmc_navigate中にHP 20→5.8に低下。クリーパー・スケルトン・エンダーマン等4体に囲まれた。mc_flee(30)を実行したが十分に逃げられず(9ブロックのみ)。minecraft_pillar_up(8)も失敗(1.1ブロックのみ)。その後HPが5.8→20に回復（keepInventory有効、おそらく死亡してリスポーン）。
- **Location**: (-8, 92, -2) birch_forest
- **Coordinates**: (-8, 92, -2)
- **Last Actions**: mc_navigate(crafting_table) → HP 5.8 → mc_flee(30) 不十分 → minecraft_pillar_up(8) 失敗 → 死亡推定→リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Root causes: (1) mc_flee距離不十分バグ継続, (2) minecraft_pillar_up失敗継続, (3) 食料ゼロで夜間行動。

---

## [2026-03-23] Bug: bot.moveTo がY=38まで地下に潜行 - pathfinderが洞窟経路を選択

- **Cause**: セッション開始時にY=58の地下に出現（前回の飢餓死からのリスポーン後）。bot.moveTo(50,69,0)→bot.moveTo(0,69,50)→bot.moveTo(-50,69,0)→bot.moveTo(17,69,-16) を繰り返しても、Y=58→60→52→50→51→38と深くなった。目標Y=69-80なのに実際はどんどん下降する。
- **Location**: 洞窟内、birch_forest
- **Coordinates**: 最終 X=9, Y=38, Z=~ (いずれもY=57~58から開始)
- **Last Actions**: bot.moveTo(50,65,0) → Y=65到達せず(Y=65になったと思われたが次の確認でY=52) → bot.moveTo(0,69,50) → Y=58 → bot.moveTo(-50,69,0) → 同座標 → bot.moveTo(17,69,-16) → Y=38に降下
- **Root Bug**: pathfinderが地表へのルートを計算できず、洞窟を通って目標XZ座標に向かうルートを選択している。Y=58から地表Y=70までの直接経路がブロックされているため洞窟系を進み、それが深くなる方向の洞窟分岐を選んでしまう。
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 地下に閉じ込められた状態。bot.pillarUp()は"No blocks placed"で失敗（cobblestone 78個所持にもかかわらず）。地表脱出方法が不明。

---

## [2026-03-23] Bug: Claude1 溺死 - 地下洞窟で水に落ちて死亡

- **Cause**: Y=38の地下洞窟内でbot.moveTo/navigateを実行中に水源に落ちて溺死。"Claude1 drowned"がサーバーメッセージで確認。地下洞窟には水源が多く、pathfinderが水中経路を選択した結果と思われる。
- **Location**: 地下洞窟、birch_forest周辺
- **Coordinates**: 死亡前 X=7.5, Y=38前後, Z=不明 → リスポーン (7.5, 100, -3.5)
- **Last Actions**: bot.moveTo(17,69,-16) → Y=38に降下 → 洞窟内移動中 → 溺死（バグ記録執筆中に発生）
- **Root Bug**: moveTo が地下洞窟の水源ルートを選択してbotを水中に誘導。以前にも同様のバグ(moveTo(0,72,80)でy=114水中に誘導)が報告されており、繰り返し発生している。
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 死亡確認。keepInventoryでアイテム保持。リスポーン後 Y=100, HP=20, Hunger=20。

---

## [2026-03-22] Bug: Claude1 slain by Zombie while navigating to pig

- **Cause**: mc_navigate sent bot toward pig at Y=101 in hilly terrain. While navigating through elevated/obstructed terrain, Zombie attacked and killed bot. Iron boots lost (armor not restored by keepInventory? Or dropped on death).
- **Location**: ~(6, 105, 1) birch_forest
- **Coordinates**: (6, 105, 1)
- **Last Actions**: mc_navigate to pig coordinates (-51, 101, 93), path blocked, Zombie appeared during navigation.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true but iron_boots missing after respawn. Proceeding with Phase 2.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton at Y:38 underground - Phase 2 session

- **Cause**: Bot fell deep underground (Y:38) while navigating around blocked terrain. Surrounded by extreme mob density at night (pillagers, skeletons, creepers, endermen, zombies). HP dropped to 9 with no food. mc_build(shelter) was called but skeleton killed bot during construction.
- **Location**: (-3, 38, 14) birch_forest
- **Coordinates**: (-3, 38, 14)
- **Last Actions**: mc_navigate (multiple blocked) → mc_flee → minecraft_pillar_up (failed - placement failed) → mc_gather oak_log (120s timeout) → mc_build(shelter) → killed by skeleton during construction
- **Root Cause**: minecraft_pillar_up "placement failed" bug prevents escaping deep underground. Once underground at night, mob density becomes lethal.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Respawned at (-9, 112, 6) with inventory intact. minecraft_pillar_up failure is a repeated bug that needs investigation.

---

## [2026-03-22] Bug: Claude1 near-death from starvation/creeper - Phase 2 start

- **Cause**: Bot started session with HP 0.1 and no food. hunger dropped to 2. Creeper approached at 15 blocks while at HP 0.1. mc_flee triggered. Suspected respawn occurred (HP/hunger jumped to 20/20 after flee).
- **Location**: ~(7, 92, 8) birch_forest
- **Coordinates**: (7, 92, 8)
- **Last Actions**: mc_flee x2 from creeper. After second flee, HP/hunger restored to 20/20 - likely respawn triggered.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true. Now at full HP/hunger, proceeding with Phase 2.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton - Phase 2 attempt

- **Cause**: Bot navigated underground while searching for crafting table. Y dropped from 98 to 85. Skeleton found bot underground, shot and killed while HP was already low (8/20). mc_navigate pathfinder chose underground cave route.
- **Location**: ~(7, 85, 8) birch_forest
- **Coordinates**: (7, 85, 8)
- **Last Actions**: Crafted bone_meal, navigated to crafting table, fell into cave system. Skeleton attacked at night with HP already at 8 from travel damage.
- **Fix Applied**: None yet. Root cause: mc_navigate sometimes routes through caves. Need to stay above Y=90 at night.
- **Status**: Recorded. keepInventory=true, respawned with all items.

---

## [2026-03-22] Bug: Claude1 drowned - Session 44

- **Cause**: mc_navigate fell bot into underground water while pathfinding to coordinates (100, 96, 0). Bot ended up at Y=72 underwater with 0 hunger, surrounded by mobs. Drowned.
- **Location**: ~(15, 72, 3) birch_forest
- **Coordinates**: (15, 72, 3)
- **Last Actions**: Trying to navigate to surface/find animals for food. mc_navigate sent bot underground through cave system instead of staying on surface. Hunger reached 0 with no food available.
- **Fix Applied**: None - navigation pathfinding issue sends bot underground via caves
- **Status**: Recorded. Respawned with full HP/hunger. keepInventory=true.

---

## [2026-03-22] Bug: Claude1 doomed to fall by Phantom - Session 43

- **Cause**: Claude1 was killed by a Phantom. Phantoms spawn when a player hasn't slept for 3+ nights. Bot does not sleep regularly, accumulating "insomnia" counter.
- **Location**: Unknown (observed via server message)
- **Coordinates**: Unknown
- **Last Actions**: Operating at night (midnight, tick ~20233). Phantom attacks from above, hard to flee.
- **Fix Applied**: None yet. Root cause: no sleep → Phantom spawns. Need to sleep every night or avoid being outside at night.
- **Status**: Recorded. keepInventory=true so items preserved.

---

## [2026-03-22] Bug: Claude1 slain by Skeleton - Session 42

- **Cause**: HP dropped to 0.8 at night (tick ~17633). Had no food. Skeleton attacked from south. Flee didn't create enough distance. Pillar attempt failed initially (no solid ground check), then succeeded at different location but too late - bot had already died/respawned at Y:121.
- **Location**: ~(22, 42, -3) birch_forest
- **Coordinates**: (22, 42, -3)
- **Last Actions**: Tried to craft white_bed, craft chain failed trying to make bone. Navigated to crafting table, multiple hostile mobs (skeleton x2, creeper, enderman, zombie) cornered bot. Fleeing didn't help, pillar-up failed first attempt.
- **Fix Applied**: None yet. Root cause: night survival with 0 hunger + 0 food + multiple mobs. Need to stay indoors at night.
- **Status**: Recorded. Respawned with full HP/hunger. keepInventory=true.

---

## [2026-03-22] Bug: Claude1 slain by Zombie at Y=86 - mc_flee insufficient distance

- **Cause**: Bot navigated to Y=86 (underground/hillside) where 4 hostile mobs were present in daytime. mc_flee executed 3 times but distance was insufficient (10, 1.8, 20 blocks). Zombie killed bot after third flee. No food to heal, no armor.
- **Location**: (~-10, 86, 4) birch_forest
- **Coordinates**: (-10, 86, 4)
- **Last Actions**: bucket fill failed x3 → mc_status showed threats at Y=86 → mc_flee x3 → death
- **Fix Applied**: None. Root cause: pathfinding drops bot to low Y where mobs concentrate. mc_flee doesn't always escape in correct direction.
- **Status**: Recorded. Respawned at (-10, 108, 5). keepInventory=true.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton during mc_navigate to water - Phase 2 farming

- **Cause**: mc_navigate to water at (12, 101, 10) for farming setup. Navigation returned "Path blocked" but during navigation attempt, skeleton killed Claude1. Bot was at Y=86 when killed, likely caught by skeleton during pathfinding.
- **Location**: (~-10, 86, 4) birch_forest
- **Coordinates**: (-10, 86, 4)
- **Last Actions**: mc_farm (planted 2 seeds near water, HP dropped to 17) → mc_navigate(12,101,10) → "Claude1 was shot by Skeleton"
- **Fix Applied**: None - recording only. Root cause: no armor, skeleton attacked while pathfinding near Y=86 cave area.
- **Status**: Recorded. Respawned at Y=116 with full HP/hunger. keepInventory=true. Items intact.

---

## [2026-03-22] Bug: Claude1 死亡 - 洞窟内飢餓+モブ包囲

- **Cause**: mc_navigateが繰り返し地下洞窟ルートを選択。Y=70-74の洞窟内でHP9腹0の状態で多数のモブ（クリーパー2体・ゾンビ・ピリジャー・スケルトン）に包囲。pillar_upも洞窟天井で失敗。脱出不可能で死亡と推定（ステータスがHP14.3腹20に突然変化→リスポーン）。
- **Location**: (-5~-22, 70-74, -14~-22) birch_forest 洞窟内
- **Coordinates**: (-22.4, 73.9, -22.3) 最後の確認位置
- **Last Actions**: 洞窟内でpillar_up失敗 → mc_flee → mc_navigate失敗を繰り返し → 死亡リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true。リスポーン後HP14.3腹20でY=92地上に出現。

---

## [2026-03-22] Bug: Claude1 死亡 - 朝HP10腹0、モブ包囲で脱出失敗

- **Cause**: 接続時HP10/hunger0の状態。朝(ticks=2553)にもかかわらず周囲にCreeper・Skeleton・Zombie・Endermanが密集。flee()を複数回試みるも逃げられず。食料もなくHP4.5まで低下。pillarUp()が30秒タイムアウト。その後HP2に低下し死亡リスポーン（HP20/hunger20に変化）。
- **Location**: (~-5, 92, -5) old_growth_birch_forest
- **Coordinates**: (-1.5, 89, 9.6) 最低HP確認位置
- **Last Actions**: bot.flee(20) x2 → bot.moveTo(南方向) 失敗 → bot.flee(25) → HP2 → bot.pillarUp(5) タイムアウト → 死亡リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true。リスポーン後HP20/hunger20。朝でもモブが大量出現する原因は不明（難易度設定？biome特性？）。

---

## [2026-03-22] Bug: Claude1 HP9腹0 多数モブ包囲 - Phase 2 Session (current)

- **Cause**: mc_navigateが地下洞窟を通るルートでボットがY=73まで降下。クリーパー・ピリジャー・スケルトン2体に包囲。HP9、腹0で飢餓ダメージ進行中。食料なし、動物なし。チェストへのパスが全てブロックされ食料補充不可。
- **Location**: (-6.4, 73, 1.5) birch_forest
- **Coordinates**: (-6.4, 73, 1.5)
- **Last Actions**: mc_navigate → 地下洞窟経由で降下 → 多数のモブに包囲 → mc_flee → チェスト到達不可
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 危険状態。地表へ上がる必要あり。mc_navigateが繰り返し地下洞窟ルートを選択する根本バグあり。

---

## [2026-03-22] Bug: Claude1 slain by Phantom + fell from high place - Phase 2 Session (current)

- **Cause**: Phantom attacked Claude1 during daytime farming operation at ~(20, 103, 29). Phantoms spawn when a player has not slept for 3+ game nights. Bot does not sleep regularly. After Phantom hit, bot fell from high place (was on elevated terrain). Double death event: "Claude1 was slain by Phantom" then "Claude1 fell from a high place".
- **Location**: ~(20, 103, 29) birch_forest
- **Coordinates**: (20.5, 103, 29.5) approximate
- **Last Actions**: mc_farm (planting/tilling near water at 16,102,20) → Phantom attacked → fell from elevation → death
- **Fix Applied**: None yet. Root cause: no sleep between nights → Phantom insomnia timer maxes out. Need mc_sleep every night before tick 12541.
- **Status**: Recorded. Respawned at (-1.5, 88, 1.5) with inventory intact (keepInventory=true). HP 16.3, hunger 16. Multiple threats at respawn: pillager(15.8), zombie(12.4), enderman(14.5).

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 41

- **Cause**: HP dropped to 8 at night (midnight) with no food. Was navigating rugged old_growth_birch_forest terrain trying to reach base chest. Zombie killed bot before reaching safety.
- **Location**: ~(-9, 114, -8) old_growth_birch_forest
- **Coordinates**: (-9.0, 114.0, -8.0)
- **Last Actions**: Navigating to chest at (-9, 99, 4) to get food. Multiple navigate failures due to path blocked. Killed by zombie at midnight.
- **Fix Applied**: None. Root cause: low HP + no food + night navigation in rugged terrain.
- **Status**: Recorded. Respawned with full HP/hunger at (8, 87, 6). keepInventory=true.

---

## [2026-03-21] Bug: Claude1 drowned - Session 40b (observed by Claude2)

- **Cause**: "Claude1 drowned" — Claude1 drowned after respawning from zombie death. Likely fell into water while navigating.
- **Location**: Unknown
- **Coordinates**: Unknown
- **Last Actions**: Claude1 had just respawned after zombie death. Was navigating east to hunt cows.
- **Fix Applied**: None. Root cause: respawn position + navigation at night near water.
- **Status**: Recorded by Claude2.

---

## [2026-03-25] Bug: moveTo() completely fails - bot stuck at same position - Session (current)

- **Cause**: bot.moveTo() called with various targets (nearby 5-100 blocks) but bot never moves. Position stays at (-10, 81, 13) regardless of target. creeper×4, zombie×2, enderman×1 nearby. Hunger=0, HP=10.
- **Coordinates**: (-10, 81, 13)
- **Last Actions**: moveTo(px+20, py, pz+20) → stayed at same pos. moveTo(px+100, py, pz+100) → same. moveTo(south -Z 50) → same. All 5 step-moves (5 blocks each) failed.
- **Error**: No error thrown, but position unchanged after moveTo completes.
- **Root Cause**: Unknown. Possibly pathfinder blocked by terrain/mob density. Bot is in old_growth_birch_forest at Y=81 with creepers surrounding. flee() also fails to move bot.
- **Impact**: Bot completely immobile. Cannot hunt food, gather logs, or escape enemies.
- **Fix Needed**: moveTo/flee should detect when bot is truly stuck (position unchanged after timeout) and try alternative strategies (pillarUp, dig path, teleport-style movement).
- **Status**: Reported. Session current. Hunger=0 HP=10. BLOCKING.

---

## [2026-03-22] Bug: mc_reload triggers full process restart instead of hot module reload

- **Cause**: mc_reload always responds with "Full hot-reload complete (process restart)" instead of performing a module-level hot reload. This means the bot disconnects and reconnects on every call, causing disruption to gameplay.
- **Location**: src/index.ts (mc_reload handler) / SIGUSR1 handler
- **Coordinates**: N/A
- **Last Actions**: Called mc_reload to initialize registry.highLevel so bot.craft() could work.
- **Root Cause**: Suspected: mc_reload sends SIGUSR1 to itself, which triggers process restart in the MCP server launcher. Or the reload handler itself restarts the process.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Impact: registry.highLevel is never initialized on startup → bot.craft() always fails.

---

## [2026-03-22] Bug: registry.highLevel undefined on startup - bot.craft() always fails

- **Cause**: index.ts does not import high-level-actions.ts at startup. registry.highLevel is only populated when high-level-actions.ts is imported. Since index.ts never imports it directly, registry.highLevel remains undefined until mc_reload is called — but mc_reload restarts the process, which resets registry again.
- **Location**: src/index.ts (missing import of high-level-actions)
- **Coordinates**: N/A
- **Last Actions**: Called bot.craft('white_bed', 1, false) — error: "Cannot read properties of undefined (reading 'minecraft_craft_chain')"
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Workaround: use lower-level mineflayer craft API directly in mc_execute if possible.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 40 (observed by Claude2)

- **Cause**: "Claude1 was slain by Zombie" — Claude1 was hunting cows east of base at night.
- **Location**: Unknown (east of base, birch_forest area)
- **Coordinates**: Unknown
- **Last Actions**: Claude1 was reported to be heading east to hunt cows. It was nighttime (tick ~15933).
- **Fix Applied**: None. Root cause: navigating/hunting at night without sufficient armor/food protection.
- **Status**: Recorded by Claude2. keepInventory=true so items preserved.

---

## [2026-03-21] Bug: Claude1 fell from high place at spawn - Session 39

- **Cause**: "Claude1 fell from a high place" — Respawned at y=123, fell while stationary (possibly from trying to craft at high elevation).
- **Location**: ~(-9, 123, 5) spawn area
- **Coordinates**: (-9.0, 123.0, 5.0)
- **Last Actions**: Respawned at y=123 after zombie death. Tried mc_sleep (no bed), tried mc_craft (bed), fell during craft attempt.
- **Fix Applied**: None. Root cause: spawn point is at y=123, bot falls off edge when idle.
- **Status**: Recorded. Now morning (tick 1513). Continuing east safely.

---

## [2026-03-21] Bug: Claude1 slain by Zombie during night navigation - Session 38

- **Cause**: "Claude1 was slain by Zombie" — Navigating east at midnight (tick ~22213). Zombie attacked at ~(77, 82, -5) while path was blocked.
- **Location**: ~(77, 82, -5)
- **Coordinates**: (77.0, 82.0, -5.0) then respawn (-9, 123, 5)
- **Last Actions**: Navigating east from respawn at (-5, 100, -7). Path blocked multiple times, descended to y=82. Zombie killed bot.
- **Fix Applied**: None. Root cause: navigating at night with no armor (only iron_boots) and no food.
- **Status**: Recorded. Respawned at (-9, 123, 5). Waiting for dawn before navigating.

---

## [2026-03-21] Bug: Claude1 fell to death navigating east - Session 37

- **Cause**: Fall death while navigating around x=259, y=61, z=22 area. Path was blocked and bot fell into ravine/cliff when attempting alternate route.
- **Location**: ~(259, 61, 22)
- **Coordinates**: (259.1, 61.1, 22.0) then respawn (-5.3, 100, -7.7)
- **Last Actions**: Navigating east from x=144 toward cow at (333, 69, 64). Multiple hops at y=61-64. Tried shifting Z to get around obstacle. Fell.
- **Fix Applied**: None yet. Root cause: pathfinder descended to y=61 during east navigation, hit ravine area ~x=259.
- **Status**: Recorded. Respawned at (-5, 100, -7). It is midnight - must wait or navigate carefully.

---

## [2026-03-21] Bug: Claude1 slain by Zombie Villager - Session 36

- **Cause**: "Claude1 was slain by Zombie Villager" — Immediately after respawn at (0, 96, -1), navigated to x=100. Zombie Villager killed bot before reaching destination.
- **Location**: ~(0, 96, -1) spawn area
- **Coordinates**: (0.0, 96.0, -1.0)
- **Last Actions**: Respawned after Skeleton death. First navigate call to x=100. Death message appeared during navigation.
- **Fix Applied**: None. Root cause: Zombie Villager in spawn area, bot has no armor after respawn.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 shot by Skeleton - Session 35

- **Cause**: "Claude1 was shot by Skeleton" — Navigating east at ~x=108, Y=75, Z=6. HP was already low (6.8) with no food. Skeleton shot bot to death.
- **Location**: ~(108, 75, 6)
- **Coordinates**: (108.5, 75.0, 6.5)
- **Last Actions**: Repeated mc_navigate hops east through old_growth_birch_forest, all paths blocked. HP=6.8, no food in inventory.
- **Fix Applied**: None. Root cause: low HP + no food + skeleton in dense forest. Need to eat wheat or avoid prolonged blocked navigation near skeletons.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned x2 - Session 34

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at ~x=232, Y=61, Z=52. HP hit 0 while drowned were 6-7 blocks away. Second death: mc_flee triggered but Drowned killed bot before escape.
- **Location**: ~(232, 61, 52)
- **Coordinates**: (232.7, 61, 52.3)
- **Last Actions**: mc_navigate hops east, reached x=227, then moved to x=232. Status showed HP=0, two Drowned at 6-7 blocks. mc_flee executed but second death occurred.
- **Fix Applied**: None. Root cause: Y=61-62 near water/river, Drowned spawn. Need to route above Y=65 past x=200.
- **Status**: Recorded. Respawned at base. Continuing east.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 33

- **Cause**: "Claude1 was blown up by Creeper" — Just respawned, moving east at x=50, Y=91. Creeper exploded during navigate call.
- **Location**: ~(52, 91, 6)
- **Coordinates**: (52, 91, 6)
- **Last Actions**: Respawned from Drowned death, attempted mc_navigate to x=50.
- **Fix Applied**: None. Root cause: Creepers still present near base area. Night/dawn timing.
- **Status**: Recorded. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned - Session 32

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at ~x=248-280, Y=62, Z=17. Drowned killed bot near river/water area.
- **Location**: ~(248-280, 62, 17)
- **Coordinates**: ~(260, 62, 17) estimated
- **Last Actions**: mc_navigate hops east from base toward cow at (333,69,64). Reached x=248, then next hop to x=280 triggered death.
- **Fix Applied**: None. Root cause: Y=62 near water level, Drowned spawn in rivers.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned - Session 31

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at night. Reached x=233 before a Drowned killed the bot. Likely in or near water.
- **Location**: ~(233, 61, 55)
- **Coordinates**: ~(233, 61, 55)
- **Last Actions**: mc_navigate hops east, reached x=213 then x=233. Next hop to x=265 triggered death message.
- **Fix Applied**: None. Root cause: Navigating at night through water/river areas where Drowned spawn. Y=61 is near water level.
- **Status**: Recorded. Respawned at (0.5, 97.4, 11.5). Continuing east.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 30

- **Cause**: "Claude1 was blown up by Creeper" — Bot had HP=6, navigating east at night through forest. Bot was moving in 20-block hops trying to reach cow at (333, 69, 64). A creeper exploded during mc_navigate call.
- **Location**: ~(180, 66, 40), birch_forest area, midnight
- **Coordinates**: ~(180, 66, 40)
- **Last Actions**: mc_navigate hops east → killed spider at (64, 80, 6) → continued east → blown up by creeper at ~x=180
- **Fix Applied**: None. Root cause: Navigating at night with low HP (6) through forest. Creeper snuck up during path execution. Lesson: Should either wait for day or keep HP > 10 at night to give more buffer.
- **Status**: Recorded. Respawned with keepInventory at (10, 97, -6), HP=20, Hunger=20.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 29

- **Cause**: "Claude1 was slain by Zombie" — Bot had HP=4.3, Hunger=13, night time, zombie 11.7m north. Agent had just loaded tools and read status but bot was already in critical HP at night with a zombie in close range. Bot died before any survival action could be taken.
- **Location**: (356, 64, 123), birch_forest
- **Coordinates**: (356, 64, 123)
- **Last Actions**: Previous session left bot at HP=4.3 at night with zombie nearby. Session started, checked chat, bot was already dead.
- **Fix Applied**: None yet. Root cause: Session resumed with bot at critically low HP (4.3) at night with mob in range. The bot should have pillar-upped or fled immediately at end of previous session before stopping. Lesson: Never end a session with HP < 8 at night without safety measures.
- **Status**: Recorded. Respawned with keepInventory.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 28

- **Cause**: "Claude1 was slain by Zombie" — Bot at Hunger=1, HP=14, traveling east through old_growth_birch_forest at night. mc_combat(zombie) killed 2 zombies but one hit the bot. With hunger at 1 and unable to regenerate HP, a zombie finally killed the bot.
- **Location**: Around (51-74, 73-79, -18 to -49) old_growth_birch_forest, midnight.
- **Coordinates**: Death at approximately (74, 73, -49) or nearby.
- **Last Actions**: mc_navigate east → mc_combat(zombie) x2 → mc_navigate(70, 75, -18) → slain by zombie.
- **Fix Applied**: None. Root cause: Bot navigating at night with critical hunger (1) and HP 14 with no food. Cannot regenerate HP. Any zombie hit is dangerous. Lesson: Do NOT navigate at night with critical hunger/HP. Either wait for day or use flee_at_hp higher to avoid zombie contact.
- **Status**: Recorded. Respawned with keepInventory at (-10, 114, 5), HP=20, Hunger=20.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 27

- **Cause**: "Claude1 was blown up by Creeper" — During mc_combat(zombie), a creeper at 11.8 blocks east exploded. The zombie combat caused movement that brought the bot near the creeper.
- **Location**: Around (-39, 74, -6) old_growth_birch_forest, night.
- **Coordinates**: Death during zombie combat at night.
- **Last Actions**: mc_status showed creeper 11.8 blocks east + spider 12.4 blocks north. Then mc_combat(zombie) → blown up by creeper.
- **Fix Applied**: None yet. Root cause: mc_combat doesn't flee from creepers before engaging zombies. Need to flee from creepers first, THEN engage zombies. Or: mc_combat should have flee_at_hp high enough to survive one hit, but creeper explosions are 1-shot from close range.
- **Status**: Recorded. Died, respawned with keepInventory at (-14, 100, -11).

---

## [2026-03-21] Bug: Claude1 fell from a high place - Session 26

- **Cause**: "Claude1 fell from a high place" — mc_navigate(x=10, y=116, z=4) caused fall. Bot was at y=116 surface, pathfinder tried to navigate and bot fell to y=86, losing ~5 HP.
- **Location**: Started at (-7, 116, 4), fell to (6, 86, -1) birch_forest.
- **Coordinates**: Fall from y=116 to y=86 = 30 block drop.
- **Last Actions**: Dropped junk items → mc_navigate(x=10, y=116, z=4) → fell off cliff.
- **Fix Applied**: None yet. Root cause: maxDropDown setting too permissive. The recent fixes (commits 5539442, 822389e) reduced maxDropDown to 1 but this fall still occurred. May need to investigate why pathfinder took a 30-block cliff path.
- **Status**: Recorded. HP now 14.8, no immediate danger.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 25

- **Cause**: "Claude1 was slain by Zombie" — Bot at 0.8 HP with no food, trying to navigate to chest at (-1, 88, -2). Zombie attacked during navigation and killed bot.
- **Location**: (-1.7, 103, -9.8) birch_forest, daytime.
- **Coordinates**: Death around (-1.7, 103, -9.8). Respawned at (-2.7, 94, 2.7).
- **Last Actions**: mc_navigate to chest → killed by zombie. HP was already 0.8 — critical. Had no food in inventory.
- **Fix Applied**: None. Root cause: After previous respawn (Session 24), bot took damage (likely fall damage from height 82 → 83 area, or hit by mob) before reaching safety. With 0.8 HP and no food, any mob contact = death. Lesson: After respawn, IMMEDIATELY check HP and navigate to chest for food. Do NOT explore with 0.8 HP.
- **Status**: Recorded.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 24

- **Cause**: "Claude1 was blown up by Creeper" — Bot was at HP 11.2 with no food, attempted mc_combat(zombie) at dawn with creeper at 5.2 blocks east. mc_combat triggered flee but creeper exploded first.
- **Location**: (8.4, 73, -0.5) birch_forest at dawn/day transition.
- **Coordinates**: Death around (8, 73, -1). Respawned at (-0.5, 82, -3.4).
- **Last Actions**: mc_flee (from creeper at 5.4 blocks) → mc_combat(zombie, flee_at_hp=8) → "Fled! Health was 0. Attacked 0 times." — creeper exploded during flee.
- **Fix Applied**: None. Root cause: (1) No armor worn despite having iron_sword; (2) Engaged combat with creeper at close range (5 blocks) — must maintain 7+ block distance from creepers; (3) HP was already 11.2 before engagement. Lesson: NEVER approach creeper within 6 blocks. Always craft and equip armor before any mob combat.
- **Status**: Recorded.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 23

- **Cause**: "Claude1 was slain by Zombie" — Bot was at HP 0.6 with hunger 8, multiple zombies nearby after flee was too slow. mc_flee triggered but death occurred before escape completed.
- **Location**: Around (-118, 70, -59) old_growth_birch_forest at night.
- **Coordinates**: Death around (-118, 70, -59). Respawned at (-6, 114, -11).
- **Last Actions**: mc_combat(zombie, flee_at_hp=4) → fled at HP 3.1 → status showed 0.6 HP → mc_flee(30) → died during flee.
- **Fix Applied**: None yet. Root cause: flee_at_hp=4 threshold too low; zombie combat at critically low HP. flee_at_hp should be higher (6+) when starting HP is already low. Also: item collection bug — zombies defeated but no rotten_flesh dropped.
- **Status**: Recorded. Lesson: never engage zombies at night when HP < 7. flee_at_hp must be set relative to current HP, not absolute.

---

## [2026-03-22] Bug: bot.craft() fails silently - chest not crafted

- **Cause**: `bot.craft('chest', 2)` and `bot.craft('chest', 2, true)` both return "Crafted chest x2" but inventory shows no chest. Internal error logged: `TypeError: Cannot read properties of undefined (reading 'minecraft_craft_chain')`. The craft function catches the error from Attempt 1, falls back to something, reports success, but does not actually add items to inventory.
- **Location**: src/tools/core-tools.ts (craft implementation) - autoGather=false path
- **Coordinates**: (34, 60, 46) near crafting table
- **Last Actions**: Navigated to crafting table at (34,60,46). Called bot.craft('chest', 2) → no chest in inventory. Called bot.craft('chest', 2, true) → same result.
- **Fix Applied**: None (code fix prohibited per user instructions)
- **Status**: Investigating workaround. Will try mc_craft via autoGather=true path instead.

---

## [2026-03-22] Bug: Claude1 drowned - Session current

- **Cause**: "Claude1 drowned" — Bot was waiting at night (ticks 15653) at y=86 with hunger=0, HP=8.2. During 30s wait, bot drowned. Exact location of water unknown but bot was placed in or fell into water near y=86 area. After respawn HP=20, hunger=20 (keepInventory).
- **Location**: y=86 area near (15, 86, 12) birch_forest.
- **Coordinates**: Death around (15, 86, 12) or nearby water source.
- **Last Actions**: Built dirt walls → HP 8.2 hunger 0 → waited 30s → drowned.
- **Fix Applied**: None (code fix prohibited per user instructions).
- **Status**: Recorded. Root cause: Bot was in or near water when waiting. bot.wait() does not move bot to safety before waiting — it just halts for N ms. Need to ensure bot is on solid ground before waiting. Also: moveTo was blocked by hunger=0 guard, so bot could not escape water. The hunger=0 moveTo guard may be too aggressive — it prevented finding food.

## [2026-03-21] Bug: Claude1 shot by Skeleton while pillaring - Session 22

- **Cause**: "Claude1 was shot by Skeleton" — Bot was at HP 3.1 with hunger 0, tried to pillar up 15 blocks to reach base. Was shot by skeleton while exposed during pillar climb at night.
- **Location**: Around (19, 72, -40) birch_forest, pillaring up.
- **Coordinates**: Death around (19, 72-100, -40). Respawned at (21, 102, -19).
- **Last Actions**: mc_flee (skeleton), mc_combat(sheep) - no sheep found, minecraft_pillar_up(15) → killed by skeleton.
- **Fix Applied**: None. Root cause: attempted to pillar up at night while HP was critically low (3.1). Should have prioritized shelter/hiding instead of climbing.
- **Status**: Recorded. Lesson: with HP < 5 at night, do NOT pillar up. Find indoor shelter or dig into ground.

---

## [2026-03-21] Bug: Claude1 doomed to fall by Skeleton - Session 21b

- **Cause**: "Claude1 was doomed to fall by Skeleton" — Skeleton knockback caused fatal fall. Occurred during navigation at night while trying to return to base after spider death.
- **Location**: Around (-3, 68, -10) birch_forest during mc_navigate to chest at (-1, 88, -2).
- **Coordinates**: Was at (-3, 68, -10), respawned at (11, 108, 1).
- **Last Actions**: mc_navigate(x=-1, y=88, z=-2) to return to chest. Skeleton knockback caused fall. This is the 2nd consecutive death from night mobs.
- **Fix Applied**: None. Root cause: navigating at night in open terrain. Must NOT navigate at night. Must build emergency shelter when night falls.
- **Status**: Recorded. Lesson: when night arrives, stop all navigation and build immediate shelter.

---

## [2026-03-21] Bug: Claude1 slain by Spider during navigation - Session 21

- **Cause**: "Claude1 was slain by Spider" — Bot was navigating toward coordinates (-150 Z) at midnight when killed by a spider. Bot was navigating at night with multiple threats nearby (enderman, zombie, skeleton). Spider attack likely happened during movement through dark terrain.
- **Location**: Navigation through dark terrain at night without checking threats first.
- **Coordinates**: Death around (-6, 96, 1) birch_forest. Respawned at (-14, 82, -31).
- **Last Actions**: mc_navigate(x=2, y=92, z=-150) — navigating at midnight with multiple threats (enderman 9 blocks, zombie 13 blocks, skeleton 3 blocks nearby after death).
- **Fix Applied**: None yet — root cause is navigating at night in open terrain without threat awareness. Need to avoid long-distance navigation at night.
- **Status**: Recorded. Immediate action: flee to shelter, wait for dawn.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 20

- **Cause**: "Claude1 was slain by Zombie" — observed in chat. Bot was apparently attacked by a zombie and killed. This could indicate: (1) bot was caught outside at night without shelter, (2) mc_combat failed to handle a zombie encounter properly, or (3) pathfinder walked bot into a zombie spawn area.
- **Location**: Unknown — death location not recorded by this agent. Zombie kills are melee-based.
- **Coordinates**: Unknown at time of death. This agent was at (-1, 116, -35) when message appeared.
- **Last Actions**: Claude1 was slain by Zombie per server chat message at midnight.
- **Fix Applied**: Investigating — possible need for proactive zombie avoidance at night (threats detection + flee before combat).
- **Status**: Investigating

---

## [2026-03-21] Bug: Fall death near ravine - Session 19

- **Cause**: "Claude1 hit the ground too hard" — fatal fall near a ravine. Bot walked off cliff edge or pathfinder allowed a drop into ravine. Previous fix set `maxDropDown=0` during mc_flee, but bot may have fallen during normal navigation near ravine terrain.
- **Location**: Likely `src/bot-manager/bot-movement.ts` or `src/tools/core-tools.ts` mc_navigate — pathfinder maxDropDown may still allow falls during standard navigation near cliffs/ravines.
- **Coordinates**: Death location unknown (near ravine). Respawned at (-7, 103, -6) birch_forest biome.
- **Last Actions**: Normal gameplay near ravine area. Fall death, not flee-related.
- **Fix Applied**: Investigation needed — check if mc_navigate also needs maxDropDown restrictions near cliff terrain.
- **Status**: Investigating

---

## [2026-03-21] Bug: Fall death during mc_flee - Session 18

- **Cause**: `mc_flee()` calculates a horizontal flee target and uses pathfinder with `maxDropDown=2`. When fleeing in a direction with terrain drop-offs (caves, ravines, cliffs), the pathfinder descends 2 blocks at a time repeatedly until a fatal fall occurs. Bot was at Y=68-70 underground with witch (W) + skeleton (E) — fled into cave terrain and fell.
- **Location**: `src/bot-manager/bot-movement.ts` `flee()` function line ~1110
- **Coordinates**: Died near (8, 69, 11), respawned at (-5, 117, 4)
- **Last Actions**:
  1. mc_status — HP=3.5, witch at 11.7 blocks W, skeleton at 15.1 blocks E
  2. minecraft_pillar_up(height=6) — only got 2 blocks (partial, placement failed)
  3. mc_flee(distance=50) — fled 14.5 blocks (insufficient)
  4. mc_flee(distance=50) — fled 11.2 blocks
  5. mc_flee(distance=50) — "Claude1 fell from a high place" — DEATH
- **Fix Applied**: Set `bot.pathfinder.movements.maxDropDown = 0` during flee to prevent any cliff drops. Restore to previous value after flee completes. This means flee may not move as far in terrain with drops, but the bot survives.
- **Status**: Fixed in `src/bot-manager/bot-movement.ts`

---

## [2026-03-20] Bug: Death by Zombie during sheep combat - Session 16

- **Cause**: Called `mc_combat(target="sheep")` at night while a zombie was nearby. The combat tool targeted the sheep but the zombie attacked the bot fatally. The mc_combat tool does not check for nearby hostile mobs before engaging passive targets.
- **Location**: `src/tools/core-tools.ts` mc_combat - no hostile mob check when targeting passive mobs at night
- **Coordinates**: Died near (-17, 114, -95), respawned at (7.5, 120, 8.6) base
- **Last Actions**:
  1. mc_status — HP=20, Hunger=20, night time (ticks=13433)
  2. mc_combat(target="sheep") — zombie attacked bot while targeting sheep
  3. Death: "Claude1 was doomed to fall by Zombie"
- **Fix Applied**: Behavioral: avoid mc_combat on passive targets at night. Code fix needed: mc_combat should warn or refuse to target passive mobs when hostile mobs are nearby.
- **Status**: Behavioral fix applied (avoid night combat on passives). Code fix pending.

---

## [2026-03-20] Bug: Fall death - "Claude1 hit the ground too hard"

- **Cause**: Bot fell from a high place during previous session. Likely cliff traversal or pathfinder chose a path over a ravine/edge.
- **Location**: Unknown - occurred in previous session
- **Coordinates**: Respawned at (4.5, 90, -4.5) birch_forest
- **Last Actions**: Unknown from previous session
- **Fix Applied**: Monitoring. Existing mc_tunnel tool and fall detection exist. Still investigating root cause.
- **Status**: Investigating

---

## [2026-03-20] Bug: Fall death during food emergency - Session 15

- **Cause**: During food emergency (HP=4, hunger=0), bot was navigating toward sheep at (-64, 112, -128). mc_navigate failed with "Path blocked" multiple times. Bot attempted intermediate waypoint navigation and fell from elevation ~114 to lower ground.
- **Location**: `src/tools/core-tools.ts` mc_navigate - pathfinder accepts unsafe high-elevation moves when blocked
- **Coordinates**: Died near (-17, 114, -95), respawned at spawn point
- **Last Actions**:
  1. mc_navigate to sheep at 155 blocks - path blocked
  2. mc_navigate to intermediate (-30, 81, -50) - path blocked, "5 blocks lower"
  3. mc_navigate to (-40, 112, -110) - path blocked, fell from high place
- **Fix Applied**: None yet. Root cause: when pathfinder reports "path blocked", bot still moves partial distance and can end up at cliff edges.
- **Notes**: keepInventory=true so no items lost. HP/hunger restored to 20/20 on respawn. This death was caused by unsafe navigation during an emergency, not combat.
- **Status**: Investigating - need to prevent pathfinder from dropping bot off cliffs when navigating to blocked targets

---

## [2026-03-20] Bug: mc_navigate x/y/z coordinates cause "x.toFixed is not a function"

- **Cause**: MCP client passes coordinate parameters as strings (JSON number type not always preserved). `moveTo()` receives string instead of number, fails on `.toFixed()` call.
- **Location**: `src/tools/core-tools.ts` mc_navigate function, coordinate navigation branch
- **Coordinates**: (4.5, 90, -4.5)
- **Last Actions**: Called `mc_navigate(x=12, y=89, z=4)` to navigate to wheat block
- **Fix Applied**: Added `Number()` coercion + NaN validation for x/y/z before passing to moveTo. Updated all references in the segmented navigation loop to use coerced nx/ny/nz values.
- **Status**: Fixed (commit pending)

---

## [2026-03-17] Bug: AutoFlee fires when approaching portal (within 3 blocks, HP<=10)

- **Cause**: AutoFlee triggered at HP=7.8 when bot was 2-3 blocks from portal entry point. The portal block suppression only checked if bot was INSIDE portal, but flee was redirecting the pathfinder goal before bot stepped in.
- **Location**: `src/bot-manager/bot-core.ts` — AutoFlee and CreeperFlee handlers
- **Coordinates**: OW ~(-43, 92, 88) near portal at (-46, 93, 87)
- **Last Actions**:
  1. Bot reached destination (-43.7, 92, 88.3) — portal was in reach
  2. Skeleton spawned nearby, HP dropped to 7.8
  3. AutoFlee fired, overriding the portal-entry pathfinder goal
  4. Bot fled away from portal to (-50, 91, 85)
- **Fix Applied**: Extended portal suppression to also check within 3 blocks of portal. If any nether_portal/end_portal within 3 blocks XZ and 2 blocks Y, suppress flee.
- **Fix Location**: `src/bot-manager/bot-core.ts` — AutoFlee and CreeperFlee handlers (commit 71e475a)
- **Status**: Fixed

---

## [2026-03-17] Bug: Death by Pillager in OW (AutoFlee insufficient vs ranged mob)

- **Cause**: Bot navigating near a Pillager Outpost at HP~8 in OW at night. AutoFlee triggered but pillager's ranged arrows continued hitting bot while fleeing. HP went 8→5→2→0.
- **Location**: `src/bot-manager/bot-survival.ts` — AutoFlee logic (flee toward safe direction doesn't clear pillager shots)
- **Coordinates**: OW approximately (-33, 71, 55) near a Pillager Outpost
- **Last Actions**:
  1. Navigating toward portal at (-46, 93, 87) in OW
  2. Path went through forested area near pillager outpost
  3. AutoFlee triggered but ranged mob kept shooting
  4. Death: "Claude1 was shot by Pillager"
- **Fix Applied**: None yet. AutoFlee doesn't help vs ranged mobs at distance
- **Workaround**: After respawn, admin (shng25) had already given HP=20, bot re-entered Nether successfully
- **Status**: Recorded. AutoFlee needs to prioritize cover vs ranged mobs.

---

## [2026-03-17] Bug: Death by fall in Nether (HP=1 with pathfinder going up)

- **Cause**: Bot at HP=1 attempted movement. Pathfinder chose route going UP to Y=116 (soul_sand_valley ceiling area) then fell 24+ blocks. At HP=1 any fall is lethal.
- **Location**: `src/bot-manager/bot-movement.ts` — MoveTo FALL DETECTED logic
- **Coordinates**: Nether ~(16, 88, -24) → died at ~(20, 116, -23) → fall to (20, 92, -23)
- **Last Actions**:
  1. HP=1 from skeleton attack in previous session
  2. Attempted `mc_navigate` to (38, 88, -35) to approach fortress
  3. Pathfinder took bot UP to Y=116 (ceiling), then bot fell
  4. System: "Claude1 fell from a high place"
- **Fix Applied**: The Nether deadlock fix (isDaytime=true in Nether) was applied but not sufficient to prevent this death. Root cause: pathfinder chose upward route at HP=1. The FALL DETECTED at 24 blocks was correct but too late.
- **Positive outcome**: Bot respawned in OW at (156,41,-104) with HP=13.3 and most items retained
- **Status**: Recorded. Need food before returning to Nether.

---

## [2026-03-18] Bug: Starvation deadlock — HP<8 + hunger=0 + no food blocks all movement at night

- **Cause**: At sunset (timeOfDay crossed 12541), `isDaytime` became false. Combined with HP=5 and `hpNow < 8` threshold, movement was blocked. But hunger=0 and no food in inventory means no way to recover HP. Staying in place is also fatal (slower starvation). Result: permanent deadlock.
- **Location**: `src/bot-manager/bot-movement.ts` lines 384-390
- **Coordinates**: OW (168, 59, -7) — forest, no animals within 128 blocks
- **Last Actions**:
  1. Area hunted out, hunger=0, HP=5
  2. Actions 1-7: navigate checks, all entity searches returned empty
  3. Action 8: navigate to (200,64,200) blocked by safety guard (tick had crossed 12541)
- **Fix Applied**: Added starvation-deadlock exception: when hunger=0 AND no food in inventory AND no hostile mobs nearby, movement is allowed at HP≥2 even at night. Rationale: staying put guarantees death; moving to find food is the only survival path.
- **Status**: Fixed

---

## [2026-03-17] Bug: Nether movement deadlock — isDaytime always false in Nether

- **Cause**: `bot.time.timeOfDay` in Nether dimension is always 0, and since `isDaytime = timeOfDay < 12541` resolves to `true` (0 < 12541), BUT the dimension check is separate. After investigation: ネザーでは敵mob（wither_skeleton）が存在し`hasHostileNearby`がtrueになり、HP=2で距離>30の移動がブロックされた。
- **Location**: `src/bot-manager/bot-movement.ts` line 331-337
- **Coordinates**: Nether (20, 85, -22)
- **Last Actions**:
  1. Navigating from (-12,110,2) to (100,50,-70) in Nether
  2. Skeleton encountered and attacked bot to HP=2
  3. mc_navigate blocked due to HP<8 + hostile nearby (night check)
  4. No food = cannot heal = permanent deadlock
- **Fix Applied**: Added Nether/End dimension detection. In Nether/End, `isDaytime=true` always (no day/night cycle). Also: hasHostileNearby check did NOT include wither_skeleton/blaze/ghast for Nether mobs. Net effect: `isDaytime=true` in Nether unlocks the looser HP≥2 threshold.
- **Fix Location**: `src/bot-manager/bot-movement.ts` — added `isNetherOrEnd` variable, set `isDaytime = isNetherOrEnd || timeOfDay < 12541`
- **Status**: Fixed (commit pending)

---

## [2026-03-16] Bug: Death by Zombie during dungeon navigation

- **Cause**: Bot navigated underground (y=-7) toward dungeon surface (87,60,-62) and encountered a Zombie
- **Location**: Around (83,-7,-61) - underground cave system
- **Coordinates**: (83, -7, -61) approximate death location
- **Last Actions**: 
  1. Started at (55,-16,-28) underground
  2. Navigated toward dungeon surface (87,60,-62) with canDig=true
  3. Bot dug through cave wall and encountered Zombie
  4. "Claude1 was slain by Zombie"
- **Fix Applied**: None yet. Underlying issue: pathfinder digs through walls without checking for hostiles behind them
- **Status**: Investigating

---

## [2026-03-16] Bug: Post-death script continuation causes incorrect navigation

- **Cause**: After death, bot respawned at (-7,118,2) but script continued trying to reach dungeon from wrong position
- **Location**: dungeon_torch_strategy.mjs - `died` flag not stopping navigation loop
- **Fix Applied**: The `died=true` flag was set but navTo() continued because `arrived=false` and `noPath=false` causes timeout wait, then continues regardless
- **Status**: Investigating. The navTo() function checks `!died` but loop continues after pathfinder.stop()

---

## [2026-03-16] Bug: Item drops (string from cobweb) not being collected

- **Cause**: bot.dig() causes item to drop but bot doesn't auto-collect. GoalNear(x,y,z,0) doesn't force pickup
- **Location**: tmp_scripts/collect_string.mjs - item collection after cobweb dig
- **Details**: 
  - itemDrop event fires, entity spawns with e.name === 'item'
  - GoalFollow(item, 0) doesn't successfully collect
  - Manual forward+jump movement doesn't work
- **Status**: Needs proper collection mechanism (collectBlock plugin or similar)

---

## [2026-03-16] Bug: Death from fishing at base - fell off platform

- **Cause**: fish_horizontal.mjs navigated to "water stand" position (14,100,9) which is actually on the edge of the base platform, bot fell to y=92 and died
- **Location**: tmp_scripts/fish_horizontal.mjs
- **Coordinates**: ~(14,100,9) - fell off base edge
- **Fix**: Base area water is NOT suitable for fishing - need outdoor/natural water
- **Status**: Recorded

---

## [2026-03-16] Bug: Death from HP=4.5/Food=0 - no survival check in script

- **Cause**: fish_for_book.mjs started with HP=4.5, Food=0. Script navigated toward mineshaft (y=-10) without checking survival first. Bot died during navigation.
- **Location**: tmp_scripts/fish_for_book.mjs - missing HP/food safety check at startup
- **Coordinates**: ~(68, -10, -39) death during navigation to mineshaft
- **Last Actions**:
  1. Started at (3.5, 67, 49.3) with HP=4.5, Food=0
  2. Navigated to chest (9,96,4) - dist 20.1 but chest open failed (inv full, empty slots=0)
  3. Navigated toward cobweb at (68,-10,-39) with HP still critical

---

## [2026-03-22] Bug: Claude1 溺死 - bot.moveTo(0,70,0)がy=117の水中に誘導 (Session現在)

- **Cause**: `bot.moveTo(0, 70, 0)` を呼んだところ、pathfinderがy=117の水中エリアに誘導し溺死(drowned)。hunger=0でHP=9.2の状態から食料確保のために移動しようとしたが、指定Y=70を無視してy=117に移動した。
- **Location**: `src/bot-manager/bot-movement.ts` — moveTo関数のY座標指定が無視される可能性
- **Coordinates**: 開始(6, 78, 8) → 死亡(0, 117, 0)付近 → リスポーン(-6, 117, 4)
- **Last Actions**:
  1. HP=9.2, Hunger=0, 夜明け, 防具なし
  2. 食料確保のため `bot.moveTo(0, 70, 0)` を呼んだ
  3. y=117の水中エリアへ誘導されて溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡確認。keepInventoryでアイテム保持。moveTo のY指定が無視されるバグ要調査。教訓: hunger=0/HP低い状態でmoveToを使わない。bot.navigate("animal")で動物を探す方が安全。
  4. "BOT DIED!" during underground navigation
- **Fix Needed**: All scripts must check HP/food at startup and abort if HP < 6 or food = 0
- **Fix Applied**: None - standalone script issue
- **Status**: Recorded

---

## [2026-03-16] Bug: Death from HP=2.17/Food=2 during navigation back to base

- **Cause**: craft_book_final.mjs started with HP=2.17, Food=2 after cow hunt. `bot.consume()` timed out. Bot died during long-distance navigation from (-78,91,213) to base.
- **Location**: tmp_scripts/craft_book_final.mjs - EPIPE error = bot death during nav
- **Coordinates**: (~-78,91,213) → death somewhere between there and base
- **Last Actions**:
  1. hunt_animals.mjs found cow at (-94,97,181), killed it, got leather x1
  2. craft_book_final.mjs started at HP=2.17, Food=2
  3. `bot.consume()` timed out (food not consumed)
  4. Bot navigated toward base with HP=2.17 and died
- **Fix Applied**: survival_and_craft.mjs improved eat logic using activateItem() loop
- **Note**: keepInventory=true confirmed - bot respawned with HP=20, Food=20, all items intact
- **Status**: Recorded (keepInventory saved progress)

---

## [2026-03-16] Bug: Death during portal lighting attempt at (-44,93,88)

- **Cause**: Bot died at y=93 while attempting to activate portal frame. Frame was incomplete (top row 2/4). Likely fell off incomplete frame or void below portal site.
- **Location**: complete_and_light_portal.mjs
- **Coordinates**: Died near (-44,93,88), respawned at (1,92,-1)
- **Last Actions**:
  1. Placed bottom row of portal at (-47 to -44, y=92, z=87)
  2. Attempted to light with flint_and_steel activateBlock()
  3. Portal not valid (top row incomplete), bot apparently fell off the structure
- **Fix Needed**: Complete the top row before attempting to light. Also ensure bot stands safely at portal base level, not elevated.
- **Status**: Recorded (keepInventory=true, items intact)

---

## [2026-03-16] Bug: Bot death in Nether (HP→0.5) during dig_tunnel_up script

- **Cause**: dig_tunnel_up.mjs started with HP=2.5 (inherited from pillar_v2 failure). Script checked `bot.health <= 2` but bot had HP=0.5 at the time of stopping. Bot may have taken mob damage.
- **Location**: tmp_scripts/dig_tunnel_up.mjs
- **Coordinates**: ~(-12, 82-98, 3) in the_nether
- **Last Actions**:
  1. pillar_v2.mjs failed to pillar (0 blocks gain), ended at y=83 with HP=2.5
  2. dig_tunnel_up.mjs started with HP=2.5
  3. Bot navigated to (-12,98,3), touching portal block at y=98
  4. HP critical message: 0.5, stopped climbing
  5. Portal teleport happened: bot went from the_nether to overworld (11,109,-7) with HP=20 Food=20
- **Note**: HP reset to 20 after teleport confirms this was a death+respawn through keepInventory
- **Fix Needed**: Scripts must abort when HP < 5 in Nether (mob damage risk is high)
- **Status**: Recorded (keepInventory=true, items intact after respawn)

---

## [2026-03-16] Nether Fortress Search - Server Down

- **Status**: Minecraft server (port 25565) is DOWN as of 17:50
- **Last Known Bot Position**: (~-3,54,-40) in the_nether, HP=10, Food=0
- **Previous exploration**: Covered x=-200 to x=200, z=-200 to z=200 without finding nether_bricks
- **Fortress location**: Unknown. Need to search further (+300, +400 blocks from spawn)
- **Note**: Pathfinder frequently fails in Nether due to complex terrain (lava, soul sand valleys)
- **Action Required**: User must restart Minecraft server. Then resume fortress search.

---

## [2026-03-16] Bug: Death in Nether - lava while navigating to fortress (Session 177)

- **Cause**: Bot fell into lava while navigating toward nether_bricks at (214, 25, -134). HP was already at 4.0 before lava contact, causing immediate death.
- **Location**: Nether, around (129.6, 25.8, -42.2) → lava fall
- **Coordinates**: Death near (130, 26, -42) in the_nether
- **Last Actions**:
  1. Bot found nether_bricks target at (214, 25, -134) during 200-block scan
  2. Was navigating toward it from (129, 26, -42) with HP=4.0 (already critical!)
  3. Fell into lava during navigation
  4. Auto-respawned to overworld
- **Root Cause**:
  1. No food in inventory → HP slowly drained from hunger
  2. Navigation proceeded even with HP=4.0 (too low)
  3. Nether terrain is dangerous - lava everywhere
- **Fix Needed**:
  1. Safety check: abort nether navigation when HP < 8
  2. Food required before Nether entry
- **Fix Applied**: None yet (keepInventory=true, items intact)
- **Status**: Recorded. Fortress at (214, 25, -134) CONFIRMED.

---

## [2026-03-16] Bug: Death from Skeleton+Enderman at night with HP=4.5 (Session 177)

- **Cause**: Script started with HP=4.5, food(hunger)=16. Script checked `bot.food < 10` which was FALSE (16 >= 10), so skipped `mc_eat`. Then immediately tried to navigate 49.5 blocks at night. Skeleton+Enderman attacked bot, HP dropped to 2.5. Then `mc_navigate` blocked with SAFETY (HP=2.5 < 3), but bot continued due to respawn in wrong place.
- **Location**: Near (-3.5, 61, 13.9) in overworld, nighttime
- **Coordinates**: Death near (-3.5, 61, 13.9) overworld
- **Last Actions**:
  1. Connected with HP=4.5, food=16
  2. Script skipped `mc_eat` because hunger=16 (condition was food < 10)
  3. Navigated 49.5 blocks at night — Skeleton attacked immediately
  4. AutoFlee triggered but HP kept dropping
  5. Fell from height, died from fall damage
- **Root Causes**:
  1. Script bug: should check HP < 12, not just food < 10 — hungry meter ok but HP was critical
  2. Code bug: `bot-movement.ts` only blocked at HP < 3 at night — should block at HP < 8
- **Fix Applied**:
  1. `bot-movement.ts`: Raised night-hostile threshold from HP < 3 to HP < 8 for movement blocks
  2. `bot-movement.ts`: Added auto-eat logic before 30+ block moves when HP < 14 and food available
  3. Committed with `npm run build`
- **Status**: Fixed

---

## Previous sessions (Phase 5 - book hunt)
- 5+ deaths trying to access dungeon at (87,35,-62)
- doMobLoot disabled (gamerule shows true now but was disabled before)
- cobweb string collection broken

## [2026-03-16] Bug: entity.mobType deprecated warning in fight()
- **Cause**: bot-survival.ts uses `e.mobType?.toLowerCase()` which is deprecated in prismarine-entity
- **Location**: `dist/bot-manager/bot-survival.js:584`
- **Coordinates**: (40, 109, 63) birch_forest
- **Last Actions**: `mc_combat('cow', 8)` - hunting for food
- **Fix Applied**: None yet (warning only, not breaking)
- **Status**: Low priority - need to change `e.mobType` to `e.displayName`

## [2026-03-16] Observation: No animals found nearby for food
- **Cause**: Area around (40, 109, 63) has no passive mobs (biome may be depopulated)
- **Location**: birch_forest biome
- **Coordinates**: (40, 109, 63)
- **Last Actions**: mc_combat targeting cow/pig/sheep - all returned "No X found nearby"
- **Fix Applied**: Need to explore wider area or use /locate village
- **Status**: Gameplay issue, not code bug

## [2026-03-16] Death: Killed by Zombified Piglin near Nether portal
- **Cause**: mc_combat('pig', 6) found no pig but zombified_piglin nearby.
  fight() targeted zombified_piglin instead of passive mob.
  HP was already at 8.2 before fight started - too dangerous.
- **Location**: `dist/bot-manager/bot-survival.js` fight() function
- **Coordinates**: (-43.5, 92, 88.5) near Nether portal
- **Last Actions**: mc_combat('pig', 6) → fight() matched zombified_piglin (not pig)
- **Fix Applied**: flee_at_hp=6 was too low given HP=8.2 starting; need to check HP before combat
- **Status**: Fixed by avoiding combat when HP < 10

## Root Cause Analysis
The bug: fight() with target="pig" found zombified_piglin nearby portal and attacked.
When HP=8.2 and flee_at_hp=6, bot fought 3 zombified piglins and died at HP=3.2.
The fight function matches entity displayName/name containing "pig" which matches "zombified_piglin".

## Fix Needed
In bot-survival.ts fight(), when searching by target name:
- Should NOT match "zombified_piglin" when searching for "pig"
- Need exact/suffix matching, not substring matching

---

## [2026-03-16] Bug: Death in Nether by lava during mc_navigate (Session 178)

- **Cause**: mc_navigate to fortress (214,25,-134) used emergency dig-through after fall_detected.
  The dig-through direction led into a lava pool. Bot fell 14.8 blocks at (153,33,-96).
  AutoFlee triggered but HP drained HP=12.2→8.2→4.2→0.2 in lava.
- **Location**: bot-movement.ts - `emergency dig-through` after fall_detected does NOT check for lava
- **Coordinates**: Death at ~(153, 33, -96) in the_nether
- **Last Actions**:
  1. mc_navigate(x=214, y=25, z=-134) from Nether portal exit (-12, 110, 2)
  2. Multiple fall_detected events as bot descended through Nether terrain
  3. Emergency dig-through activated, dug soul_sand downward into lava
  4. "Claude1 tried to swim in lava" - death
- **Root Causes**:
  1. Emergency dig-through doesn't check if destination block is lava/fire before digging
  2. Nether navigation is inherently dangerous with uncontrolled descent
  3. No lava detection in safety threshold during navigation
- **Fix Applied**: None yet - need to add lava check before emergency dig and during pathfinding
- **Status**: Investigating

---

## [2026-03-16] Bug: mc_combat object argument causes toLowerCase error (Session 178)

- **Cause**: Script called mc_combat({target:'blaze', flee_at_hp:8, collect_items:true}).
  mc_combat signature is mc_combat(target?: string, fleeAtHp?: number).
  Object was passed as `target`, causing entityName.toLowerCase() crash in fight().
- **Location**: src/tools/core-tools.ts mc_combat function
- **Fix Applied**: Need to add object argument unpacking in mc_combat, or update signature
- **Status**: Script fixed (calling with positional args now); core-tools should be hardened

---

## [2026-03-17] Bug: mc_store object argument not supported (Session 179b)

- **Cause**: Script called mc_store({ action: 'list', x: 9, y: 96, z: 4 }).
  mc_store signature is mc_store(action, itemName?, count?, chestX?, chestY?, chestZ?).
  Object arg was passed as `action`, causing `Unknown action: [object Object]`.
- **Location**: src/tools/core-tools.ts mc_store function
- **Coordinates**: (9, 96, 4) chest location
- **Fix Applied**: Script fixed to use positional args: mc_store('list', undefined, undefined, 9, 96, 4)
- **Status**: Script fixed; core-tools should add object argument support for consistency

---

## [2026-03-17] Critical: HP=3, Hunger=0, No food, Night (Session 179c)

- **Cause**: Bot respawned after Nether lava death with HP=5. Then during navigation to chest,
  pathfinder dug through cobbled_deepslate (draining further time/health), zombie/creeper
  damaged bot at night, hunger drained to 0. HP dropped to 3.
- **Location**: Overworld (7, 89, 9), birch_forest, midnight
- **Last Actions**:
  1. Connected with HP=5, Hunger=13
  2. Tried to navigate to chest (9,96,4) - dug through cobbled_deepslate unnecessarily
  3. Night time: zombie+creeper attacked (AutoFlee triggered but HP still dropped)
  4. Hunger dropped to 0, HP now 3
- **Chest Contents**: cobblestone, clay_ball, coal, netherrack, soul_sand, obsidian - NO FOOD
- **Root Causes**:
  1. doMobLoot disabled - cannot get food from animals
  2. No food in chest
  3. Night navigation with critical HP
- **Admin Required**: /gamerule doMobLoot true + /give Claude1 cooked_beef 16
- **Status**: Awaiting admin action. Bot alive at (7,88,9) HP=3.

Additional finding: All passive mobs (cow/sheep/pig/chicken) "not found nearby" within 64 blocks
of current position (-5, 95, 0). Area is depopulated. Even if doMobLoot was enabled, no mobs to hunt.
Bot needs to explore further (200+ blocks) to find animals.

---

## [2026-03-17] Gameplay Blocker: HP=3, No Food, No Mobs (Session 179c-d)

- **State**: HP=3, Hunger=0, Position (-5, 95, 0) overworld morning
- **Phase**: 6 (Nether), need 7 blaze_rods, have 12 ender_pearls
- **Blockers**:
  1. No food in inventory
  2. No food in chest (chest has only materials)
  3. No passive mobs within 64 blocks of current position
  4. doMobLoot status unknown (may or may not be disabled)
  5. HP=3 makes exploration dangerous (hunger damage will kill)
- **Admin Actions Required**:
  ```
  /gamerule doMobLoot true
  /gamerule doEntityDrops true
  /give Claude1 cooked_beef 16
  ```
  OR restart bot at full HP with food available
- **Next Session**: After admin gives food, navigate to portal at (-45,93,87), enter Nether,
  navigate to fortress at (214,25,-134), hunt blazes.
- **Status**: RESOLVED - bot was shot by skeleton and respawned with HP=20, Hunger=20

---

## [2026-03-17] Death: Shot by Skeleton (Session 179 report wait)

- **Cause**: Bot was waiting for admin with HP=3, Hunger=0. AutoFlee triggered from skeleton
  but HP=3 was too low to survive skeleton arrow. Bot died.
- **Location**: Overworld near position (-24, 93, -5)
- **Coordinates**: ~(-24, 93, -5) overworld
- **Last Actions**:
  1. Waiting for admin response loop (10s intervals)
  2. AutoFlee triggered from skeleton
  3. HP=3 not enough to survive arrow damage
  4. "Claude1 was shot by Skeleton"
- **Outcome**: Respawned with HP=20, Hunger=20 (keepInventory=true, all items intact)
- **Root Cause**: AutoFlee with HP=3 cannot guarantee survival (skeleton damage > remaining HP)
- **Fix Needed**: When HP <= 5, bot should hide indoors or dig into ground instead of fleeing
- **Status**: Survived (keepInventory). Items intact including ender_pearl x12. Ready to continue.

---

## [2026-03-17] Critical: Nether Portal (Nether->OW) Not Working (Session 184)

- **Cause**: Bot at (-12,110,2) in soul_sand_valley (Nether) cannot use nether_portal to return to OW.
  Portal stands at (-12-13, 110-112, 2) with axis=x. Bot enters portal block, stands still for 30s,
  but server never sends dimension change / spawn event.
- **Location**: Nether portal at (-12,110,2) in the_nether
- **Coordinates**: (-12, 110, 2) in the_nether
- **Last Actions**:
  1. Sessions 180-184: Bot repeatedly tried portal at (-12,110,2) - all timeout after 30s
  2. Portal detection works (6 nether_portal blocks found at that location)
  3. Bot enters portal, clears controls, waits - no teleport
- **Code Bug Fixed**: bot-movement.ts shouldSkip logic was preventing enterPortal() when
  bot was in Nether + targeting nether_portal (commit 6c2b56c). This is now fixed.
- **Remaining Issue**: Even with code fixed, server not triggering portal teleport.
  Possible server-side causes:
  1. Portal cooldown (but bot has been in Nether for 10+ sessions - cooldown should be gone)
  2. Server has disabled portal travel via spigot/paper config
  3. OW side portal was broken/removed
  4. `allowNether=false` in server.properties
- **Admin Actions Required**:
  1. Check: is the OW Nether portal at (-47 to -44, y=92-96, z=87) still active?
  2. Check server.properties: `allow-nether=true`
  3. Try: `/tp Claude1 -45 93 87` to force OW teleport
  4. Or: `/give Claude1 cooked_beef 16` so bot can survive in Nether for blaze hunt
- **Bot State**: HP=5, Hunger=4, Pos=(-12,110,2) in soul_sand_valley
- **Status**: BLOCKED. Admin intervention required.

---

## [2026-03-17] Bug: Death by Skeleton in Nether near portal spawn (HP=1, no food)

- **Cause**: Bot entered Nether at HP=1 Hunger=0 (no food due to doMobLoot disabled). Skeleton spawned near portal spawn at (-12, 110, 3). AutoFlee triggered but HP was already critical. "Claude1 went up in flames" = fire damage (may have been knocked into lava/fire).
- **Location**: `src/bot-manager/bot-core.ts` — AutoFlee during portal entry suppressed, but death still occurred from skeleton AFTER portal entry
- **Coordinates**: Nether ~(-12, 110, 3) (portal spawn area)
- **Last Actions**:
  1. Entered Nether via portal at (-46, 93, 87) OW
  2. Respawned in Nether at (-12, 110, 3) with HP=1
  3. Skeleton hit, HP→0, "went up in flames"
- **Fix Applied**: Session 186 - AutoFlee suppressed during portal entry (bot-core.ts commit 6379575). But survival after portal entry at HP=1 remains issue.
- **Root Cause**: No food available (doMobLoot disabled), starvation reduces HP to 1 before portal entry, making bot trivially killable.
- **Status**: Need admin food before Nether entry at low HP.

---

## [2026-03-17] Bug: Death from fall damage at 0.5 HP while navigating to portal (Session current)

- **Cause**: Hunger depleted to 0 during navigation from (32,95,-73) to portal (-45,93,87). HP drained to 0.5 from starvation. mc_navigate to portal caused fall damage ("hit the ground too hard") which killed bot at 0.5 HP.
- **Location**: OW navigation path near portal coordinates (-45, 93, 87)
- **Coordinates**: Death near (-43.5, 92.0, 88.5)
- **Last Actions**:
  1. Started Phase 6 at (32,95,-73) with HP=20, hunger=20
  2. Crafted and equipped full gold armor
  3. Hunger dropped to 0, HP to 0.5 during travel (no food in inventory)
  4. mc_navigate to portal caused "Claude1 hit the ground too hard" - death
- **Root Cause**: No food in inventory. Area is depopulated of passive mobs (over-hunted in previous sessions). Bot traveled ~100 blocks with hunger=0 → HP drained to 0.5 → any fall fatal.
- **Outcome**: Respawned HP=20, Hunger=20, armor retained (keepInventory=true)
- **Fix Needed**: mc_navigate should abort/warn when HP < 5 or hunger = 0 before long distances
- **Status**: Recorded. Continuing Phase 6 with full HP after respawn.

---

## [2026-03-17] Bug: Death by lava in Nether navigation (pathfinder routes over lava lakes)

- **Cause**: `checkGroundBelow()` treated lava blocks as solid ground, allowing sub-step navigation to waypoints above lava lakes. Pathfinder would route bot over lava lake edge and bot would fall into lava.
- **Location**: `src/bot-manager/minecraft-utils.ts:checkGroundBelow()` and `src/bot-manager/bot-movement.ts`
- **Coordinates**: Nether ~(70, 72, -49) — fell into lava lake between T1 and T2
- **Last Actions**:
  1. Navigating from T1 (24, 87, -19) toward T2 (131, 47, -90) 
  2. Sub-step waypoint at ~(68, 78, -46) was over a lava lake
  3. FALL DETECTED stopped pathfinder but bot had already started falling
  4. "Claude1 tried to swim in lava"
- **Fix Applied**: 
  1. `checkGroundBelow()` returns `hasLavaBelow=true` when lava found below destination
  2. `moveTo()` aborts immediately when `hasLavaBelow=true` with descriptive error
  3. Commit: 1816582
- **Status**: Fixed. Navigation will now abort instead of routing over lava lakes.

---

## [2026-03-18] Death: Slain by Zombie at night with HP=5, Hunger=0 (Session current)

- **Cause**: HP=5 from starvation, hunger=0, no food. Night time. Bot wandered to find animals, zombie spawned and killed bot.
- **Location**: OW (~151, 63, 4) old_growth_birch_forest
- **Coordinates**: ~(151, 63, 4)
- **Last Actions**:
  1. HP=5 from starvation (hunger=0 stops damage at 0.5 hearts on Normal)
  2. Searched cow/sheep/pig/chicken/rabbit all "not found" within 512 blocks
  3. Tried mc_combat(zombie) to get rotten flesh — zombie defeated but no drops (doEntityDrops disabled)
  4. Night fell, zombie spawned and killed bot
- **Outcome**: Respawned HP=19, Hunger=20 (keepInventory=true). All items intact.
- **Root Cause**: doEntityDrops disabled — zombie dropped nothing. No passive mobs in area to hunt.
- **Status**: Survived (keepInventory). Continuing.

---

## [2026-03-18] Death: Slain by Zombie during cave navigation (HP=5, hunger=0)

- **Cause**: mc_navigate to chest at (276,54,36) routed through cave system. HP=5, hunger=0, midnight. Zombie in cave killed bot. Chat showed "Claude1 was slain by Zombie".
- **Location**: OW cave ~(98, 61, 14) — pathfinder entered cave from surface
- **Coordinates**: ~(98, 61, 14)
- **Last Actions**:
  1. HP=5, hunger=0, no food, no animals within 200 blocks
  2. Tried to navigate to surface chest at (276,54,36) to find food
  3. Pathfinder routed through cave/underground at night
  4. Zombie in cave killed bot at HP=5
- **Root Cause**: mc_navigate with HP=5 at midnight routed underground where hostile mobs spawn
- **Fix Needed**: mc_navigate should avoid underground routing when HP < 8 at night
- **Status**: Survived (keepInventory). Respawned.

---

## [2026-03-18] Death: Lava during navigation at night (HP=4, hunger=0, safety guard stale)

- **Cause**: Safety guard in bot-movement.ts read stale HP=4 (from previous body), blocked mc_navigate. Meanwhile bot actually died again from lava (likely pathfinder still running from previous mc_navigate call). Chat: "Claude1 tried to swim in lava".
- **Coordinates**: ~(95, 61, 13) → fell into lava somewhere underground
- **Last Actions**:
  1. mc_status showed HP=12, hunger=13
  2. mc_navigate to (276,54,36) — safety guard blocked with "HP=4.0 at night"
  3. Bot apparently still moving from a prior navigate call, hit lava
  4. Respawned at (-8.5, 111, 2.7) — base area with HP=20, Hunger=20
- **Root Cause**: Safety guard reading stale HP from bot object during async operation
- **Status**: Survived (keepInventory). Now at base with full HP/hunger.

---

## [2026-03-18] Death: Slain by Zombie while dropping inventory junk (HP=20 → 0)

- **Cause**: Bot was standing still at (10, 92, 9) dropping/picking up items in a loop. A zombie killed the bot. No armor equipped. Bot was distracted by inventory management loop.
- **Coordinates**: ~(10, 92, 9) overworld, daytime
- **Last Actions**:
  1. Attempting to drop junk (dirt x370, diorite, andesite, etc.) via mc_drop
  2. Bot standing still re-picking up dropped items (vanilla item pickup)
  3. Tried deposit_all_except to chest at (9,96,4) — GoalChanged errors (chest unreachable, 4 blocks up)
  4. Placed new chest at (12,92,6) — chest open timeout errors
  5. "Claude1 was slain by Zombie"
- **Root Cause 1**: mc_drop drops items at bot feet → bot immediately re-picks up (vanilla behavior). Need to move away before re-picking or use different disposal strategy.
- **Root Cause 2**: Chest at (9,96,4) is 4 blocks above current position — pathfinder can't reach it.
- **Root Cause 3**: Freshly placed chest at (12,92,6) caused "Chest open timeout" — possible server sync issue with newly placed chests.
- **Root Cause 4**: No armor equipped during this entire session — zombie killed bot in 1-2 hits.
- **Outcome**: Respawned with keepInventory=true. All items intact.
- **Fix Needed**:
  1. After respawn, immediately equip armor before any inventory management
  2. Use mc_craft bread immediately (have 4 wheat) then eat before doing anything else
  3. For junk disposal: navigate to main chest properly or drop and sprint away immediately
- **Status**: Recorded. Continuing.

---

## [2026-03-18] Bug: mc_drop items re-collected by subsequent collectNearbyItems calls

- **Cause**: `mc_drop` moves bot only 4 blocks away after dropping. But `collectNearbyItems` has a default `searchRadius=10`. Any subsequent `mc_gather`, `mc_combat`, or `mc_craft` call that runs `collectNearbyItems` will re-pick up the dropped items.
- **Location**: `src/tools/core-tools.ts` lines 743-766 (mc_drop move-away logic)
- **Coordinates**: ~(3, 44, 3) — dirt was dropped, bot moved 4 blocks, then gather/gather re-picked all dirt
- **Last Actions**:
  1. mc_drop(dirt) — dropped 308x dirt, moved 4 blocks away
  2. mc_drop(diorite) — dropped 23x diorite; but next status showed dirt back in inventory
  3. mc_gather(iron_ore) — navigated back near drop area, collectNearbyItems re-collected dirt
- **Root Cause**: 4 block move-away < 10 block collectNearbyItems search radius
- **Fix Applied**: Increased move-away distance from 4 to 15 blocks in mc_drop (beyond 10-block collection radius). Also added a 1.5s wait after move to ensure item entities settle before returning.
- **Status**: Fixed

---

## [2026-03-18] Critical: HP=5, Hunger=0, No Food — Phase 6 Blocked (Session current)

- **Cause**: doMobLoot still disabled on server. No food obtainable from any mob kills.
  Starvation reduced HP to 5 (stable — Normal difficulty stops at 0.5 hearts).
- **Location**: OW (152, 60, -22) near base crafting_table (153, 60, -21)
- **Coordinates**: (152, 60, -22)
- **Last Actions**:
  1. Connected with HP=20, Hunger=11, gold full armor, ender_pearl x12
  2. Searched for animals: cow/sheep/pig/chicken/rabbit all "not found" within 256 blocks
  3. Killed 2 salmon — 0 food drops (doEntityDrops still disabled)
  4. Killed 1 drowned — 0 drops
  5. Fell underground (y=29) during navigation, climbed back to surface y=60
  6. HP drained to 5 from starvation during underground navigation
- **Blockers**:
  1. doMobLoot disabled → no mob loot of any kind (food, blaze rods)
  2. No passive mobs within 256 blocks (area depopulated)
  3. No plant-based food (no sweet_berry_bush, mushrooms within 128 blocks)
  4. Phase 6 blaze_rod farming impossible without doMobLoot
- **Admin Actions Required**:
  ```
  /gamerule doMobLoot true
  /gamerule doEntityDrops true
  /give Claude1 cooked_beef 16
  ```
- **Bot State**: HP=5, Hunger=0, Position=(152, 60, -22), gold armor + iron_sword + ender_pearl x12
- **Status**: BLOCKED. Awaiting admin action.

---

## [2026-03-22] Bug: bot.craft() and bot.gather() return "Cannot read properties of undefined" error

- **Cause**: `bot.craft(item, count, autoGather)` and `bot.gather(block, count)` called via mc_execute fail with "Cannot read properties of undefined (reading 'minecraft_craft_chain')" and "Cannot read properties of undefined (reading 'minecraft_gather_resources')". These functions depend on MCP tool calls internally. The mc_execute bot.craft() wrapper appears to reference an undefined object when called in this session.
- **Location**: `src/tools/core-tools.ts` — bot.craft() and bot.gather() wrappers
- **Coordinates**: (16.4, 102, 7.6) birch_forest
- **Last Actions**:
  1. Connected as Claude1, HP=20 Hunger=20
  2. Attempted `bot.craft('white_bed', 1, false)` → error
  3. Attempted `bot.craft('bed', 1, false)` → error
  4. Attempted `bot.craft('white_bed', 1, true)` → error
  5. Attempted `bot.gather('birch_log', 8)` → error
- **Fix Applied**: None (コード修正禁止)
- **Status**: Investigating. Using mc_execute with low-level bot API as workaround.

---

## [2026-03-18] Death: Slain by Skeleton during mc_gather iron_ore at night

- **Cause**: mc_gather(iron_ore, max_distance=64) navigated bot to surface at night with no armor. Skeleton shot and killed bot.
- **Location**: Surface birch_forest ~(-7, 94, 1)
- **Coordinates**: ~(-7, 94, 1) overworld, midnight
- **Last Actions**:
  1. Night (midnight), no armor equipped
  2. mc_gather(iron_ore, count=4, max_distance=64) navigated bot to open surface
  3. Skeleton shot bot — "Claude1 was shot by Skeleton"
- **Item Loss**: cooked_beef x8 lost (9 → 1), iron_ingot x2 retained (keepInventory=true)
- **Root Cause**: mc_gather does not check for hostile mobs or night conditions before navigating. Bot was exposed on surface at midnight without armor.
- **Fix Needed**: mc_gather should check threats before moving to target block, or avoid surface navigation at night when HP < 15 and no armor
- **Status**: Recorded. Continuing gameplay.

---

## [2026-03-19] Deaths: Fall + Zombie (Session current reconnect)

- **Cause**: Bot died twice before this session reconnect. Chat log: "Claude1 fell from a high place" then "Claude1 was slain by Zombie". Likely from cave navigation at low HP/hunger before reconnect.
- **Location**: OW near (58, 80, -4) / cave area
- **Last Actions**: Cave escape sequence from Y=61 to Y=80, hunger=0, HP=9.2 before reconnect
- **Outcome**: Respawned HP=20, Hunger=20 (keepInventory=true). Now at (−2, 100, 6) birch_forest
- **Status**: Recorded. Continuing gameplay.

---

## [2026-03-19] Death: Slain by Zombie while exploring for food (HP=17→0)

- **Cause**: Bot was exploring far from base searching for animals (no food in inventory). Navigating at night/evening, zombie killed bot. HP was 17 at start of exploration but midnight arrived during travel.
- **Location**: OW ~(45, 96, -71) old_growth_birch_forest
- **Coordinates**: ~(45, 96, -71)
- **Last Actions**:
  1. Started at (-9, 109, 11) with HP=17, hunger=11, no food
  2. Searched sheep/cow/pig/chicken within 64 blocks at 3 locations — all empty
  3. Navigated to (-69, 101, 60) then to (45, 98, -69) — no animals found
  4. Midnight arrived, zombie killed bot: "Claude1 was slain by Zombie"
- **Root Cause**: No animals anywhere in 128+ block radius (depopulated area). Long exploration at night with no armor. Iron sword equipped but zombie still lethal.
- **Fix Needed**: Abort exploration if approaching night (ticks > 11500) and no shelter/bed available
- **Status**: Recorded. Bot respawned HP=16.3, built emergency shelter. Continuing.

---

## [2026-03-20] Death: Fall from high place (HP=1, starvation + mc_drop displacement)

- **Cause**: Bot was at HP=1, Hunger=0 from chronic starvation. mc_drop moved bot 15 blocks away from dropped items, which displaced bot into a deep ravine area. Bot fell from high place and died.
- **Location**: OW near ravine at approximately (9-17, 85-97, 3-7)
- **Coordinates**: Near ravine between farm plots and base
- **Last Actions**:
  1. Multiple sessions of mc_drop cobblestone → re-pickup loop (cobblestone dropped, bot moved 15 blocks, but next mc_drop moved back toward previous drop zone)
  2. HP dropped from 10→7→5→1 over several sessions due to starvation (hunger=0 continuously)
  3. mc_farm successfully grew some wheat but never enough for bread (need 3, kept getting 1-2)
  4. iron_sword + bucket crafted successfully in final session
  5. Chat showed: "Claude1 fell from a high place" — fatal fall with HP=1
- **Root Causes**:
  1. **Chronic food crisis**: No animals within 128+ blocks, mc_farm only yields 1 wheat per call (need 3 for bread)
  2. **mc_drop displacement**: 15-block move-away sends bot to dangerous terrain (ravine edge)
  3. **HP=1 makes any damage fatal**: Even 1-block fall = death
- **Outcome**: Respawned with keepInventory=true. iron_sword + bucket retained.
- **Fix Needed**:
  1. mc_farm should try harder to find/place multiple farmland plots in one call
  2. mc_drop should check terrain safety before moving (avoid ravine edges)
  3. When HP <= 3, bot should stay completely still and only do inventory/craft actions
- **Status**: Recorded. Continuing with keepInventory respawn.

## [2026-03-20] Death: Fall from high place (2nd time) — ravine/cliff area near new base
- **Cause**: Bot fell from high place in cliff/ravine area near new base at (~63, 84, -114)
- **Coordinates**: Near (63, 84, -114) — large exposed stone ravine/cliff area
- **Last Actions**:
  1. Previous agent crafted 2 chests + crafting_table, placed at (63-65, 84, -114)
  2. Bot was operating in exposed cliff/ravine terrain with large drops
  3. Hunger was at 1 (critical) — likely starvation damage + fall
  4. Chat showed: "Claude1 hit the ground too hard"
- **Root Causes**:
  1. **Dangerous terrain**: Bot operating in cliff/ravine area with large elevation changes
  2. **No pathfinding safety**: mc_navigate doesn't avoid cliff edges
  3. **Hunger 1**: Starvation damage may have reduced HP before fall
  4. **Recurring pattern**: Same death type as previous (fall from high place)
- **Outcome**: Respawned with keepInventory=true. Items retained.
- **Fix Needed**:
  1. Bot should avoid operating near cliff edges — stay on flat terrain
  2. mc_navigate needs terrain safety check (avoid paths near drops >3 blocks)
  3. Food crisis must be resolved before any exploration/movement
  4. Consider adding fall damage prevention (water bucket MLG or avoid high areas)
- **Status**: Recorded. 2nd fall death — this is a systemic issue with terrain safety.

## [2026-03-20] Death: Slain by Zombie (3rd death) — night combat at HP=3.5
- **Cause**: Bot was slain by Zombie at night. HP had dropped to 3.5 from fall damage/starvation before engaging.
- **Coordinates**: Near (68, 80, 8) — ravine area
- **Last Actions**:
  1. Agent connected, found HP=11, midnight, multiple hostiles
  2. Tried to navigate to chest (64, 84, -114) — 50 blocks away
  3. Safety system blocked: "Cannot move 50.6 blocks with critical HP(3.5/20)"
  4. HP dropped from 11→3.5 during navigation attempt
  5. Tried mc_combat(target="zombie") — "No zombie found nearby"
  6. Killed by zombie while searching
- **Root Causes**:
  1. **Night + low HP**: Bot was at HP=11 at midnight with multiple hostiles
  2. **Failed to shelter**: Should have built shelter instead of navigating 50 blocks
  3. **HP dropped during movement**: Navigation through hostile terrain drained HP
  4. **No food**: Cannot recover HP without food
- **Outcome**: Respawned with keepInventory=true. HP=20, Hunger=20. Near chest at (12, 92, 6).
- **Fix Needed**:
  1. When HP<10 at night, do NOT navigate — build immediate shelter (mc_build)
  2. Food crisis is the root cause of all deaths — must be resolved first
  3. Agent should check time of day and act accordingly (night=shelter, day=farm)
- **Status**: Recorded. 3rd death. Pattern: low HP + no food + dangerous activity = death.

## [2026-03-20] Death: Drowned (4th death) — water source during mc_farm
- **Cause**: Bot drowned while farming near water source. HP was 0.67 before recovery, then recovered to 16 via bread, but drowned during mc_farm water navigation.
- **Coordinates**: Near water at (8-12, 96-101, 9-31) — farm area
- **Last Actions**:
  1. HP started at 1.7, Hunger 0 — critical
  2. mc_farm x4, crafted and ate 3 breads
  3. HP recovered from 0.67 to 16, Hunger to 17
  4. During final mc_farm, bot moved near water for irrigation
  5. "Claude1 drowned" — bot got stuck underwater
- **Root Causes**:
  1. **mc_farm moves bot into water**: Farm tool navigates near water sources for irrigation, sometimes INTO water
  2. **Low HP + water**: At HP<2, even brief submersion can be fatal
  3. **No breath management**: Bot doesn't surface when underwater
- **Fix Needed**:
  1. mc_farm should navigate NEAR water, not INTO water
  2. Add drowning prevention: check if bot head is underwater, surface immediately
  3. When HP<5, avoid water-adjacent activities
- **Fix Applied**: commit abf2a0e — mc_farm now finds a solid land block adjacent to water and navigates there instead of into the water block itself. Both 64-block and 200-block water search paths fixed.
- **Status**: Fixed (code). 4th death. Drowning during farming.

---

## [2026-03-22] Death: Slain by Zombie — mc_craft timeout中に拠点から遠ざかりHP低下

- **Cause**: mc_craft(chest x2, autoGather=true)が180秒タイムアウト。その間にボットが拠点(-31,68,-12)まで移動し、hunger=7、HP=3まで低下。zombie接近時にmc_flee/mc_combatが使用不可（HP3のため拒否）。death確認。
- **Location**: OW (-31, 68, -12) old_growth_birch_forest
- **Coordinates**: (-31, 68, -12)
- **Last Actions**:
  1. mc_craft(chest, count=2, autoGather=true) 実行
  2. 180秒タイムアウト — その間にボットが遠くへ移動
  3. 復帰時 HP=3, hunger=7, zombie 1.6m以内
  4. mc_combat(chicken): "[REFUSED] Cannot hunt — hostile in range"
  5. mc_combat(zombie): "[REFUSED] HP too low (3.0/20)"
  6. mc_flee: "Not connected" エラー
  7. 再接続後 mc_flee → "Fled 0.8 blocks" → hp=20 (keepInventory respawn)
- **Root Cause**: mc_craft(autoGather=true)がタイムアウトする間にボットが安全でない場所へ移動し、食料なし状態でzombieに倒された。autoGatherのタイムアウト中の安全管理が不十分。
- **Outcome**: Respawned HP=20, Hunger=20 (keepInventory=true). 拠点 (1,103,8) に戻った。
- **Status**: 記録済み。継続。

## [2026-03-20] Death: Killed by Witch using magic (5th death)
- **Cause**: Witch attacked bot with magic potions. Bot had HP=10, fled successfully (11.4 blocks away), but witch continued ranged attack during mc_navigate. Bot died while navigating to chest at (9,96,4) from position (20,108,-15).
- **Coordinates**: Near (20, 108, -15)
- **Last Actions**:
  1. mc_status showed HP=10, witch + creeper nearby
  2. mc_flee — fled 11.4 blocks from witch
  3. mc_status — still HP=10, witch + creeper in area
  4. mc_navigate to chest — killed by witch during navigation
- **Root Causes**:
  1. **mc_flee insufficient distance**: 11.4 blocks is within witch's 16-block attack range
  2. **No food in inventory**: Could not heal before navigating
  3. **HP=10 too low for any activity near hostile mobs**: Should have fled further
- **Fix Needed**:
  1. mc_flee should flee at least 20 blocks from witches (they have 16-block range)
  2. Agent should not navigate while hostile mobs are in range with HP<=10
- **Status**: Recorded. 5th death.

---

## [2026-03-20] Death: Starvation + fall damage in ravine (6th death)
- **Cause**: Bot fell repeatedly in ravine despite maxDropDown=2 fix. Hunger=0, no food, HP dropped from 14.3→2.3 due to combined fall damage + starvation. Fatal starvation at Y=58.
- **Coordinates**: (-11.5, 58, 6.5)
- **Last Actions**:
  1. mc_navigate(target_block="crafting_table") at Y=72 — fell to Y=63
  2. mc_navigate(target_block="crafting_table") — fell further to Y=58
  3. Hunger=0, HP=2.3, no food — starvation death
- **Root Causes**:
  1. **bot-blocks.ts maxDropDown=10 was fixed to 2, but moveTo pathfinder still causes falls**: The pathfinder plans routes near ravine edges where Minecraft physics push bot off ledges. maxDropDown only controls planned drops, not physics-induced falls near edges.
  2. **No food obtained in multiple sessions**: Bot trapped in ravine, unable to reach surface farm area
  3. **Ravine is a death trap**: Y=72→Y=58 in two navigation attempts despite safety fixes
- **Fix Needed**:
  1. Add staircase-mining escape tool: dig 1-block-wide staircase upward (safe, guaranteed)
  2. mc_navigate should refuse to pathfind in ravines (detect large Y gaps in terrain nearby)
  3. Food priority: never enter dangerous terrain without food
- **Status**: Investigating. 6th death.

---

## [2026-03-20] Death: Killed by Zombie during chest operations (7th death)
- **Cause**: Bot was stationary during mc_store deposit_all_except at chest (5,101,25). Zombie approached and killed bot while it was repeatedly failing to deposit items.
- **Coordinates**: Near (5, 101, 25)
- **Last Actions**:
  1. Navigated to chest at (5,101,25)
  2. mc_store deposit_all_except — all deposits failed with various errors
  3. Bot was stationary for extended time, zombie killed it
- **Root Causes**:
  1. **mc_store deposit errors**: Multiple deposit failures ("inventory unchanged after 3s wait", "GoalChanged", "Chest open timeout") kept bot stationary
  2. **No hostile mob awareness during chest operations**: Bot doesn't check for threats while performing storage
  3. **Midnight = zombie spawns**: Dangerous to do extended stationary operations at night
- **Items Lost**: stone_hoe, obsidian x4, dirt x29, torch x64, white_wool x1, cobblestone x~200 (dropped at death location, keepInventory partial?)
- **Fix Needed**:
  1. mc_store should check for hostile mobs before/during operations
  2. Bot should not perform extended stationary operations at night without shelter
- **Status**: Recorded. 7th death.
- **Status**: Recorded. 5th death. Witch ranged attack during navigation.

---

## [2026-03-20] Deaths: fall x2 + witch x2 + zombie x1 (8th-12th deaths)

- **Cause**: Multiple deaths in session gap before this reconnect:
  1. "Claude1 fell from a high place" (x2) — ravine fall deaths, maxDropDown=2 fix insufficient
  2. "Claude1 was killed by Witch using magic" (x2) — witch ranged potions, flee didn't persist
  3. "Claude1 was slain by Zombie" — zombie melee at low HP
- **Location**: `src/bot-manager/bot-survival.ts` — AutoFlee threshold and distance
- **Coordinates**: Unknown (died before this session reconnect)
- **Last Actions**: Previous session navigating in ravine area near Y=84
- **Fix Needed**:
  1. Fall deaths: ravine navigation needs stronger avoidance
  2. Witch deaths: flee distance must exceed witch's 16-block attack range (flee >= 25 blocks)
  3. Zombie death: flee should trigger at HP <= 12 not HP <= 10 for safer margin
- **Status**: Recorded. 8th-12th deaths.

---

## [2026-03-20] Death: Fall during mc_gather short_grass (13th death)
- **Cause**: Bot fell from height while gathering short_grass. mc_gather navigated to grass near cliff/ravine edge, bot was pushed off by physics.
- **Death message**: "Claude hit the ground too hard"
- **Coordinates**: Somewhere between (14, 62, 43) and (-70, 118, -11) (respawn)
- **Last Actions**:
  1. mc_flee from creeper (success)
  2. mc_gather(block="short_grass", count=10) — fell during navigation to grass
- **Root Causes**:
  1. **mc_gather uses pathfinder which routes near cliff edges**: Same root cause as deaths #6, #8-12
  2. **Hunger=0 meant no HP regen**: Any fall damage is permanent
  3. **physicsTick fall detection didn't prevent death**: Fall was likely instant/fatal
- **Fix Needed**:
  1. mc_gather should inherit maxDropDown=2 safety settings
  2. Consider refusing navigation when Hunger=0 and HP<6
- **Status**: Recorded. 13th death.

---

## [2026-03-20] Death: Starvation (Hunger=0, HP=1 → death) (14th death)

- **Cause**: Bot in birch_forest with no food in inventory. Hunger=0, HP dropped to 1 due to starvation damage. No nearby animals (pig/cow/sheep/chicken). sweet_berry_bush not found within 50 blocks. Safety guard in mc_navigate blocked navigation at critical HP. Zombie killed bot at HP=1.
- **Death Message**: "Claude1 was slain by Zombie"
- **Coordinates**: ~(18, 75, -35) birch_forest
- **Last Actions**:
  1. HP=10, Hunger=0 — no food, no animals nearby
  2. mc_combat(target="sheep") — no sheep found nearby
  3. mc_navigate(target_entity="sheep", max_distance=200) — 133 blocks away, unreachable
  4. mc_navigate(target_entity="pig", max_distance=200) — path blocked
  5. mc_navigate(target_entity="chicken", max_distance=200) — blocked by critical HP safety guard
  6. mc_gather(block="sweet_berry_bush") — 0 found within 50 blocks
  7. HP=1 from starvation damage, Zombie killed
- **Root Cause**: No persistent food farm established. Bot relies on hunting but animals are sparse/unreachable.
- **Fix Needed**: Need wheat farm or animal pen before Phase 5 diamond mining to prevent starvation during extended mining sessions.
- **Status**: Recorded. 14th death. Starvation.

---

## [2026-03-22] Death: Claude1 slain by Zombie — Hunger=1 + night nav + no food (Session current)

- **Cause**: Hunger=1でHP回復不能。夜間にZombieが密集した状態でmc_navigateが経路ブロックされ逃げ場なし。食料が完全にない状態で夜間行動を継続したため死亡。
- **Death Message**: "Claude1 was slain by Zombie"
- **Coordinates**: (~2, 103, 21) birch_forest
- **Last Actions**:
  1. mc_flee() x2 — Creeper/Skeletonから逃脱
  2. mc_combat(target="cow") — [REFUSED] Creeper 6.5m
  3. mc_navigate(target_entity="cow/sheep/pig") — 64m以内に動物なし
  4. mc_store list チェスト — reach不可(Y差2)
  5. mc_navigate to crafting_table (-3,104,20) — path blocked
  6. mc_navigate to furnace (-8,90,-6) — [REFUSED] HP低すぎ
  7. Zombie 11m接近 → 死亡
- **Root Cause**: 食料がない状態での夜間活動。Hunger=1でHP自然回復不能。mc_navigateが経路ブロックで到達できず逃げ場失失。
- **Fix Needed**: 食料ゼロで夜間になった場合、即座にシェルター待機(穴掘り)に切り替える判断が必要。
- **Status**: Recorded.

---

## [2026-03-22] Death: mc_flee落下死 — HP0.5でクリーパー逃避中に転落 (Session current)

- **Cause**: HP=0.5、Hunger=8でクリーパー(19m北)から逃げるためmc_flee(30)実行。逃避中に高所から転落死。
- **Death Message**: "Claude1 fell from a high place"
- **Coordinates**: (-3, 84, -2) birch_forest
- **Last Actions**:
  1. 接続時HP=0.5、Hunger=4、食料なし
  2. パンをcraftして食べHunger=8に回復
  3. クリーパー19m北を確認
  4. mc_flee(30) 実行 → 転落死
- **Root Cause**: HP=0.5という極限状態でmc_fleeを実行。mc_fleeは安全なルートを考慮せず逃げるため崖から転落。1ブロック落下でも致死的なHP量だった。
- **Fix Needed**: HP<1の場合はmc_fleeを使用せず、穴掘りシェルター(dig down 3 blocks)またはその場でスニーク(shiftキー)を選択すべき。
- **Status**: Recorded.

---

## [2026-03-22] Bug: Claude1 溺死 - bot.moveTo(12,92,6)がy=120の位置に移動後に溺死 (Session current)

- **Cause**: `bot.navigate({type:'coordinates', x:12, y:92, z:6})` を呼んだところ、bot がy=120の水中付近に誘導された。その後チャットに「Claude1 drowned」メッセージが届いた。高所チェストへの経路探索が水中経由の経路を選択している模様。
- **Location**: (9, 120, -6) - 移動先。死亡詳細座標不明
- **Coordinates**: Start (4.3, 81, 9.7) → Arrived (9, 120, -6) → Drowned
- **Last Actions**: 1x2穴でdawn待機 → moveTo(12, 92, 6)チェスト確認へ → y=120に到達後溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡。keepInventoryによりアイテム保持。moveTo/navigateが水中経路選択するバグは既存既知バグと同種。

---

## [2026-03-22] Bug: bot.gather/combat/farm/build が瞬時終了して何もしない (Session current)

- **Cause**: mc_execute内でbot.gather(), bot.combat(), bot.farm(), bot.build()を呼び出すと、エラーなく瞬時に完了するが実際には何もしない。インベントリ変化なし、位置変化なし。
- **Symptoms**:
  - `bot.gather("birch_log", 16)` → 瞬時完了、birch_log 2個のまま変化なし
  - `bot.combat("cow", 15)` → 瞬時完了、食料ドロップなし、HP変化なし
  - `bot.farm()` → 瞬時完了、インベントリ変化なし
  - `bot.build("shelter")` → 瞬時完了、構造物建設されず
  - `bot.build("farm")` → 瞬時完了、農場建設されず
- **Working**: bot.navigate(), bot.craft(), bot.status(), bot.inventory(), bot.chat(), bot.getMessages() は正常動作
- **Location**: `src/tools/core-tools.ts` またはbot実装
- **Coordinates**: (179, 62, -9) birch_forest
- **Last Actions**: 複数のgather/combat/build試行、全て瞬時完了で効果なし
- **Fix Applied**: None (コード修正禁止)
- **Status**: Investigating. HP=1.8, Hunger=0で生存中（飢餓ダメージも来ていない）

---

## [2026-03-23] Bug: Claude1 slain by Zombie during moveTo navigation - Session current

- **Cause**: bot.moveTo(-17, 94, -22) 実行中にゾンビに殺された。移動中の戦闘回避機能が不十分。
- **Location**: src/tools/core-tools.ts (moveTo/navigation)
- **Coordinates**: 死亡時不明（navigation中）, spawn: (-5, 87, 3)
- **Last Actions**:
  1. bot.combat("cow") x2 → 成功報告されるが食料ドロップなし
  2. bot.moveTo(-17, 94, -22) (かまどへ) → 移動中にゾンビに殺された
- **Fix Applied**: None
- **Status**: Open

## [2026-03-23] Bug: Claude1 fell from a high place during moveTo - Session current

- **Cause**: bot.moveTo(1, 88, -3) 実行中に高い場所から落下死。pathfinderが崖を通るルートを選択。
- **Location**: src/tools/core-tools.ts (moveTo/pathfinder)
- **Coordinates**: 落下前 (-6, 85, -1), Y=85から落下
- **Last Actions**:
  1. 作業台(1, 88, -3)にmoveTo
  2. 途中の座標(-6, 85, -1)まで到達後に落下
- **Fix Applied**: None
- **Status**: Open. pathfinderが安全でないルートを選択する根本的な問題。


## [2026-03-24] Bug: Claude1 slain by Zombie during food search - Session current

- **Cause**: bot.combat("zombie")でクリーパー接近中断→逃走→別のゾンビに接触して死亡。食料探索中に複数のhostileに囲まれた。
- **Location**: src/tools/core-tools.ts (combat/flee)
- **Coordinates**: 死亡位置不明（(24, 72, -35)付近→農場方面に移動中）, リスポーン: (4, 94, 6)
- **Last Actions**:
  1. 夜間待機 → 夜明け後に食料探索開始
  2. bot.flee() → bot.combat("zombie") → CREEPER ABORT
  3. navigate({x:2, y:72, z:5}) → 移動中にゾンビに殺された
- **Fix Applied**: None
- **Status**: Open. keepInventoryで持ち物保持。HP/Hunger全快でリスポーン。


## [2026-03-24] Bug: Claude1 trapped underground by pathfinder navigation - Critical

- **Cause**: bot.navigate()が地下洞窟(Y=55)へのルートを選択し、地上に戻れなくなった。navigate()は「Path blocked」を返し続け、flee()も「Terrain blocking escape routes」で失敗。飢餓ダメージで死亡。
- **Root Pattern**: navigateのpathfinderが地表(Y=86)への上昇ルートを見つけられない。洞窟に入ると完全にトラップされる。
- **Location**: src/bot-manager/ (pathfinder configuration)
- **Coordinates**: トラップ地点 (-8, 55, 6), リスポーン先: 拠点付近
- **Last Actions**:
  1. navigate({x:2, y:72, z:5}) → 地下洞窟へ誘導
  2. navigate系コマンドを20回以上試みるも全て「Path blocked」
  3. pillarUp失敗（ceiling blockingか、scaffoldブロック配置失敗）
  4. flee()失敗（terrain blocking, 1m以下しか移動できず）
  5. combat全て拒否（cliff edge or creeper nearby）
  6. gather("stone"), gather("dirt") → timeout（gather関数が地下では動作しない可能性）
  7. 空腹度0で飢餓死
- **Fix Needed**: 
  - navigateがY座標の低い目標を選ぶ際に地下洞窟を避けるようにすること
  - または地下に入ったときの脱出ルーティン（掘り上がる）を追加
- **Status**: Critical recurring bug. keepInventoryで持物保持。



## [2026-03-24] Bug: Claude1 drowned during cave escape attempt

- **Cause**: pillarUp→water surface (Y=56 lake/river)→溺死。洞窟脱出中に水域に出てしまい溺れた。
- **Location**: src/bot-manager/bot-movement.js (pillarUp/navigation near water)
- **Coordinates**: 溺死地点 (~0, 56, 3) 水域, リスポーン: (2.4, 82, 6.5) 拠点
- **Context**: Y=55地下洞窟からpillarUpで脱出中（石ピッケルなし→gather失敗→pillarUp繰り返し）
- **Last Actions**:
  1. pillarUp (Y=56→59→62→64→66→68→71) 複数回呼び出し
  2. moveTo(3,80,6) → 途中で水に落ちてY=68.1に
  3. pillarUp → "swam up to Y=56.0 surface" (水面)
  4. 移動中に溺死
- **Fix Needed**: pillarUpが水域に出た場合の処理。水中での移動安全チェック。
- **Status**: keepInventoryで持物保持。死亡後HP/Hunger全快。stone_pickaxeクラフト済み。

## 2026-03-24 Session - Skeleton Death
- **死因**: Skeleton に矢で撃たれて死亡（"Claude1 was shot by Skeleton"）
- **状況**: 真夜中、HP=14で逃走中、Y=72付近（地下？）
- **近くの敵**: pillager x2 (11-13m north), skeleton x4, creeper x5, zombie x4, witch x1
- **防具**: なし（0/4スロット）
- **反省**: 夜間にnavigateを使ったことで敵エリアに誘導された可能性
- **対策**: 夜間はpillarUpのみ。navigateは昼間のみ使用すること

## [2026-03-25] Bug: Complete movement freeze at cliff edge - Session 57

- **Cause**: ボットが崖端(29.7, 91, -6.5)に位置し、東西北がstoneブロック、南がY=90空洞の崖。pathfinderが全方向で落下リスクと判定し経路なし→全movement API失敗。
- **Root Pattern**: 高地(Y=91)の崖端でpathfinderが完全にブロック。pillarUp/flee/moveTo/navigate全てタイムアウト。
- **Location**: src/bot-manager/bot-movement.ts (pathfinder cliff detection)
- **Coordinates**: スタック地点 (29.7, 91, -6.5) birch_forest biome
- **Working APIs**: status(), inventory(), place(), chat(), wait()
- **Failed APIs**: moveTo(), navigate(), gather(), craft(), smelt(), build(), pillarUp(), flee()
- **Last Actions**:
  1. 高地(Y=91)の崖端に移動
  2. 東西北: stoneブロック、南: 崖(Y=90が空洞)
  3. pathfinder経路なし→全movement失敗
  4. place()で南側に土ブロック足場作成を試みたが解決せず
- **Fix Needed**: 崖端スタック時の脱出ルーティン。pillarUpが確実に動作するよう崖端判定を修正。
- **Status**: Phase 1-3完了(stone_sword, stone_pickaxe所持)。Phase 4完全停止中。

## [2026-03-27] Bug: Session 91 - 死亡 - 夜間HP枯渇+接続切断
- **Cause**: 真夜中(ticks 22813)、食料ゼロ、HP=5.5で敵(creeper x3, skeleton x2)に囲まれた状態でpillarUp()を試みた際にMCP接続が切断。死亡の可能性高い。
- **Coordinates**: x=-8, y=91, z=17 (birch_forest)
- **Last Actions**: flee() → combat("cow")失敗→食料なし → build("shelter")完了→HP:20回復 → gather("birch_log")でHP=5.5に急落 → pillarUp()でMCP接続切断
- **Error Message**: "MCP error -32000: Connection closed"
- **Root Cause**: gather()中に敵に攻撃されHP低下。食料がなくHP回復できず。pillarUpタイムアウトで接続切断。
- **Status**: Reported. 夜間の木材収集中にHP枯渇するパターン。gather()に夜間・低HP時の安全チェックが必要。

## [2026-03-27] Bug: Session 91 - combat()が食料ドロップを収集できないバグ
- **Cause**: combat("cow"), combat("sheep"), combat("chicken"), combat("zombie")を実行してもraw_beef/raw_chicken/rotten_flesh等の食料がインベントリに入らない。combatは「完了」と返すが食料アイテムがゼロのまま。
- **Coordinates**: x=-18, y=60, z=6 (birch_forest)
- **Last Actions**: combat("cow") → combat("chicken") → combat("zombie") → 全て「完了」だが食料0
- **Error Message**: なし（正常終了扱い）
- **Root Cause**: combat()がエンティティを撃破してもドロップアイテムを拾っていない可能性。または食料が地面に落ちたまま収集されていない。
- **Impact**: 食料確保が完全に不可能になる致命的バグ。Hunger枯渇で必ず死亡する。
- **Status**: Reported. combat()のドロップ収集機能を修正必要。

## [2026-03-27] Bug: Session 91 - gather()/pillarUp()が連続タイムアウト（敵囲まれ状態）
- **Cause**: skeleton x2, creeper x2が周囲にいる状態でgather("birch_log", 2)とpillarUp(15)が両方タイムアウト30-45秒。status()は正常動作。
- **Coordinates**: x=-15, y=60, z=6 (birch_forest)
- **Last Actions**: gather("birch_log", 2) × 3回タイムアウト → pillarUp(15)タイムアウト
- **Error Message**: "Execution timed out after 30000ms/45000ms"
- **Root Cause**: 敵に囲まれた状態でpathfinderが経路を見つけられない/敵回避で移動できない。
- **Impact**: HP=3.5, Hunger=0で移動も食料確保もできない死亡確定状態。
- **Status**: Reported. gather()/pillarUp()に敵検知時の中断・flee機能が必要。

## [2026-03-27] Bug: Session 91 - moveTo()がY軸方向に移動できない（地下閉じ込め）
- **Cause**: moveTo(x, y+20, z)を試みてもy座標が全く変わらない。y=60から moveTo(x, 80, z)を実行してもy=61までしか変わらない。Y方向の経路探索が機能していない可能性。
- **Coordinates**: x=-2, y=60, z=9 (birch_forest, 地下洞窟内)
- **Last Actions**: moveTo(x, 65, z) → y=61のまま変わらず × 5回。pillarUp(5)もタイムアウト。place("cobblestone", x, y+1..5, z)は成功するが自分は上に乗れない。
- **Error Message**: なし（moveTo成功扱い）
- **Root Cause**: 地下洞窟でpathfinderが地上への経路を見つけられない。place()で足場を作っても反映されない可能性。
- **Impact**: 地下閉じ込め状態。HP=3.5, Hunger=0で脱出不可能。
- **Status**: Reported. moveTo()のY軸経路探索修正必要。地下洞窟での脱出ルーチン必要。
