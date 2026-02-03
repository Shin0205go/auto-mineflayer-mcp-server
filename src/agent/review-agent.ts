/**
 * Review Agent - 行動ログを分析して最適化ルールを生成
 *
 * 掲示板のログを定期的に分析し、非効率なパターンを検出、
 * 改善ルールを生成してGame Agentの行動を最適化する
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

const PREFIX = "[ReviewAgent]";
const BOARD_FILE = path.join(process.cwd(), "shared-board.txt");
const RULES_FILE = path.join(process.cwd(), "learning", "rules.json");
const REVIEW_LOG_FILE = path.join(process.cwd(), "learning", "review-log.md");

// 分析間隔（ミリ秒）
const REVIEW_INTERVAL = 5 * 60 * 1000; // 5分ごと

// 最低ログ行数（これ以下なら分析スキップ）
const MIN_LOG_LINES = 20;

// ルールの型定義
interface OptimizationRule {
  id: string;
  category: string;  // movement, crafting, combat, resource, etc.
  pattern: string;   // 検出したパターン
  rule: string;      // 推奨行動
  priority: "high" | "medium" | "low";
  createdAt: string;
  successCount: number;  // このルールが役立った回数
}

interface RulesFile {
  version: number;
  lastUpdated: string;
  rules: OptimizationRule[];
}

// 色付きログ
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

class ReviewAgent {
  private lastReviewedLine: number = 0;
  private isRunning: boolean = false;

  async start(): Promise<void> {
    console.log(`${PREFIX} ${C.cyan}Starting Review Agent...${C.reset}`);
    console.log(`${PREFIX} Review interval: ${REVIEW_INTERVAL / 1000}s`);
    console.log(`${PREFIX} Rules file: ${RULES_FILE}`);

    this.isRunning = true;

    // 初回は少し待ってから実行
    await this.delay(10000);

    while (this.isRunning) {
      try {
        await this.reviewCycle();
      } catch (e) {
        console.error(`${PREFIX} Review cycle error:`, e);
      }

      await this.delay(REVIEW_INTERVAL);
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log(`${PREFIX} Stopping...`);
  }

  private async reviewCycle(): Promise<void> {
    console.log(`${PREFIX} ${C.cyan}=== Starting Review Cycle ===${C.reset}`);

    // 1. 掲示板を読む
    const logs = this.readBoardLogs();
    if (!logs || logs.length < MIN_LOG_LINES) {
      console.log(`${PREFIX} Not enough logs to analyze (${logs?.length || 0} lines)`);
      return;
    }

    // 2. 新しいログだけ抽出
    const newLogs = logs.slice(this.lastReviewedLine);
    if (newLogs.length < MIN_LOG_LINES) {
      console.log(`${PREFIX} Not enough new logs (${newLogs.length} lines since last review)`);
      return;
    }

    console.log(`${PREFIX} Analyzing ${newLogs.length} new log lines...`);

    // 3. パターン分析
    const analysis = await this.analyzePatterns(newLogs.join("\n"));
    if (!analysis) {
      console.log(`${PREFIX} No patterns detected`);
      this.lastReviewedLine = logs.length;
      return;
    }

    // 4. ルール生成・保存
    if (analysis.newRules && analysis.newRules.length > 0) {
      console.log(`${PREFIX} ${C.green}Generated ${analysis.newRules.length} new rules${C.reset}`);
      await this.saveRules(analysis.newRules);
      this.logReview(analysis);
    }

    this.lastReviewedLine = logs.length;
    console.log(`${PREFIX} ${C.cyan}=== Review Cycle Complete ===${C.reset}`);
  }

  private readBoardLogs(): string[] | null {
    try {
      if (!fs.existsSync(BOARD_FILE)) {
        return null;
      }
      const content = fs.readFileSync(BOARD_FILE, "utf-8");
      return content.split("\n").filter(line => line.trim());
    } catch (e) {
      console.error(`${PREFIX} Failed to read board:`, e);
      return null;
    }
  }

  private async analyzePatterns(logContent: string): Promise<{
    patterns: string[];
    newRules: OptimizationRule[];
    summary: string;
  } | null> {
    const existingRules = this.loadRules();
    const existingRulesSummary = existingRules.rules
      .map(r => `- [${r.category}] ${r.rule}`)
      .join("\n");

    const prompt = `あなたはMinecraftエージェントの行動分析AIです。

## 既存ルール
${existingRulesSummary || "(なし)"}

## 行動ログ
\`\`\`
${logContent.slice(-15000)}  // 最新15000文字
\`\`\`

## タスク
ログを分析し、以下を特定してください：

1. **非効率パターン**: 同じ失敗の繰り返し、無駄な行動
2. **成功パターン**: うまくいった行動シーケンス
3. **改善ルール**: 次回から適用すべき行動指針

## 出力形式 (JSON)
\`\`\`json
{
  "patterns": [
    "検出したパターン1の説明",
    "検出したパターン2の説明"
  ],
  "newRules": [
    {
      "category": "movement|crafting|combat|resource|infrastructure|safety",
      "pattern": "このルールが適用される状況",
      "rule": "推奨される行動（具体的に）",
      "priority": "high|medium|low"
    }
  ],
  "summary": "全体的な分析サマリー"
}
\`\`\`

注意:
- 既存ルールと重複するものは生成しない
- 具体的で実行可能なルールにする
- 1-3個の重要なルールに絞る
- パターンが見つからなければ空配列を返す
- **松明・光レベル・暗闘に関するルールは生成しない**（エージェントは光を気にしない）`;

    try {
      const result = query({
        prompt,
        options: {
          model: "claude-sonnet-4-20250514",
          maxTurns: 1,
          tools: [],
        },
      });

      let responseText = "";
      for await (const msg of result) {
        if (msg.type === "result" && msg.subtype === "success") {
          responseText = msg.result || "";
        }
      }

      // JSON抽出
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);

        // ルールにIDと日時を追加
        const newRules: OptimizationRule[] = (parsed.newRules || []).map((r: any, i: number) => ({
          id: `rule_${Date.now()}_${i}`,
          category: r.category,
          pattern: r.pattern,
          rule: r.rule,
          priority: r.priority,
          createdAt: new Date().toISOString(),
          successCount: 0,
        }));

        return {
          patterns: parsed.patterns || [],
          newRules,
          summary: parsed.summary || "",
        };
      }
    } catch (e) {
      console.error(`${PREFIX} Analysis failed:`, e);
    }

    return null;
  }

  private loadRules(): RulesFile {
    try {
      if (fs.existsSync(RULES_FILE)) {
        return JSON.parse(fs.readFileSync(RULES_FILE, "utf-8"));
      }
    } catch (e) {
      console.error(`${PREFIX} Failed to load rules:`, e);
    }

    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      rules: [],
    };
  }

  private async saveRules(newRules: OptimizationRule[]): Promise<void> {
    const existing = this.loadRules();

    // 重複チェック（同じruleテキストは追加しない）
    const uniqueNewRules = newRules.filter(newRule =>
      !existing.rules.some(existingRule =>
        existingRule.rule.toLowerCase() === newRule.rule.toLowerCase()
      )
    );

    if (uniqueNewRules.length === 0) {
      console.log(`${PREFIX} No unique new rules to add`);
      return;
    }

    existing.rules.push(...uniqueNewRules);
    existing.lastUpdated = new Date().toISOString();
    existing.version++;

    // learning ディレクトリ確保
    const dir = path.dirname(RULES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(RULES_FILE, JSON.stringify(existing, null, 2));

    console.log(`${PREFIX} Saved ${uniqueNewRules.length} new rules:`);
    uniqueNewRules.forEach(r => {
      console.log(`${PREFIX}   ${C.yellow}[${r.category}]${C.reset} ${r.rule}`);
    });
  }

  private logReview(analysis: { patterns: string[]; newRules: OptimizationRule[]; summary: string }): void {
    const timestamp = new Date().toISOString();
    const entry = `
## Review: ${timestamp}

### Detected Patterns
${analysis.patterns.map(p => `- ${p}`).join("\n")}

### New Rules Generated
${analysis.newRules.map(r => `- [${r.priority}] **${r.category}**: ${r.rule}`).join("\n")}

### Summary
${analysis.summary}

---
`;

    try {
      fs.appendFileSync(REVIEW_LOG_FILE, entry);
    } catch (e) {
      console.error(`${PREFIX} Failed to write review log:`, e);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// エントリーポイント
const agent = new ReviewAgent();

process.on("SIGINT", () => {
  console.log(`\n${PREFIX} Received SIGINT, shutting down...`);
  agent.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log(`\n${PREFIX} Received SIGTERM, shutting down...`);
  agent.stop();
  process.exit(0);
});

agent.start().catch(e => {
  console.error(`${PREFIX} Fatal error:`, e);
  process.exit(1);
});
