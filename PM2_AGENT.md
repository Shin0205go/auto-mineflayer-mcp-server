# PM2で管理する自己修復Minecraftエージェント

Claude Code CLIをPM2で管理し、クラッシュしても自動で復帰・自己修正する不死身のエージェント。

## アーキテクチャ

```
PM2 (プロセス管理)
  ↓
Claude Code (--dangerously-skip-permissions)
  ├─ Game Agent機能: Minecraftプレイ
  ├─ Dev Agent機能: エラー時に自己修正
  ├─ タスク管理: TaskCreate/Update
  └─ 自律ループ: --continue で継続実行
```

## 特徴

✅ **自動再起動**: クラッシュしても10秒後に自動復帰
✅ **自己修復**: エラーログを読んで自分でコード修正
✅ **タスク管理**: ビルトインのTask機能で自律的に計画・実行
✅ **エラー学習**: 同じミスを繰り返さない
✅ **永続ログ**: 全ての行動・エラーをログに記録

## クイックスタート

### 1. ビルド
```bash
npm run build
```

### 2. エージェント起動
```bash
npm run agent:start
```

これで自動的に：
1. MCP WebSocketサーバーが起動
2. Claude Codeエージェントが起動
3. Minecraftサーバーに接続
4. 自律的にプレイ開始

### 3. ログ確認
```bash
npm run agent:logs
```

### 4. 停止
```bash
npm run agent:stop
```

## PM2コマンド

```bash
# 状態確認
npm run agent:status
pm2 status

# ログ確認（リアルタイム）
npm run agent:logs
pm2 logs minecraft-agent

# 過去のログ
cat logs/agent-out.log
cat logs/agent-error.log

# 再起動
npm run agent:restart
pm2 restart minecraft-agent

# メモリ・CPU使用率
pm2 monit

# プロセスキル
pm2 kill
```

## 設定

### ecosystem.config.js

```javascript
{
  max_restarts: 20,        // 最大20回まで再起動
  min_uptime: '30s',       // 30秒以上動けば成功
  restart_delay: 10000,    // 10秒待ってから再起動
  max_memory_restart: '2G' // 2GB超えたら再起動
}
```

### 環境変数

```bash
# .env または ecosystem.config.js の env セクション
MCP_WS_URL=ws://localhost:8765
MC_HOST=localhost
MC_PORT=25565
BOT_USERNAME=Claude
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

## エラーハンドリングの仕組み

### 1. クラッシュ時
```
1. PM2がクラッシュを検知
2. エラーログを logs/agent-error.log に記録
3. 10秒待機
4. --continue で再起動
5. Claude Codeが前回のセッションとエラーログを読む
6. エラー原因を分析
7. 必要ならコード修正（Edit/Write）
8. 修正したらビルド（Bash: npm run build）
9. プレイ再開
```

### 2. 繰り返しエラー時
```
- Claude Codeが「このエラー前も見た」と認識
- より根本的な修正を試みる
- 必要なら設計変更も提案・実行
```

## トラブルシューティング

### エージェントが起動しない
```bash
# MCPサーバーが起動しているか確認
pm2 status mcp-ws-server

# 手動でMCPサーバー起動
npm run start:mcp-ws

# その後エージェント起動
npm run agent:start
```

### エージェントが頻繁にクラッシュする
```bash
# 詳細ログを確認
pm2 logs minecraft-agent --lines 100

# エラーログ確認
tail -n 50 logs/agent-error.log
```

Claude Codeが20回再起動しても直せない場合は、手動介入が必要。

### メモリリーク
```bash
# メモリ使用量確認
pm2 monit

# メモリ制限を調整（ecosystem.config.js）
max_memory_restart: '3G'  # 2GB → 3GB
```

## 高度な使い方

### 初回起動時のプロンプト
```bash
# ecosystem.config.js を編集
args: '--dangerously-skip-permissions "Minecraftエンダードラゴン討伐を目指して自律的にプレイしてください"'
```

### デバッグモード
```bash
# ecosystem.config.js
args: '--continue --dangerously-skip-permissions --debug'
```

### Agent Teams（実験的）
```bash
# 環境変数を有効化（ecosystem.config.js）
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'

# 初回起動時にプロンプトでチーム作成を指示
"3人のエージェントチームを作成して、それぞれ採掘・建築・探索を担当してください"
```

## 注意事項

⚠️ **--dangerously-skip-permissions**: 全ての許可チェックをバイパス。サンドボックス環境推奨。
⚠️ **コスト**: Claude Code は API使用料がかかります。長時間実行に注意。
⚠️ **Minecraft OP権限**: ボットに `/op botname` を付与してください。

## ログローテーション

PM2は自動でログローテーションしません。大きくなりすぎたら：

```bash
pm2 flush  # ログクリア
```

または cron で定期的にクリア：
```bash
0 0 * * * pm2 flush
```

## まとめ

**完全自律のMinecraftエージェント**が実現できます：
- 勝手にプレイ
- 勝手にタスク管理
- エラーで落ちても勝手に復帰
- 自分でコード修正
- 不死身

放置して数時間後に見たら、勝手にダイヤ装備揃えてネザーに行ってるかも🚀
