# Feedback: Death is Never Acceptable

**Type:** Game Agent Constraint
**Date:** 2026-03-20+
**Status:** Active (enforced)

## Rule

**全ての死亡はバグ扱い。リスポーンで HP 回復するな。**

keepInventory が ON でも死亡を戦略にするな。

## Context

- keepInventory は server-side gamerule (ユーザーの譲歩)
- 死亡 = Agent logic failure
- Food が十分あれば HP は回復可能
- 死亡防止 > リスポーン戦術

## Implementation

```js
// 各アクション前に安全チェック
if (bot.health <= 5 || bot.food <= 2) {
  // リスポーンを考える前に:
  // 1. 逃げる
  // 2. 食料を食べる
  // 3. 敵から距離を取る
  // 4. Shelter に帰還
  return;
}

// 死亡は即座にバグレポート
if (/* death detected */) {
  // bug-issues/botN.md に記録
  // リスポーンしない
  // コードレビューアーの修正を待つ
}
```

## Monitoring

Code reviewer チェックリスト:
- [ ] bug-issues/ に死亡報告がない
- [ ] HP が 0 に到達する行動パスがない
- [ ] リスポーン前提の動作ロジックがない

## Links

- `.claude/rules/death-prevention.md`
- `.claude/rules/survival-rules.md`
- `bug-issues/` — 過去の死亡事例
