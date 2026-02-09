/**
 * Meta-Prompt Manager - 自己書き換えシステム
 *
 * エージェント自身が自分の「行動規範（System Prompt）」を
 * 書き換える権限を持つシステム。
 *
 * 相転移が発生すると、現在のフェーズに対応するBehaviorProfileを
 * 基にSystem Promptを再生成し、以降の行動基準を切り替える。
 *
 * 生物学アナロジー: 遺伝子発現のエピジェネティック制御。
 * 同じDNA（コードベース）でも、どの遺伝子が発現するか（どの行動規範が
 * アクティブか）を環境に応じて切り替える。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { BehaviorProfile, SystemState } from "../types/bifurcation.js";

const DATA_DIR = join(process.cwd(), "bifurcation");
const PROMPT_FILE = join(DATA_DIR, "active-prompt.md");
const PROMPT_HISTORY_FILE = join(DATA_DIR, "prompt-history.jsonl");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * プロンプト更新のイベント記録
 */
interface PromptUpdateRecord {
  timestamp: number;
  fromState: SystemState;
  toState: SystemState;
  prompt: string;
  reason: string;
}

export class MetaPromptManager {
  private currentPrompt: string = "";
  private currentState: SystemState = "primitive_survival";
  private updateHistory: PromptUpdateRecord[] = [];

  constructor() {
    this.restore();
  }

  /**
   * 相転移に伴いSystem Promptを再生成
   *
   * BehaviorProfileから具体的なプロンプトテキストを生成し、
   * エージェントの行動基準を切り替える。
   */
  generatePrompt(
    targetState: SystemState,
    profile: BehaviorProfile,
    context?: {
      currentResources?: string;
      currentPosition?: string;
      activeAgents?: string[];
      transitionReason?: string;
    }
  ): string {
    const previousState = this.currentState;

    const prompt = this.buildPromptText(targetState, profile, context);

    // 状態更新
    this.currentState = targetState;
    this.currentPrompt = prompt;

    // 記録
    const record: PromptUpdateRecord = {
      timestamp: Date.now(),
      fromState: previousState,
      toState: targetState,
      prompt,
      reason: context?.transitionReason || `Phase transition to ${targetState}`,
    };
    this.updateHistory.push(record);

    // 永続化
    this.persist(record);

    console.log(`[MetaPrompt] System prompt updated for state: ${targetState}`);
    console.log(`[MetaPrompt] Phase: ${profile.phaseName}`);

    return prompt;
  }

  /**
   * 現在のアクティブプロンプトを取得
   */
  getCurrentPrompt(): string {
    return this.currentPrompt;
  }

  /**
   * 現在のフェーズに対応する追加指示を取得
   * エージェントのループプロンプトに挿入される
   */
  getPhaseDirective(): string {
    if (!this.currentPrompt) {
      return "";
    }
    return `\n## 現在のフェーズ指示\n${this.currentPrompt}\n`;
  }

  /**
   * 更新履歴を取得
   */
  getHistory(limit?: number): PromptUpdateRecord[] {
    if (limit) {
      return this.updateHistory.slice(-limit);
    }
    return [...this.updateHistory];
  }

  // ========== Prompt Generation ==========

