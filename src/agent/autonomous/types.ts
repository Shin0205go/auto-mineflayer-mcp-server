/**
 * Type definitions for the 3-layer autonomous agent architecture.
 *
 * L3 Planner  → generates goals
 * L2 Tactician → selects skills
 * L1 Executor  → executes tool calls
 */

// --- World State ---

export interface WorldState {
  time: number;           // game ticks (0-24000)
  health: number;         // 0-20
  hunger: number;         // 0-20
  position: Position;
  inventory: InventoryItem[];
  nearbyThreats: NearbyEntity[];
  nearbyEntities: NearbyEntity[];
  shelterExists: boolean;
  equipment: string;
  biome: string;
  achievements: string[];

  // Raw tool output for LLM consumption
  rawStatus: string;
  rawSurroundings: string;
  rawInventory: string;
  rawEntities: string;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface InventoryItem {
  name: string;
  count: number;
}

export interface NearbyEntity {
  name: string;
  type: "hostile" | "passive" | "player" | "unknown";
  distance: number;
}

// --- L3 Planner ---

export interface Goal {
  id: string;
  description: string;
  priority: number;       // 0-100
  preconditions: string[];
  requiredSkills: string[];
  successCriteria: string;
}

// --- L2 Tactician ---

export interface TacticalPlan {
  activate: string[];
  deactivate: string[];
  plan: string;
  abortConditions: string[];
}

// --- Interrupt ---

export interface Interrupt {
  type: string;
  requiredSkill: string;
  emergencyPlan: TacticalPlan;
  emergencyGoal: Goal;
}

// --- Skill ---

export interface SkillDefinition {
  name: string;
  description: string;
  context: string;        // detailed guidance for executor
  toolNames: string[];    // MCP tool names this skill uses
}

// --- MCP / Anthropic Tool ---

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// --- Executor Result ---

export interface ExecutorResult {
  action: string;         // what was done
  toolName?: string;      // tool that was called
  toolResult?: string;    // result of the tool call
  aborted: boolean;       // whether an abort condition was triggered
  abortReason?: string;
  completed: boolean;     // whether the executor thinks the plan is done
}

// --- Agent Config ---

export interface AutonomousAgentConfig {
  mcHost: string;
  mcPort: number;
  botUsername: string;
  mcpWsUrl: string;
  startMcpServer: boolean;
  plannerModel: string;
  tacticianModel: string;
  executorModel: string;
  plannerIntervalTicks: number;  // re-plan every N ticks
  observeIntervalTicks: number;  // full observe every N ticks
  tickDelayMs: number;           // delay between executor ticks
}
