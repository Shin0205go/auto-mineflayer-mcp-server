/**
 * L2 Tactician
 *
 * Selects which skills to activate/deactivate based on current goal.
 * Uses Sonnet model with no tools — receives skill names + descriptions only.
 * Called when goals change or abort conditions trigger.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { WorldState, Goal, TacticalPlan } from "./types.js";
import type { SkillRegistry } from "./skill-registry.js";

const TACTICIAN_SYSTEM_PROMPT = `あなたはMinecraftの戦術エージェントです。
目標を達成するために、どのスキルをアクティブにするか判断してください。

## ルール
- 同時にアクティブにするスキルは最大3個
- 依存関係を考慮（例: miningには適切なツールが必要 → craftingが先）
- 中断条件を明確に設定
- planはExecutor（実行エンジン）への具体的な指示として書く

## 出力形式
以下のJSONのみ返してください（説明テキスト不要）:
{
  "activate": ["skill1", "skill2"],
  "deactivate": ["skill3"],
  "plan": "実行エンジンへの具体的な指示",
  "abortConditions": ["中断条件1", "中断条件2"]
}`;

/**
 * Build context for the tactician.
 */
function buildTacticianPrompt(
  goal: Goal,
  state: WorldState,
  activeSkills: Set<string>,
  skillSummary: string,
): string {
  const timePhase =
    state.time < 12000 ? "昼" :
    state.time < 13000 ? "夕暮れ" :
    state.time < 23000 ? "夜" : "夜明け前";

  const topItems = state.inventory.slice(0, 15).map((i) => `${i.name}x${i.count}`).join(", ");

  return `## 現在の目標
${goal.description} (優先度: ${goal.priority})
達成条件: ${goal.successCriteria}
必要スキル: ${goal.requiredSkills.join(", ")}

## 現在の状態
- HP: ${state.health}/20, 空腹: ${state.hunger}/20
- 時刻: ${timePhase}
- 座標: y=${state.position.y.toFixed(0)}
- 装備: ${state.equipment}
- インベントリ: ${topItems || "空"}
- 現在アクティブスキル: ${activeSkills.size > 0 ? Array.from(activeSkills).join(", ") : "なし"}

## 利用可能スキル
${skillSummary}

目標を達成するためのスキル構成と計画を決定してください。`;
}

/**
 * Run the L2 Tactician to select skills.
 */
export async function runTactician(
  client: Anthropic,
  model: string,
  goal: Goal,
  state: WorldState,
  activeSkills: Set<string>,
  skillRegistry: SkillRegistry,
): Promise<TacticalPlan> {
  const prompt = buildTacticianPrompt(
    goal,
    state,
    activeSkills,
    skillRegistry.getSummary(),
  );

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: TACTICIAN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("[Tactician] No text response");
      return getDefaultPlan(goal);
    }

    // Parse JSON
    let jsonStr = textBlock.text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const plan: TacticalPlan = JSON.parse(jsonStr);

    // Validate skill names
    const allSkills = skillRegistry.getAll().map((s) => s.name);
    plan.activate = plan.activate.filter((s) => allSkills.includes(s));
    plan.deactivate = plan.deactivate.filter((s) => allSkills.includes(s));

    console.log(`[Tactician] Plan: activate=[${plan.activate}], deactivate=[${plan.deactivate}]`);
    console.log(`[Tactician] ${plan.plan}`);

    return plan;
  } catch (error) {
    console.error("[Tactician] Error:", error);
    return getDefaultPlan(goal);
  }
}

/**
 * Fallback plan when tactician fails.
 */
function getDefaultPlan(goal: Goal): TacticalPlan {
  return {
    activate: goal.requiredSkills.slice(0, 2),
    deactivate: [],
    plan: goal.description,
    abortConditions: ["HP5以下", "死亡"],
  };
}

/**
 * Apply skill changes from tactical plan to active skills set.
 */
export function applySkillChanges(
  plan: TacticalPlan,
  activeSkills: Set<string>,
): void {
  for (const skill of plan.deactivate) {
    activeSkills.delete(skill);
  }
  for (const skill of plan.activate) {
    activeSkills.add(skill);
  }
}
