import type { Bot } from "mineflayer";

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
}

export interface BlockInfo {
  name: string;
  position: { x: number; y: number; z: number };
}

export type ThinkingState =
  | "idle"
  | "processing"
  | "searching"
  | "executing"
  | "error";

export interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

export interface GameEvent {
  type: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface SafetyState {
  autoEatActive: boolean;
  creeperFleeActive: boolean;
  generalFleeActive: boolean;
  emergencyDodgeActive: boolean;
  autoSleepActive: boolean;
  lastAction: string | null;
  lastActionTime: number;
  // Periodic scan cache (updated every 10 seconds)
  nearbyOres: Array<{ name: string; pos: { x: number; y: number; z: number } }>;
  nearbyWater: Array<{ x: number; y: number; z: number }>;
  nearbyChests: Array<{ x: number; y: number; z: number }>;
  lastScanTime: number;  // Date.now()
}

export interface ManagedBot {
  bot: Bot;
  username: string;
  config: BotConfig;
  chatMessages: ChatMessage[];
  gameEvents: GameEvent[];
  thinkingState: ThinkingState;
  particleInterval: NodeJS.Timeout | null;
  serverHasItemPickupDisabled?: boolean;  // Track if server blocks item pickup
  serverHasItemPickupDisabledTimestamp?: number;  // Timestamp when flag was set (ms since epoch)
  mcExecuteActive?: boolean;  // True while mc_execute is running code — background flee handlers should not override pathfinder
  safetyState?: SafetyState;  // AutoSafety state — readable by agent code via sandbox
}
