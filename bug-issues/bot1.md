## [2026-03-29] Bug: CRITICAL - ブレイズ戦闘中に溶岩逃走死亡 (Phase 6 最重要)

- **Cause**: ブレイズの火の玉ダメージを受けたbot pathfinderが逃走ルートとして溶岩を選択。「Claude1 tried to swim in lava to escape Blaze」。要塞周辺が溶岩海に囲まれているため、逃走すると必ず溶岩に落下。
- **Death count**: 10回以上（同セッション）。keepInventoryのため装備保持。
- **Root Cause**: pathfinder flee logic does NOT avoid lava when fleeing from combat. liquidCost設定しても逃走経路では無視される可能性。
- **Spawner Location**: the_nether (290, 77, -97) - confirmed.
- **Fortress Entry Point**: 安全に到達可能な座標 (291, 78, -88) - pathfinderで到達済み。
- **Required Fix**:
  1. pathfinder flee路でliquidCostを適用すること
  2. OR ブレイズ戦闘中に逃走を無効化してその場でHP管理すること
  3. OR creeperFlee相当のblaze対応追加
- **Status**: CRITICAL - Phase 6が進行不能。コードレビューアー修正必須。

## [2026-03-29] Bug: CRITICAL - ネザー探索中に繰り返し死亡（Phase 6）

- **Cause**: ネザー探索中に複数回HP=0に低下→overworld復帰（keepInventoryによりアイテム保持）。死亡原因は不明：piglins（距離52体以上）、magma cube（100+m先）、ghast、溶岩転落の可能性。食料ゼロで探索継続のため回復不可。
- **Coordinates**:
  - 1回目: the_nether X=59,Y=54,Z=7 (HP=0.12)
  - 2回目: the_nether X=259,Y=94,Z=-3 (HP=2.4→0→respawn)
- **Pattern**: bot descends from Y=110 portal to Y=65, moves X+ direction through soul_sand. HP drops rapidly without visible nearby threats.
- **Last Actions**: GoalXZ navigation toward X=200-300 in Nether. soul_sandエリアで移動ブロック。
- **Error Message**: HP低下のalertなし。突然の死亡。
- **Suspected Causes**:
  1. 溶岩ダメージ（soul_sandエリア下に溶岩湖の可能性）
  2. Ghast火の玉の遠距離ダメージ
  3. Fall damage from pathfinder navigation through complex terrain
- **Status**: Reported - CRITICAL。食料ゼロ問題と組み合わさり毎回死亡。

## [2026-03-29] Bug: Session Phase6 - ネザー探索中にHP=0.12まで低下（原因不明ダメージ）

- **Cause**: ネザー探索中（X=59,Y=54付近）でHP=0.12に。食料なし（No food in inventory）でHP回復不可。脅威エンティティは検知されず（ghastは74ブロック先）。Soul_sand上に立っていた。最終的にY=46から落下してoverworldに帰還しHP=20に回復。
- **Coordinates**: the_nether, X=59, Y=54, Z=7
- **Last Actions**: GoalXZ移動でX=200付近まで探索、タイムアウト繰り返し。食料ゼロでネザー探索継続。
- **Error Message**: HP=0.12000083923339844（half-heart以下）。突然低下した原因不明。
- **Status**: Reported. 要調査: なぜHPが急激に低下したか、食料なしネザー探索のリスク

## [2026-03-29] Bug: Session - 飢餓死 + HP低下死 (Phase5期間)

- **Cause**: 地下洞窟水没エリアで食料ゼロ・HP低下により死亡 × 複数回。
  1. 地下水域 (y=37) でHP=8→水中採掘減速。食料なし(Food=10)でHP回復不可 → 死亡 (HP=8 → 0)
  2. 地下探索中にHP=3.37, Food=0でほぼ確実死亡 (Phase5完了直後)
- **Coordinates**: 1回目: (-3, 37, 11) → リスポーン (54, 63, 7); 2回目: (32, 59, 57)
- **Root Cause**:
  1. 食料ゼロ時に地下採掘作業を継続した
  2. 地下水没エリアでの採掘はobsidian 1ブロック75秒 (5x減速)
  3. placeBlock() blockUpdateタイムアウトでpillarUp不可
  4. pathfinder zombie goal interference による移動妨害
- **Status**: Reported (deaths confirmed, keepInventory preserved items)

---

## [2026-03-29] Bug: Magma Cube死亡 (Phase 6継続)

- **Cause**: Claude1 was slain by Magma Cube (from chat log). ネザーポータル周辺でMagma Cubeに倒された。
- **Coordinates**: Overworld spawn point (6, 88, 5) → respawned here after death
- **Last Actions**: ネザー探索中（ブレイズロッド収集試み）
- **Time**: 2026-03-29 (timestamp 1774743132346)
- **Status**: Reported. keepInventoryによりアイテム保持。

## [2026-03-29] Bug: pathfinder "The goal was changed before it could be completed" 繰り返し失敗

- **Cause**: bot.pathfinder.goto() が GoalNear/GoalBlock/GoalXZ いずれのゴールタイプでも "The goal was changed before it could be completed!" エラーで失敗する。距離2以内の作業台へのGoalNearでも失敗。
- **Frequency**: このセッションで10回以上発生。ほぼすべての移動試みで失敗。
- **Location**: Overworld, 拠点周辺 (-7,58,15 → -3,74,2 付近)
- **Last Actions**: 木材採取のためbirch_log(-21,77,36)へ移動しようとした。作業台(-2,73,1)へ移動しようとした。いずれも失敗。
- **Note**: pathfinder.setGoal()でも同様に失敗。手動制御キー（setControlState）で部分的な移動は可能。canDig=trueでもcanDig=falseでも失敗。
- **Impact**: CRITICAL - 通常の採掘・移動・クラフトが不可能。ゲームプレイが大幅に制限される。
- **Status**: Reported. コードレビューアー修正必須。
