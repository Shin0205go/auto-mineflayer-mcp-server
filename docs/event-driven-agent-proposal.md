# イベント駆動型自律エージェント設計案

Minecraftエージェントの仕組みを汎用化し、開発環境向けの自律エージェントを構築する提案。

## 背景

Minecraftエージェントで得られた知見：
- WebSocket + ポーリングの組み合わせが現実的
- イベントをバッファリング→ループでプロンプト注入が有効
- Claude APIがHTTPである制約下での最適解

## コアアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                    Event Sources                        │
├─────────────────────────────────────────────────────────┤
│  fs.watch()      → ファイル変更                          │
│  build process   → ビルドエラー/成功                     │
│  test runner     → テスト結果                           │
│  linter          → 警告/エラー                          │
│  git hooks       → コミット/プッシュ                     │
│  terminal        → コマンド出力                          │
│  custom webhook  → 外部サービス通知                      │
└──────────────────────┬──────────────────────────────────┘
                       │ EventEmitter
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Event Aggregator (WS Server)               │
├─────────────────────────────────────────────────────────┤
│  - イベント収集・正規化                                   │
│  - 優先度付け（緊急/通常）                                │
│  - 重複排除・バッチング                                   │
│  - 履歴保持（ファイル/メモリ）                            │
│  - 複数クライアント管理                                   │
└──────────────────────┬──────────────────────────────────┘
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Agent Loop                            │
├─────────────────────────────────────────────────────────┤
│  1. イベント取得（WS受信 or タイムアウト）                 │
│  2. イベントをプロンプトに整形                            │
│  3. LLM API呼び出し                                     │
│  4. ツール実行（ファイル編集、コマンド等）                  │
│  5. 結果をイベントとして発行                              │
│  6. 繰り返し                                            │
└─────────────────────────────────────────────────────────┘
```

## イベント定義

```typescript
interface AgentEvent {
  id: string;
  type: EventType;
  source: string;           // "filesystem" | "build" | "test" | "lint" | "git" | "terminal"
  priority: "urgent" | "normal" | "low";
  timestamp: number;
  data: Record<string, unknown>;
  message: string;          // 人間/LLM可読なメッセージ
}

type EventType =
  // ファイルシステム
  | "file_created"
  | "file_changed"
  | "file_deleted"
  // ビルド
  | "build_started"
  | "build_success"
  | "build_error"
  // テスト
  | "test_started"
  | "test_passed"
  | "test_failed"
  // Lint
  | "lint_warning"
  | "lint_error"
  // Git
  | "git_commit"
  | "git_push"
  | "git_conflict"
  // ターミナル
  | "command_output"
  | "command_error"
  // エージェント間
  | "agent_message"
  | "agent_status";
```

## 優先度とハンドリング

| 優先度 | 例 | ハンドリング |
|--------|-----|-------------|
| urgent | build_error, test_failed | 即座に次ループで処理 |
| normal | file_changed, lint_warning | バッファリング後処理 |
| low | git_commit, command_output | 履歴として保持 |

## コンポーネント設計

### 1. Event Watcher（イベント発生源）

```typescript
// dev-watcher.ts
class DevEnvironmentWatcher extends EventEmitter {
  // ファイル監視
  watchFiles(patterns: string[]) {
    // chokidar or fs.watch
  }

  // ビルドプロセス監視
  watchBuild(command: string, cwd: string) {
    // spawn + stdout/stderr解析
  }

  // テストランナー監視
  watchTests(command: string) {
    // Jest/Vitest等の出力解析
  }

  // Linter監視
  watchLint(command: string) {
    // ESLint等の出力解析
  }
}
```

### 2. Event Aggregator（WSサーバー）

```typescript
// event-server.ts
class EventAggregator {
  private events: AgentEvent[] = [];
  private clients: Map<string, WebSocket> = new Map();

  // イベント受信・配信
  receiveEvent(event: AgentEvent) {
    this.events.push(event);
    this.broadcast(event);
    this.persistToFile(event);  // 履歴保持
  }

  // クライアントへ配信
  broadcast(event: AgentEvent) {
    for (const [id, ws] of this.clients) {
      ws.send(JSON.stringify({
        method: "notifications/event",
        params: event
      }));
    }
  }

  // イベント取得API
  getEvents(since: number, priority?: string): AgentEvent[] {
    return this.events.filter(e =>
      e.timestamp > since &&
      (!priority || e.priority === priority)
    );
  }
}
```

### 3. Agent Loop

```typescript
// agent-loop.ts
class AutonomousAgent {
  private eventBuffer: AgentEvent[] = [];

