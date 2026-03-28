/**
 * Generic plan validator - phase-based action whitelist
 *
 * Validates that an agent's proposed action is permitted
 * given the current phase/step of a plan.
 *
 * Generic: works for Minecraft phases, SIer project phases, etc.
 * Only the plan JSON changes; this validator logic is reused.
 *
 * Usage:
 *   const plan = loadPlan("plans/minecraft-phases.json");
 *   const step = getStep(plan, currentPhase);
 *   const result = validate(code, step);
 *   if (!result.allowed) return 403;
 */

export interface PlanStep {
  id: number | string;
  name: string;
  goal?: string;
  /** Substring patterns (case-insensitive) that are NOT allowed in this phase */
  forbidden?: string[];
}

export interface Plan {
  name: string;
  description?: string;
  steps: PlanStep[];
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  step: PlanStep;
}

export function getStep(plan: Plan, stepId: number | string): PlanStep | null {
  return plan.steps.find((s) => String(s.id) === String(stepId)) ?? null;
}

export function validate(action: string, step: PlanStep): ValidationResult {
  const lower = action.toLowerCase();
  for (const pattern of step.forbidden ?? []) {
    if (lower.includes(pattern.toLowerCase())) {
      return {
        allowed: false,
        reason: `[Phase ${step.id}: ${step.name}] prohibits "${pattern}" — this belongs to a later phase`,
        step,
      };
    }
  }
  return { allowed: true, step };
}