  private buildPromptText(
    state: SystemState,
    profile: BehaviorProfile,
    context?: {
      currentResources?: string;
      currentPosition?: string;
      activeAgents?: string[];
      transitionReason?: string;
    }
  ): string {
    const sections: string[] = [];

    // ヘッダー
    sections.push(`# 現在のフェーズ: ${profile.phaseName}`);
    sections.push("");

    // 遷移理由（該当する場合）
    if (context?.transitionReason) {
      sections.push(`> **相転移理由**: ${context.transitionReason}`);
      sections.push("");
    }

    // 優先事項
    sections.push("## 優先事項（重要度順）");
    profile.priorities.forEach((p, i) => {
      sections.push(`${i + 1}. ${p}`);
    });
    sections.push("");

    // 推奨ツール
    sections.push("## 推奨ツール");
    sections.push(profile.preferredTools.map(t => `- \`${t}\``).join("\n"));
    sections.push("");

    // 回避行動
    if (profile.avoidActions.length > 0) {
      sections.push("## 避けるべき行動");
      profile.avoidActions.forEach(a => {
        sections.push(`- ⚠ ${a}`);
      });
      sections.push("");
    }

    // 意思決定基準
    sections.push("## 意思決定基準");
    sections.push(profile.decisionCriteria);
    sections.push("");

    // パラメータ
    sections.push("## 行動パラメータ");
    sections.push(`- リスク許容度: ${(profile.riskTolerance * 100).toFixed(0)}%`);
    sections.push(`- 自動化レベル: ${(profile.automationLevel * 100).toFixed(0)}%`);
    sections.push(`- 協調モード: ${this.translateCoordinationMode(profile.coordinationMode)}`);
    sections.push("");

    // コンテキスト情報
    if (context?.activeAgents && context.activeAgents.length > 1) {
      sections.push("## アクティブエージェント");
      context.activeAgents.forEach(a => {
        sections.push(`- ${a}`);
      });
      sections.push("");
    }

    // フェーズ固有の指示
    sections.push(this.getStateSpecificInstructions(state));

    return sections.join("\n");
  }

  private getStateSpecificInstructions(state: SystemState): string {
    switch (state) {
      case "primitive_survival":
        return [
          "## フェーズ固有ルール",
          "- HPが10以下なら即座に食事・退避を最優先",
          "- 夜間は必ずシェルター内で過ごす",
          "- 資源は手元に保持し、こまめにクラフトに使用",
          "- 作業台とかまどの場所を必ず記憶(recall_locations)",
          "- 死亡時のアイテムロスを最小化するため、貴重品は拠点に保管",
        ].join("\n");

      case "organized_settlement":
        return [
          "## フェーズ固有ルール",
          "- 自動農場のメンテナンスを定期的に確認",
          "- チェストの整理を怠らない（資源のカテゴリ分け）",
          "- 拠点から離れる場合はベッドでスポーン設定",
          "- ネザーポータル構築前に十分な装備を確認",
          "- 経験を積極的にlog_experienceで記録",
          "- 成功した手順はsave_skillで保存",
        ].join("\n");

      case "industrial_complex":
        return [
          "## フェーズ固有ルール",
          "- 手動作業は最終手段。常に自動化を検討",
          "- 掲示板(agent_board)を活用して他エージェントと連携",
          "- 大規模建設は計画→材料確保→建設の順序を厳守",
          "- レッドストーン回路のデバッグはreflect_and_learnで分析",
          "- 各ゾーンの生産性をモニタリングし、ボトルネックを解消",
          "- エンダードラゴン討伐の準備を段階的に進行",
        ].join("\n");

      default:
        return "";
    }
  }

  private translateCoordinationMode(mode: string): string {
    switch (mode) {
      case "solo": return "単独行動";
      case "cooperative": return "協調行動";
      case "hierarchical": return "階層的分業";
      default: return mode;
    }
  }

  // ========== Persistence ==========

  private persist(record: PromptUpdateRecord): void {
    try {
      ensureDataDir();
      // アクティブプロンプトを保存
      writeFileSync(PROMPT_FILE, this.currentPrompt);
      // 履歴を追記
      writeFileSync(
        PROMPT_HISTORY_FILE,
        JSON.stringify(record) + "\n",
        { flag: "a" }
      );
    } catch (e) {
      console.error("[MetaPrompt] Failed to persist:", e);
    }
  }

  private restore(): void {
    try {
      if (existsSync(PROMPT_FILE)) {
        this.currentPrompt = readFileSync(PROMPT_FILE, "utf-8");
        console.log("[MetaPrompt] Restored active prompt from file");
      }
    } catch {
      // 初回起動時はファイルなし
    }
  }
}
