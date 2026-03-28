/**
 * Phase state I/O
 *
 * Persists current phase to disk so it survives daemon restarts.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { minecraftPlan } from "./minecraft-phases.js";
import type { Plan } from "./validator.js";

const ROOT = path.join(fileURLToPath(import.meta.url), "../../../");
const STATE_FILE = path.join(ROOT, "state/current-phase.json");

export { minecraftPlan };

export function getCurrentPhase(): number {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return typeof data.phase === "number" ? data.phase : 1;
  } catch {
    return 1;
  }
}

export function setCurrentPhase(phase: number): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ phase, updated: new Date().toISOString() }, null, 2)
  );
}

/** Load a plan from an absolute or project-relative JSON path (optional, override default) */
export function loadPlan(planPath?: string): Plan {
  if (!planPath) return minecraftPlan;
  const absolute = path.isAbsolute(planPath) ? planPath : path.join(ROOT, planPath);
  return JSON.parse(fs.readFileSync(absolute, "utf-8")) as Plan;
}
