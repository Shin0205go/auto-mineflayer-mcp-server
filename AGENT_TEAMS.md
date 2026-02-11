# Agent Teams - 複数エージェント協調システム

複数のClaude Codeインスタンスが協力してMinecraftをプレイ。

## アーキテクチャ

```
PM2
 ├─ Team Lead (リーダー)
 │   └─ タスク作成・割り当て・調整
 ├─ Member 1 (採掘担当)
 │   └─ 鉱石採掘・資源収集
 └─ Member 2 (建築担当)
     └─ 建築・クラフト・拠点作り

共有リソース:
 - ~/.claude/tasks/minecraft-team/  (タスクリスト)
 - agent_board (メッセージング)
```

## 使い方

### シングルエージェント
```bash
npm run agent:start   # 1人のエージェント
npm run agent:logs
npm run agent:stop
```

### Agent Team（3人チーム）
```bash
npm run team:start    # リーダー + メンバー2人
npm run team:logs     # 全員のログ
npm run team:stop
```

## チーム構成のカスタマイズ

### 役割を変更

`ecosystem.config.cjs` の各メンバーの `BOT_USERNAME` を変更：

```javascript
{
  name: 'team-member-1',
  env: {
    BOT_USERNAME: 'Miner',      // 採掘担当
    AGENT_ROLE: 'member'
  }
}
```

### メンバーを追加

`ecosystem.config.cjs` に新しいエージェント設定を追加：

```javascript
{
  name: 'team-member-3',
  script: 'claude',
  args: '--continue --dangerously-skip-permissions',
  env: {
    BOT_USERNAME: 'Explorer',   // 探索担当
    AGENT_ROLE: 'member',
    MCP_WS_URL: 'ws://localhost:8765',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'
  },
  error_file: 'logs/team-member-3-error.log',
  out_file: 'logs/team-member-3-out.log'
}
```

起動スクリプトにも追加：
```bash
npx pm2 start ecosystem.config.cjs --only team-lead,team-member-1,team-member-2,team-member-3
```

### チームサイズの推奨

- **2-3人**: 最もバランスが良い（リーダー + メンバー1-2人）
- **4-5人**: 複雑なプロジェクト向け
- **6人以上**: オーバーヘッド大、コスト高

## チームワークの仕組み

### 1. リーダーの役割

```
1. タスクを作成（task_create）
   例: "鉄を20個集める", "家を建てる", "村を探す"

2. メンバーに割り当て（task_update）
   例: "Miner → 鉄採掘", "Builder → 家建築"

3. 進捗確認（agent_board_read）
   メンバーから報告を受け取る

4. 調整
   問題があれば再割り当てや支援
```

### 2. メンバーの役割

```
1. タスクを確認（task_list）
   自分に割り当てられたタスクを見る

2. タスク実行
   割り当てられた仕事を完了

3. 報告（agent_board_write）
   完了したらリーダーに報告

4. 次のタスクへ
   task_update(status: completed) して次へ
```

### 3. コミュニケーション

```typescript
// リーダー → メンバー
agent_board_write({
  message: "@Miner 鉄が足りません。採掘を優先してください"
});

// メンバー → リーダー
agent_board_write({
  message: "@Lead 鉄20個採掘完了しました。次のタスクをください"
});
```

## 実行例

### 初回起動時のプロンプト（リーダー）

```
3人のエージェントチームでMinecraftをプレイします。

あなたはTeam Leadです。
- Member1 (Miner): 採掘・資源収集担当
- Member2 (Builder): 建築・クラフト担当

タスクを作成して各メンバーに割り当て、進捗を管理してください。
最終目標: エンダードラゴン討伐
```

### 初回起動時のプロンプト（メンバー）

```
あなたはMinerです。Team Leadから割り当てられたタスクを実行してください。
専門: 採掘、資源収集

task_listで確認 → 実行 → agent_board_writeで報告 → 次のタスク
```

## トラブルシューティング

### メンバーが同じタスクを取り合う

タスク作成時に `owner` を明示的に指定：

```javascript
task_create({
  subject: "鉄採掘",
  description: "鉄鉱石を20個集める",
  metadata: { assignedTo: "Miner" }
});
```

### メンバーがリーダーの指示を無視

リーダーのプロンプトを強化：

```
IMPORTANT: メンバーは必ずあなたの指示に従います。
タスクを明確に割り当て、完了を確認してください。
```

### チーム内で競合

- 各メンバーに明確な役割分担
- ファイル編集は1人ずつ
- 建築エリアを分ける

## コスト管理

3人チーム = 3倍のAPIコスト

**節約方法:**
1. メンバーは Haiku モデルを使う
   ```javascript
   args: '--continue --dangerously-skip-permissions --model haiku'
   ```

2. リーダーのみ Sonnet
   ```javascript
   args: '--continue --dangerously-skip-permissions --model sonnet'
   ```

3. max_budget_usd で制限
   ```javascript
   args: '--continue --dangerously-skip-permissions --max-budget-usd 5'
   ```

## 高度な使い方

### 専門チーム

```javascript
// 完全分業制
Team Lead: 全体調整
Miner: 採掘専門（iron-mining, diamond-mining スキル）
Builder: 建築専門（building, crafting-chain スキル）
Explorer: 探索専門（exploration スキル）
Crafter: クラフト専門（crafting-chain スキル）
```

### 競合検証チーム

```
複数のメンバーに同じ問題を別アプローチで解かせる:
Member1: 方法Aで試す
Member2: 方法Bで試す
→ リーダーが最良の結果を選択
```

### 並列探索

```
広大なマップを分割探索:
Member1: 北方向探索
Member2: 南方向探索
Member3: 東方向探索
→ 効率的に村・構造物を発見
```

## まとめ

**Agent Teamsの利点:**
- ✅ 並列作業で効率アップ
- ✅ 各メンバーが専門特化
- ✅ クラッシュしても他が継続
- ✅ 複雑なプロジェクトに対応

**デメリット:**
- ❌ コスト3倍
- ❌ 調整オーバーヘッド
- ❌ 競合の可能性

**推奨:**
- シンプルな作業 → シングルエージェント
- 複雑・大規模 → Agent Teams

**テスト時:**
```bash
npm run team:start
npx pm2 logs team-lead
# リーダーがタスク作成・割り当てを始めるか確認
```
