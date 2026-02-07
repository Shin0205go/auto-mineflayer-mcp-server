/**
 * L3 Planner
 *
 * Generates prioritized goal list from world state.
 * Uses Sonnet model with no tools — pure reasoning.
 * Called infrequently (on goal completion or timeout).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { WorldState, Goal } from "./types.js";

const PLANNER_SYSTEM_PROMPT = `あなたはMinecraftの自律エージェントのプランナーです。
世界の現在状態を分析し、優先度付きの目標リストをJSON形式で返してください。

## 優先度の指針（数値が高いほど優先）
1. 生存（HP・空腹が危険域）: 90-100
2. 安全確保（シェルター・装備）: 70-89
3. 資源蓄積（ツール強化・食料備蓄）: 50-69
4. 発展（建築・農業・自動化）: 30-49
5. 探索（ネザー・エンド・新バイオーム）: 10-29

## 判断のルール
- 今すぐ必要なものを最優先
- 既に持っているものは目標にしない
- 前提条件が満たされていない目標は低優先度に
- 実現可能な具体的な目標を設定（「ダイヤを探す」ではなく「鉄のツルハシを作ってY=-59でダイヤを採掘」）
- 最大5個の目標を返す

## 利用可能スキル
survival, combat, mining, woodcutting, crafting, building, shelter, exploration, farming, smelting

## 出力形式
以下のJSON配列のみ返してください（説明テキスト不要）:
[
  {
    "id": "goal_1",
    "description": "目標の説明",
    "priority": 80,
    "preconditions": ["前提条件1"],
    "requiredSkills": ["skill1", "skill2"],
    "successCriteria": "達成条件"
  }
]`;

/**
 * Build a concise world state summary for the planner.
 */
function buildWorldSummary(state: WorldState): string {
  const timePhase =
    state.time < 6000 ? "早朝" :
    state.time < 12000 ? "昼" :
    state.time < 13000 ? "夕暮れ" :
    state.time < 23000 ? "夜" : "夜明け前";

  const threats = state.nearbyThreats.length > 0
    ? state.nearbyThreats.map((t) => `${t.name}(${t.distance.toFixed(0)}m)`).join(", ")
    : "なし";

  const topItems = state.inventory.slice(0, 20).map((i) => `${i.name}x${i.count}`).join(", ");

  return `## 現在の状態
- 時刻: ${timePhase} (tick: ${state.time})
- HP: ${state.health}/20, 空腹: ${state.hunger}/20
- 座標: x=${state.position.x.toFixed(0)}, y=${state.position.y.toFixed(0)}, z=${state.position.z.toFixed(0)}
- バイオーム: ${state.biome}
- シェルター: ${state.shelterExists ? "あり" : "なし"}
- 脅威: ${threats}
- 装備: ${state.equipment}
- インベントリ(${state.inventory.length}種): ${topItems || "空"}

## 周囲
${state.rawSurroundings}`;
}

/**
 * Run the L3 Planner to generate goals.
 */
export async function runPlanner(
  client: Anthropic,
  model: string,
  state: WorldState,
): Promise<Goal[]> {
  const summary = buildWorldSummary(state);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: summary }],
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("[Planner] No text response");
      return getDefaultGoals(state);
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = textBlock.text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const goals: Goal[] = JSON.parse(jsonStr);

    // Sort by priority (highest first)
    goals.sort((a, b) => b.priority - a.priority);

    console.log(`[Planner] Generated ${goals.length} goals:`);
    for (const g of goals) {
      console.log(`  [${g.priority}] ${g.description}`);
    }

    return goals;
  } catch (error) {
    console.error("[Planner] Error:", error);
    return getDefaultGoals(state);
  }
}

/**
 * Fallback goals when planner fails.
 */
function getDefaultGoals(state: WorldState): Goal[] {
  const goals: Goal[] = [];

  if (state.health < 10) {
    goals.push({
      id: "default_heal",
      description: "HPを回復する",
      priority: 90,
      preconditions: [],
      requiredSkills: ["survival"],
      successCriteria: "HP15以上",
    });
  }

  if (state.hunger < 10) {
    goals.push({
      id: "default_eat",
      description: "食料を確保して食べる",
      priority: 80,
      preconditions: [],
      requiredSkills: ["survival"],
      successCriteria: "空腹度15以上",
    });
  }

  const hasWoodTools = state.inventory.some((i) =>
    /wooden_|oak_|planks/.test(i.name),
  );
  if (!hasWoodTools) {
    goals.push({
      id: "default_wood",
      description: "木を伐採して基本ツールを作成",
      priority: 70,
      preconditions: [],
      requiredSkills: ["woodcutting", "crafting"],
      successCriteria: "木のツルハシと斧を所持",
    });
  }

  if (goals.length === 0) {
    goals.push({
      id: "default_explore",
      description: "周囲を探索して資源を収集",
      priority: 50,
      preconditions: [],
      requiredSkills: ["exploration", "mining"],
      successCriteria: "新しい資源を発見",
    });
  }

  return goals;
}
