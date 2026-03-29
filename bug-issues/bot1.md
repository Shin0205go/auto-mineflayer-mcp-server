## [2026-03-29] Bug: CRITICAL - botが空中に固定されて動けない（最新）

- **Cause**: botがY=96, X=6, Z=7付近の空中に固定され、移動不能・落下不能な状態になった。
  - pathfinder.goto()が "The goal was changed" で全て失敗
  - setControlState('forward'/'jump'/'sprint')が効かない
  - 重力が効かない（Y=96で固定、落下しない）
  - 足元はairブロック、下Y=85に水
- **Trigger**: setControlState('sprint', true) + lookAt(target) + forward で移動を試みていたところ、ネザーポータル(-3,98,5)近くでY=96にテレポートされた
- **Last Actions**: 手動スプリントで lapis_ore(23,57,27)へ向かっていた
- **Coordinates**: 6, 96, 7 (Overworld)
- **Status**: CRITICAL - bot完全停止。再接続後も状態継続。コードレビューアー確認必須。

## [2026-03-29] Bug: pathfinder "The goal was changed before it could be completed" 繰り返し失敗

- **Cause**: bot.pathfinder.goto() が GoalNear/GoalBlock/GoalXZ いずれのゴールタイプでも "The goal was changed before it could be completed!" エラーで失敗する。距離2以内の作業台へのGoalNearでも失敗。
- **Frequency**: このセッションで20回以上発生。ほぼすべての移動試みで失敗。
- **Location**: Overworld, 拠点周辺
- **Note**: pathfinder.setGoal()でも同様に失敗。手動制御キー（setControlState）で部分的な移動は可能だったが、その後完全停止。
- **Impact**: CRITICAL - 通常の採掘・移動・クラフトが不可能。ゲームプレイが大幅に制限される。
- **Status**: Reported. コードレビューアー修正必須。

## [2026-03-29] Bug: CRITICAL - ブレイズ戦闘中に溶岩逃走死亡 (Phase 6 最重要)

- **Cause**: ブレイズの火の玉ダメージを受けたbot pathfinderが逃走ルートとして溶岩を選択。「Claude1 tried to swim in lava to escape Blaze」。要塞周辺が溶岩海に囲まれているため、逃走すると必ず溶岩に落下。
- **Death count**: 10回以上（同セッション）。keepInventoryのため装備保持。
- **Root Cause**: pathfinder flee logic does NOT avoid lava when fleeing from combat.
- **Spawner Location**: the_nether (290, 77, -97) - confirmed.
- **Required Fix**:
  1. pathfinder flee路でliquidCostを適用すること
  2. OR ブレイズ戦闘中に逃走を無効化してその場でHP管理すること
- **Status**: CRITICAL - Phase 6が進行不能。コードレビューアー修正必須。

## [2026-03-29] Bug: CRITICAL - ネザー探索中に繰り返し死亡（Phase 6）

- **Cause**: ネザー探索中に複数回HP=0に低下→overworld復帰。食料ゼロで探索継続のため回復不可。
- **Coordinates**: the_nether X=59,Y=54,Z=7 と X=259,Y=94,Z=-3
- **Status**: Reported - CRITICAL。食料ゼロ問題と組み合わさり毎回死亡。

## [2026-03-29] Bug: Magma Cube死亡 (Phase 6継続)

- **Cause**: Claude1 was slain by Magma Cube (chat log: timestamp 1774743132346)
- **Coordinates**: Overworld spawn point (6, 88, 5)
- **Status**: Reported. keepInventoryによりアイテム保持。

## [2026-03-29] Bug: Session - 飢餓死 + HP低下死 (Phase5期間)

- **Cause**: 地下洞窟水没エリアで食料ゼロ・HP低下により死亡 × 複数回。
- **Status**: Reported (deaths confirmed, keepInventory preserved items)