  async run() {
    while (this.running) {
      // 1. イベント待機（タイムアウト付き）
      const event = await this.waitForEvent(5000);

      // 2. プロンプト構築
      const prompt = this.buildPrompt(event);

      // 3. LLM呼び出し
      const result = await this.llm.query(prompt);

      // 4. ツール実行（結果もイベントとして発行）
      await this.executeTools(result.toolCalls);

      // 5. 状態更新
      await this.updateStatus();
    }
  }

  private buildPrompt(event: AgentEvent | null): string {
    const recentEvents = this.formatEvents(this.eventBuffer);

    if (event?.priority === "urgent") {
      return `
## 緊急イベント
${event.message}

## 直近のイベント
${recentEvents}

緊急イベントに対応してください。
`;
    }

    return `
## 直近のイベント
${recentEvents}

状況を確認し、必要な対応をしてください。
`;
  }
}
```

## MCPツール（開発環境向け）

```typescript
const tools = {
  // ファイル操作
  "file_read": { /* ... */ },
  "file_write": { /* ... */ },
  "file_edit": { /* ... */ },

  // コマンド実行
  "run_command": { /* ... */ },
  "run_build": { /* ... */ },
  "run_test": { /* ... */ },
  "run_lint": { /* ... */ },

  // Git操作
  "git_status": { /* ... */ },
  "git_diff": { /* ... */ },
  "git_commit": { /* ... */ },
  "git_push": { /* ... */ },

  // エージェント間通信
  "agent_send": { /* ... */ },
  "agent_broadcast": { /* ... */ },
};
```

## ユースケース例

### 1. 自動ビルドエラー修正

```
1. ファイル保存
2. file_changed イベント発火
3. ビルド自動実行
4. build_error イベント発火（urgent）
5. エージェントループで検知
6. LLMがエラー分析→修正案生成
7. file_edit ツールで修正
8. 再ビルド→成功
```

### 2. テスト駆動開発支援

```
1. テストファイル作成
2. test_failed イベント（テストが実装を先行）
3. エージェントが実装コード生成
4. test_passed イベント
5. 次のテストへ
```

### 3. マルチエージェント協調

```
Agent A: フロントエンド担当
Agent B: バックエンド担当

1. Agent A: API仕様変更を agent_broadcast
2. Agent B: イベント受信→型定義更新
3. Agent B: 完了を agent_send (to: A)
4. Agent A: フロントエンド修正続行
```

## Minecraftエージェントとの対応

| Minecraft | 開発環境 |
|-----------|---------|
| entitySpawn | file_changed |
| health_changed | build_error |
| death | test_failed (critical) |
| chat | agent_message |
| collect_item | command_output (success) |
| 掲示板 | 共有イベントログ |

## 実装ステップ

### Phase 1: 基盤
- [ ] イベント型定義
- [ ] Event Aggregator (WSサーバー)
- [ ] 基本的なファイル監視

### Phase 2: エージェントループ
- [ ] イベント駆動ループ
- [ ] プロンプト注入
- [ ] 基本ツール（file_read/write, run_command）

### Phase 3: 開発ツール統合
- [ ] ビルド監視・エラー解析
- [ ] テストランナー統合
- [ ] Linter統合

### Phase 4: マルチエージェント
- [ ] エージェント間メッセージング
- [ ] 役割分担・協調

### Phase 5: 高度な機能
- [ ] 自己改善（経験ログ→スキル更新）
- [ ] Gemini Live API対応（リアルタイム）

## 技術スタック案

- **言語**: TypeScript
- **WebSocket**: ws
- **ファイル監視**: chokidar
- **LLM**: Claude API（将来Gemini Live対応）
- **MCP**: @modelcontextprotocol/sdk

## 既存ツールとの差別化

| 特徴 | Cline | Claude Code | 本提案 |
|------|-------|-------------|--------|
| IDE依存 | VSCode | CLI | なし |
| イベント駆動 | △ | フック | ◎ |
| WS配信 | - | - | ◎ |
| マルチエージェント | - | - | ◎ |
| 疎結合 | △ | △ | ◎ |

## 参考

- Minecraftエージェント実装: このリポジトリ
- MCP仕様: https://modelcontextprotocol.io
- Claude Agent SDK: @anthropic-ai/claude-agent-sdk
