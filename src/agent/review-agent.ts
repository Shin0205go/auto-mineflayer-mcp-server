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

    // 1. 掲示板の最新200行を読む
    const logs = this.readBoardLogs();
    if (!logs || logs.length < MIN_LOG_LINES) {
      console.log(`${PREFIX} Not enough logs to analyze (${logs?.length || 0} lines)`);
      return;
    }

    console.log(`${PREFIX} Analyzing ${logs.length} recent log lines...`);

    // 2. パターン分析
    const analysis = await this.analyzePatterns(logs.join("\n"));
    if (!analysis) {
      console.log(`${PREFIX} No patterns detected`);
      return;
    }

    // 3. ルール生成・保存
    if (analysis.newRules && analysis.newRules.length > 0) {
      console.log(`${PREFIX} ${C.green}Generated ${analysis.newRules.length} new rules${C.reset}`);
      await this.saveRules(analysis.newRules);
      this.logReview(analysis);
    }

    console.log(`${PREFIX} ${C.cyan}=== Review Cycle Complete ===${C.reset}`);
  }

  private readBoardLogs(): string[] | null {
    try {
      if (!fs.existsSync(BOARD_FILE)) {
        return null;
      }
      const content = fs.readFileSync(BOARD_FILE, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());
      // Only return last 200 lines to avoid overwhelming analysis
      const MAX_LINES = 200;
      return lines.slice(-MAX_LINES);
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

## ★重要: 既存ルール（${existingRules.rules.length}件）
以下のルールは既に登録済みです。**これらと重複・類似するルールは絶対に生成しないでください**。

${existingRulesSummary || "(なし)"}

## 行動ログ
\`\`\`
${logContent.slice(-15000)}  // 最新15000文字
\`\`\`

## タスク
ログを分析し、**既存ルールでカバーされていない**新しい問題パターンを特定してください：

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
      "category": "movement|crafting|combat|resource|infrastructure|safety|storage",
      "pattern": "このルールが適用される状況",
      "rule": "推奨される行動（具体的に）",
      "priority": "high|medium|low"
    }
  ],
  "summary": "全体的な分析サマリー"
}
\`\`\`

## 重要な制約
- **既存ルールと意味的に重複するものは生成禁止**（表現が違っても同じ内容ならNG）
- 具体的で実行可能なルールにする
- **本当に新しい知見のみ**1-3個に絞る
- パターンが見つからなければ空配列を返す
- 松明・光レベルに関するルールは不要（エージェントは光を気にしない）
- 既存ルールで十分カバーされている場合は newRules: [] を返す`;

    try {
      const result = query({
        prompt,
        options: {
          model: process.env.CLAUDE_MODEL || "sonnet",
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

    // 重複チェック（類似ルールも除外）
    const uniqueNewRules = newRules.filter(newRule => {
      const newRuleLower = newRule.rule.toLowerCase();
      const newRuleWords = new Set(newRuleLower.split(/\s+/).filter(w => w.length > 3));

      return !existing.rules.some(existingRule => {
        const existingLower = existingRule.rule.toLowerCase();

        // 完全一致チェック
        if (existingLower === newRuleLower) return true;

        // 同じカテゴリで単語の重複が多い場合は類似と判定
        if (existingRule.category === newRule.category) {
          const existingWords = new Set(existingLower.split(/\s+/).filter(w => w.length > 3));
          const overlap = [...newRuleWords].filter(w => existingWords.has(w)).length;
          const similarity = overlap / Math.max(newRuleWords.size, existingWords.size);
          if (similarity > 0.5) {
            console.log(`${PREFIX} Skipping similar rule: "${newRule.rule}" (similar to "${existingRule.rule}")`);
            return true;
          }
        }

        return false;
      });
    });

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
