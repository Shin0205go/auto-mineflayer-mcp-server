/**
 * Interrupt System (Rule-Based, No LLM)
 *
 * Checks world state every tick and triggers emergency skill switches.
 * Runs without LLM calls for instant response.
 */

import type { WorldState, Interrupt, Goal, TacticalPlan } from "./types.js";

interface InterruptRule {
  type: string;
  priority: number;
  check: (state: WorldState) => boolean;
  requiredSkill: string;
  makeGoal: (state: WorldState) => Goal;
  makePlan: (state: WorldState) => TacticalPlan;
}

const INTERRUPT_RULES: InterruptRule[] = [
  // Critical: Very low HP
  {
    type: "critical_health",
    priority: 100,
    check: (s) => s.health <= 4,
    requiredSkill: "survival",
    makeGoal: (s) => ({
      id: "emergency_heal",
      description: `緊急回復 (HP: ${s.health})`,
      priority: 100,
      preconditions: [],
      requiredSkills: ["survival"],
      successCriteria: "HPが10以上に回復",
    }),
    makePlan: (s) => ({
      activate: ["survival"],
      deactivate: [],
      plan: `緊急! HP=${s.health}。まず食事で回復。食料がなければ逃走して安全確保。`,
      abortConditions: ["死亡"],
    }),
  },

  // High: Hostile mob within 8 blocks
  {
    type: "hostile_nearby",
    priority: 95,
    check: (s) => s.nearbyThreats.some((e) => e.distance < 8),
    requiredSkill: "combat",
    makeGoal: (s) => {
      const closest = s.nearbyThreats.reduce(
        (a, b) => (a.distance < b.distance ? a : b),
        s.nearbyThreats[0],
      );
      return {
        id: "emergency_combat",
        description: `敵対応: ${closest.name} (${closest.distance.toFixed(1)}ブロック)`,
        priority: 95,
        preconditions: [],
        requiredSkills: ["combat"],
        successCriteria: "近くに敵がいない",
      };
    },
    makePlan: (s) => {
      const closest = s.nearbyThreats.reduce(
        (a, b) => (a.distance < b.distance ? a : b),
        s.nearbyThreats[0],
      );
      const action = s.health > 8 ? "武器を装備して攻撃" : "逃走して安全確保";
      return {
        activate: ["combat"],
        deactivate: [],
        plan: `${closest.name}が${closest.distance.toFixed(1)}ブロック先にいる。${action}。`,
        abortConditions: ["HP4以下で逃走に切替"],
      };
    },
  },

  // Medium-high: Night + outdoor + no shelter
  {
    type: "night_no_shelter",
    priority: 90,
    check: (s) => s.time > 13000 && s.time < 23000 && !s.shelterExists,
    requiredSkill: "shelter",
    makeGoal: () => ({
      id: "emergency_shelter",
      description: "夜間の緊急シェルター建設",
      priority: 90,
      preconditions: [],
      requiredSkills: ["shelter"],
      successCriteria: "シェルターが完成して安全",
    }),
    makePlan: () => ({
      activate: ["shelter"],
      deactivate: [],
      plan: "夜間で屋外。地面を3ブロック掘って中に入り上を塞ぐ。松明を設置。",
      abortConditions: ["敵に攻撃された"],
    }),
  },

  // Medium: Low hunger
  {
    type: "low_hunger",
    priority: 70,
    check: (s) => s.hunger <= 6,
    requiredSkill: "survival",
    makeGoal: (s) => ({
      id: "eat_food",
      description: `空腹対応 (Hunger: ${s.hunger})`,
      priority: 70,
      preconditions: [],
      requiredSkills: ["survival"],
      successCriteria: "空腹度が14以上",
    }),
    makePlan: (s) => ({
      activate: ["survival"],
      deactivate: [],
      plan: `空腹度=${s.hunger}。食料を食べる。食料がなければ動物を探して倒す。`,
      abortConditions: ["敵に攻撃された"],
    }),
  },

  // Medium: Inventory full
  {
    type: "inventory_full",
    priority: 50,
    check: (s) => s.inventory.length >= 36,
    requiredSkill: "crafting",
    makeGoal: () => ({
      id: "manage_inventory",
      description: "インベントリ整理（満杯）",
      priority: 50,
      preconditions: [],
      requiredSkills: ["crafting"],
      successCriteria: "インベントリに空きがある",
    }),
    makePlan: () => ({
      activate: ["crafting"],
      deactivate: [],
      plan: "インベントリが満杯。不要アイテムを捨てるか、チェストに格納。素材はクラフトしてまとめる。",
      abortConditions: ["敵に攻撃された"],
    }),
  },
];

/**
 * Check all interrupt rules and return the highest priority triggered interrupt.
 * Returns null if no interrupt is needed.
 */
export function checkInterrupts(state: WorldState): Interrupt | null {
  let highestInterrupt: Interrupt | null = null;
  let highestPriority = -1;

  for (const rule of INTERRUPT_RULES) {
    if (rule.priority > highestPriority && rule.check(state)) {
      highestInterrupt = {
        type: rule.type,
        requiredSkill: rule.requiredSkill,
        emergencyPlan: rule.makePlan(state),
        emergencyGoal: rule.makeGoal(state),
      };
      highestPriority = rule.priority;
    }
  }

  return highestInterrupt;
}
