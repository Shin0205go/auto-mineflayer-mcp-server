# Bug Report: Claude1 在虚空位置

**日期**: 2026-04-02 11:15 UTC
**阶段**: Phase 2 农场建设
**严重性**: CRITICAL

## 问题描述
Claude1在执行`awareness()`和农地探查后，位置跳转到虚空（-9.5, 114, -7.5），周围没有方块。

## 具体坐标
- 预期位置: (5.5, 69, 5.5) — 拠点附近
- 实际位置: (-9.5, 114, -7.5) — 虚空
- Y坐标114: 远高于世界上限（Y=128之上）

## 重现步骤
1. 初始状态: HP 20, Hunger 20, 位置 (5.5, 69, 5.5)
2. 执行 `bot.findBlocks({matching: farmland})`
3. 位置跳转至虚空 (-9.5, 114, -7.5)
4. 尝试 `bot.respawn()` — 失败，位置不变
5. 执行 `bot.quit()` 然后重新连接
6. 仍在虚空 (-10.2, 114, -7.5)

## 症状
- Below block: none (全方向都是虚空)
- HP保持20（不掉血）
- 无法自救（respawn失败）

## 可能原因
- pathfinder或findBlocks导致位置错误更新
- 虚空坐标的存储bug（可能Y坐标计算溢出）
- bot.entity.position同步错误

## 建议修复
1. 检查 `findBlocks()` 的坐标边界验证
2. 验证 `bot.entity.position` 的同步机制
3. 添加位置范围检查（reject Y > 128 or Y < -64）
4. 添加respawn失败时的自动recovery逻辑

## 后续行动
- 需要admin手动传送到安全位置或重启服务器
- 建议添加位置边界验证到mc-execute.ts

## 追記1: Pathfinder Goal Change Error (CRITICAL)
- 虚空脱出後、位置がY=72に自動修正される
- その後、全ての短距離移動で「The goal was changed before it could be completed!」エラーが反復
- 複数の目標座標（距離7-9ブロック、timeout=10000設定）で同じエラー
- **原因**: botManager内のpathfinderが排他的に使用中、または他のボットとの競争状態
- **結果**: Claude1はpathfinder移動不可（拠点へアクセス不可）

## 追記2: 環境状態
- 周辺構造が見えない（blockAt()で全て air または not found）
- findBlocks()は拠点ブロック検出可能
- 現在地: (6.7, 71, 2.7) — 孤立した空間
- onGround: true （足場あり、但し見えない）

## 追記3: Movement Systems 完全失敗
- **pathfinder**: 全目標で goal changeエラー（排他的使用中の可能性）
- **setControlState()**: 制御無視（velocity更新されない）
- **respawn()**: 位置変更なし
- **velocity reset**: 効果なし
- **jump制御**: 高度変わらず

## 推定原因
1. ネットワーク同期の完全断裂（Server ↔ Client position out-of-sync）
2. botManager内のpathfinderが排他的ロックを保持
3. サーバー側のphysicsエンジンが停止/バグ状態
4. bot.entity.positionがローカル座標のみ更新（サーバーと非同期）

## 必要な対応
- **管理者による手動テレポート**: `/teleport Claude1 0 73 7`
- **またはサーバーリスタート**（全ボット切断上等）
- コード修正必要部位:
  - src/bot-manager/bot-core.ts: pathfinder排他制御のバグ確認
  - src/tools/mc-execute.ts: position同期チェック追加

---
**状態**: 待修復（code-reviewer処理）
