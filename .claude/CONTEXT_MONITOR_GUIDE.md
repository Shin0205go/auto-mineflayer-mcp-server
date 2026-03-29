# Context Monitor ガイド

Claude Code ベストプラクティス実装 - Week 1 Quick Wins

## 目的
session 中の context 使用状況をリアルタイム監視し、トークン最適化の効果を測定するためのガイド。

## 使用コマンド

### /context コマンド
session 開始後、任意の時点で実行:

```
/context
```

**出力例:**
```
CLAUDE.md and System Prompt:
  System prompt: 300 tokens
  CLAUDE.md: ~600 tokens

Skills (Progressive Disclosure):
  21 skills available (loaded on-demand)
  [skill-name]: [tokens] (only when Read)

Auto-memory:
  MEMORY.md: ~200 tokens (first 200 lines)

MCP Tools:
  mineflayer-local: ~2,000 tokens (all tool definitions)

Total in context: ~3,100 tokens
Cache status:
  - If showing "Cache reads" section: キャッシュが有効！
  - Cache hit rate: 80%+ が目標

Remaining: 196,900 tokens (of 200K limit)
Utilization: 1.55% → Comfortable
```

## 監視ポイント

| メトリクス | 目標 | 対応 |
|----------|------|------|
| **Utilization** | < 50% | proactive action不要 |
| **Cache hit rate** | 70%+ | prompting caching成功 |
| **CLAUDE.md tokens** | < 600 | current state ✓ |
| **Tool definitions** | < 2K | MCP defer_loading で改善 |

## 効果測定

### キャッシュ効果測定
1. Session 1 回目で /cost を実行 → initial load 確認
2. Session 2 回目で /cost を実行 → cache reads を確認
3. 削減率計算: `(initial_input - cached_input) / initial_input * 100`

**期待: 70-90% 削減**

### Output Hook 効果測定
`.claude/hooks/post-execute-summarize.sh` 実行時に stderr に出力される統計情報:

```
[SUMMARIZE] Lines: 450 → 3 (99% reduction)
```

複数実行の平均削減率を記録。

**期待: 80-90% 削減**

## 推奨スケジュール

| タイミング | アクション | 目標 |
|-----------|-----------|------|
| Session開始直後 | `/context` で初期値確認 | baseline確立 |
| Action 50個後 | `/cost` で cache hit確認 | キャッシュ効果測定 |
| Session終了時 | 統計情報を記録 | weekly trend分析 |

## トラブルシューティング

### キャッシュが効かない場合

```
原因候補:
1. CLAUDE.md に timestampなど動的content が含まれている
2. Tool definitions の order が変わっている
3. System prompt が異なっている

対応:
- /context で確認
- .claude/mcp.json の内容を確認
- CLAUDE.md を静的に保つ
```

### Context utilization が 50% を超えた場合

```
対応:
1. 現在の state を確認: /context
2. 不要な file read を削除
3. Proactive compact 実行: /compact
4. Prompt: "Summarize to key points: current bot state, phase goal, last actions"
```

## 実装チェックリスト

- [x] mcp.json 設定完了
- [x] post-execute-summarize.sh 作成・executable化
- [ ] Session 1 で /context 実行
- [ ] Session 1 で /cost 実行 (baseline)
- [ ] Session 2 で /cost 実行 (cache verify)
- [ ] 効果測定結果を記録

## 次ステップ

Week 2 では以下を実装:
1. MCP Tool defer_loading
2. CLAUDE.md 再構成
3. Auto-memory cleanup

---
**更新日**: 2026-03-29
**実装者**: Claude Code Optimization Team
