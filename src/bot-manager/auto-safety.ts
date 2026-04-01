/**
 * AutoSafety — Deterministic safety layer for bot survival.
 *
 * Runs on a 2-second setInterval + physicsTick handler.
 * Handles auto-eat, creeper flee, general enemy flee, emergency dodge, and auto-sleep.
 * Pathfinder-based actions only run when mcExecuteActive=false (idle).
 * Raw control actions (eat, sprint-back) run even during mc_execute.
 */

import type { Bot } from "mineflayer";
import type { ManagedBot } from "./types.js";
import type { SafetyState } from "./types.js";
import { isHostileMob, EDIBLE_FOOD_NAMES, isBedBlock } from "./minecraft-utils.js";
import { safeSetGoal } from "./pathfinder-safety.js";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;

export class AutoSafety {
  private managed: ManagedBot;
  private bot: Bot;
  private interval: NodeJS.Timeout | null = null;
  private scanInterval: NodeJS.Timeout | null = null;
  private state: SafetyState;

  // Internal flags
  private autoEatActive = false;
  private creeperFleeActive = false;
  private creeperFleeLastEndTime = 0;
  private generalFleeActive = false;
  private emergencyDodgeActive = false;
  private autoSleepActive = false;
  private physicsTick: (() => void) | null = null;

  constructor(managed: ManagedBot) {
    this.managed = managed;
    this.bot = managed.bot;
    this.state = {
      autoEatActive: false,
      creeperFleeActive: false,
      generalFleeActive: false,
      emergencyDodgeActive: false,
      autoSleepActive: false,
      lastAction: null,
      lastActionTime: 0,
      nearbyOres: [],
      nearbyWater: [],
      nearbyChests: [],
      lastScanTime: 0,
    };
    managed.safetyState = this.state;
  }

  start(): void {
    // 2-second interval for auto-eat, general flee, auto-sleep
    this.interval = setInterval(() => this.tick(), 2000);

    // physicsTick for creeper detection (needs fast response ~50ms)
    this.physicsTick = () => this.onPhysicsTick();
    this.bot.on("physicsTick", this.physicsTick);

    // 10-second interval for periodic block scan (ores, water, chests)
    this.scanInterval = setInterval(() => {
      this.runPeriodicScan().catch(() => {});
    }, 10000);
    // Run once immediately on start
    this.runPeriodicScan().catch(() => {});

    console.error(`[AutoSafety] Started for ${this.managed.username}`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.physicsTick) {
      this.bot.removeListener("physicsTick", this.physicsTick);
      this.physicsTick = null;
    }
    this.managed.safetyState = undefined;
    console.error(`[AutoSafety] Stopped for ${this.managed.username}`);
  }

  // ==================== 2-second interval tick ====================

  private tick(): void {
    try {
      // Priority order: emergency eat > auto-eat > general flee > auto-sleep
      if (this.tryEmergencyEat()) return;
      if (this.tryAutoEat()) return;
      if (this.tryGeneralFlee()) return;
      if (this.tryAutoSleep()) return;
    } catch (err) {
      console.error(`[AutoSafety] tick error:`, err);
    }
  }

  // ==================== Auto-eat (food <= 6) ====================

  private tryAutoEat(): boolean {
    if (this.autoEatActive) return false;
    if (this.bot.food > 6) return false;
    return this.doEat("auto-eat");
  }

  // ==================== Emergency eat (HP < 6 + has food) ====================

  private tryEmergencyEat(): boolean {
    if (this.autoEatActive) return false;
    if (this.bot.health >= 6) return false;
    return this.doEat("emergency-eat");
  }

  private doEat(reason: string): boolean {
    const food = this.bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
    if (!food) return false;

    this.autoEatActive = true;
    this.updateState(reason, true, "autoEatActive");

    console.error(`[AutoSafety] ${reason}: HP=${this.bot.health.toFixed(1)}, food=${this.bot.food}, eating ${food.name}`);

    // Async eat sequence — fire-and-forget with cleanup
    (async () => {
      try {
        await this.bot.equip(food, "hand");
        this.bot.activateItem(false);

        // Wait for food change or timeout
        await new Promise<void>(resolve => {
          const onHealth = () => {
            this.bot.removeListener("health" as any, onHealth);
            resolve();
          };
          this.bot.on("health" as any, onHealth);
          setTimeout(() => {
            this.bot.removeListener("health" as any, onHealth);
            resolve();
          }, 3500);
        });

        this.bot.deactivateItem();
        console.error(`[AutoSafety] ${reason} done: HP=${this.bot.health.toFixed(1)}, food=${this.bot.food}`);
      } catch (err) {
        console.error(`[AutoSafety] ${reason} failed:`, err);
      } finally {
        this.autoEatActive = false;
        this.updateState(reason, false, "autoEatActive");
      }
    })();

    return true;
  }

  // ==================== Creeper emergency flee (physicsTick) ====================

  private onPhysicsTick(): void {
    // Emergency dodge runs on every tick regardless of creeper state (HP < 4 = immediate danger)
    this.tryEmergencyDodge();

    if (this.creeperFleeActive || this.generalFleeActive) return;
    if (Date.now() - this.creeperFleeLastEndTime < 500) return;

    // Find creeper within 7 blocks
    const creeper = Object.values(this.bot.entities).find(
      e => e !== this.bot.entity && e.name?.toLowerCase() === "creeper" &&
        e.position?.distanceTo(this.bot.entity.position) < 7
    );
    if (!creeper || !creeper.position) return;

    // Suppress near portals (same logic as old CreeperFlee)
    if (this.isNearPortal()) return;

    const dist = creeper.position.distanceTo(this.bot.entity.position);
    const dir = this.bot.entity.position.minus(creeper.position).normalize();
    console.error(`[AutoSafety] Creeper ${dist.toFixed(1)} blocks away! Sprint-fleeing.`);

    this.creeperFleeActive = true;
    this.updateState("creeper-flee", true, "creeperFleeActive");

    // Raw control: look away and sprint (works during mc_execute)
    const lookAngle = Math.atan2(-dir.x, -dir.z);
    this.bot.look(lookAngle, 0, true);
    this.bot.setControlState("sprint", true);
    this.bot.setControlState("forward", true);

    // If idle, also use pathfinder for smarter routing
    let goalHandle: ReturnType<typeof safeSetGoal> | null = null;
    if (!this.managed.mcExecuteActive) {
      try {
        const fleeTarget = this.bot.entity.position.plus(dir.scaled(12));
        fleeTarget.y = this.bot.entity.position.y;
        if (this.bot.pathfinder.movements) {
          this.bot.pathfinder.movements.canDig = false;
          this.bot.pathfinder.movements.maxDropDown = 2;
        }
        if (!this.bot.pathfinder.goal) {
          goalHandle = safeSetGoal(this.bot,
            new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3),
            { onAbort: (yDescent) => {
              console.error(`[AutoSafety] Creeper flee Y-descent abort: ${yDescent.toFixed(1)} blocks`);
            }}
          );
        }
      } catch { /* ignore pathfinder errors */ }
    }

    // Stop after 2 seconds, or immediately if mc_execute starts (to avoid goal conflict)
    const creeperCleanup = () => {
      clearInterval(creeperActiveCheck);
      clearTimeout(creeperTimeout);
      if (goalHandle) goalHandle.cleanup();
      this.bot.setControlState("sprint", false);
      this.bot.setControlState("forward", false);
      this.creeperFleeActive = false;
      this.creeperFleeLastEndTime = Date.now();
      this.updateState("creeper-flee", false, "creeperFleeActive");
    };
    const creeperTimeout = setTimeout(creeperCleanup, 2000);
    const creeperActiveCheck = setInterval(() => {
      if (this.managed.mcExecuteActive) {
        console.error(`[AutoSafety] Creeper flee pathfinder aborted: mc_execute became active`);
        creeperCleanup();
      }
    }, 200);
  }

  // ==================== General enemy flee (idle only, HP < 10) ====================

  private tryGeneralFlee(): boolean {
    if (this.managed.mcExecuteActive) return false;
    if (this.bot.health >= 10) return false;
    if (this.creeperFleeActive || this.generalFleeActive || this.emergencyDodgeActive) return false;

    // Don't override an active pathfinder goal (agent may be mid-navigate)
    if (this.bot.pathfinder?.goal) return false;

    // Find nearest hostile within 8 blocks
    const hostile = this.findNearestHostile(8);
    if (!hostile) return false;

    console.error(`[AutoSafety] General flee: HP=${this.bot.health.toFixed(1)}, ${hostile.name} at ${hostile.distance.toFixed(1)} blocks`);
    this.generalFleeActive = true;
    this.updateState("general-flee", true, "generalFleeActive");

    try {
      const dir = this.bot.entity.position.minus(hostile.entity.position).normalize();
      const fleeTarget = this.bot.entity.position.plus(dir.scaled(16));
      fleeTarget.y = this.bot.entity.position.y;

      if (this.bot.pathfinder.movements) {
        this.bot.pathfinder.movements.canDig = false;
        this.bot.pathfinder.movements.maxDropDown = 2;
      }

      const goalHandle = safeSetGoal(this.bot,
        new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3),
        { elevationAware: true,
          onAbort: (yDescent) => {
            console.error(`[AutoSafety] General flee Y-descent abort: ${yDescent.toFixed(1)} blocks`);
          }
        }
      );

      // Cleanup after 5 seconds, or immediately if mc_execute starts
      const fleeCleanup = () => {
        clearInterval(fleeActiveCheck);
        clearTimeout(fleeTimeout);
        goalHandle.cleanup();
        this.generalFleeActive = false;
        this.updateState("general-flee", false, "generalFleeActive");
      };
      const fleeTimeout = setTimeout(fleeCleanup, 5000);
      const fleeActiveCheck = setInterval(() => {
        if (this.managed.mcExecuteActive) {
          console.error(`[AutoSafety] General flee aborted: mc_execute became active`);
          fleeCleanup();
        }
      }, 200);
    } catch (err) {
      console.error(`[AutoSafety] General flee error:`, err);
      this.generalFleeActive = false;
      this.updateState("general-flee", false, "generalFleeActive");
    }

    return true;
  }

  // ==================== Emergency dodge (HP < 4, raw control) ====================
  // This is checked in the physicsTick alongside creeper detection for fast response

  private tryEmergencyDodge(): boolean {
    if (this.emergencyDodgeActive) return false;
    if (this.bot.health >= 4) return false;

    // Find hostile within 5 blocks
    const hostile = this.findNearestHostile(5);
    if (!hostile) return false;

    console.error(`[AutoSafety] EMERGENCY DODGE: HP=${this.bot.health.toFixed(1)}, ${hostile.name} at ${hostile.distance.toFixed(1)} blocks`);
    this.emergencyDodgeActive = true;
    this.updateState("emergency-dodge", true, "emergencyDodgeActive");

    // Raw control: back + jump + sprint (works during mc_execute)
    this.bot.setControlState("back", true);
    this.bot.setControlState("jump", true);
    this.bot.setControlState("sprint", true);

    setTimeout(() => {
      this.bot.setControlState("back", false);
      this.bot.setControlState("jump", false);
      this.bot.setControlState("sprint", false);
      this.emergencyDodgeActive = false;
      this.updateState("emergency-dodge", false, "emergencyDodgeActive");
    }, 2000);

    return true;
  }

  // ==================== Auto-sleep (idle, night) ====================
  // Priority: placed bed nearby → use it
  // Fallback: bed item in inventory → place at feet, sleep, pick up after waking

  private tryAutoSleep(): boolean {
    if (this.managed.mcExecuteActive) return false;
    if (this.autoSleepActive) return false;

    // Check if nighttime (12541+ ticks)
    const timeOfDay = this.bot.time?.timeOfDay;
    if (timeOfDay === undefined || timeOfDay < 12541) return false;

    // Check no hostiles nearby
    if (this.findNearestHostile(16)) return false;

    // Option A: find already-placed bed within 32 blocks
    const bedBlock = this.bot.findBlock({
      matching: (block: any) => isBedBlock(block.name),
      maxDistance: 32,
    });

    // Option B: bed item in inventory (will place it ourselves)
    const bedItem = !bedBlock
      ? this.bot.inventory.items().find((i: any) => isBedBlock(i.name))
      : null;

    if (!bedBlock && !bedItem) return false;

    this.autoSleepActive = true;
    this.updateState("auto-sleep", true, "autoSleepActive");

    (async () => {
      let placedBedPos: any = null;
      try {
        if (bedBlock) {
          // === Option A: navigate to existing bed ===
          // Guard: abort if mc_execute started before navigation begins
          if (this.managed.mcExecuteActive) { console.error(`[AutoSafety] Auto-sleep aborted before navigate: mc_execute active`); return; }
          console.error(`[AutoSafety] Auto-sleep: navigating to bed at (${bedBlock.position.x},${bedBlock.position.y},${bedBlock.position.z})`);
          await this.navigateTo(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2, 10000);
          if (this.managed.mcExecuteActive) { console.error(`[AutoSafety] Auto-sleep aborted: mc_execute started`); return; }
          await this.bot.sleep(bedBlock);
        } else if (bedItem) {
          // === Option B: place bed at feet, sleep, then dig it up ===
          console.error(`[AutoSafety] Auto-sleep: placing bed from inventory (${bedItem.name})`);
          await this.bot.equip(bedItem, "hand");

          // Find a flat solid block at foot level to place on
          const pos = this.bot.entity.position.floored();
          const groundBlock = this.bot.blockAt(pos.offset(0, -1, 0));
          if (!groundBlock || groundBlock.name === "air") {
            console.error(`[AutoSafety] Auto-sleep: no ground to place bed on`);
            return;
          }

          // Place bed on top of ground block using raw packet (avoids 5s blockUpdate timeout)
          const placePos = pos; // place at feet level
          const syncPromise = new Promise<void>(resolve => {
            const handler = (_o: any, n: any) => {
              if (n.position.equals(placePos) && isBedBlock(n.name)) {
                this.bot.removeListener("blockUpdate", handler);
                resolve();
              }
            };
            this.bot.on("blockUpdate", handler);
            setTimeout(() => { this.bot.removeListener("blockUpdate", handler); resolve(); }, 1000);
          });
          (this.bot as any)._client.write("block_place", {
            location: { x: groundBlock.position.x, y: groundBlock.position.y, z: groundBlock.position.z },
            direction: 1, hand: 0,
            cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false,
          });
          await syncPromise;

          // Re-fetch placed bed block
          const placedBed = this.bot.blockAt(placePos);
          if (!placedBed || !isBedBlock(placedBed.name)) {
            console.error(`[AutoSafety] Auto-sleep: bed placement failed`);
            return;
          }
          placedBedPos = placePos;
          console.error(`[AutoSafety] Auto-sleep: bed placed at (${placePos.x},${placePos.y},${placePos.z}), sleeping`);

          if (this.managed.mcExecuteActive) { console.error(`[AutoSafety] Auto-sleep aborted: mc_execute started`); return; }
          await this.bot.sleep(placedBed);
        }

        console.error(`[AutoSafety] Auto-sleep: sleeping`);

        // Wait for wake event (day comes or all players sleep)
        await new Promise<void>(resolve => {
          const onWake = () => { this.bot.removeListener("wake", onWake); resolve(); };
          this.bot.on("wake", onWake);
          setTimeout(() => { this.bot.removeListener("wake", onWake); resolve(); }, 15000);
        });
        console.error(`[AutoSafety] Auto-sleep: woke up`);

        // Pick up placed bed after waking
        if (placedBedPos) {
          try {
            const bedToBreak = this.bot.blockAt(placedBedPos);
            if (bedToBreak && isBedBlock(bedToBreak.name)) {
              await this.bot.dig(bedToBreak);
              console.error(`[AutoSafety] Auto-sleep: bed picked up`);
            }
          } catch (err) {
            console.error(`[AutoSafety] Auto-sleep: failed to pick up bed:`, err);
          }
        }
      } catch (err) {
        console.error(`[AutoSafety] Auto-sleep failed:`, err);
      } finally {
        this.autoSleepActive = false;
        this.updateState("auto-sleep", false, "autoSleepActive");
      }
    })();

    return true;
  }

  /** Navigate to (x,y,z) within tolerance, waiting up to maxWaitMs.
   * Aborts early if mcExecuteActive becomes true to avoid goal conflict with pathfinderGoto(). */
  private async navigateTo(x: number, y: number, z: number, tolerance: number, maxWaitMs: number): Promise<void> {
    const goalHandle = safeSetGoal(this.bot,
      new goals.GoalNear(x, y, z, tolerance),
      { elevationAware: true }
    );
    await new Promise<void>(resolve => {
      const onReached = () => {
        clearInterval(mcExecuteCheck);
        this.bot.removeListener("goal_reached", onReached);
        resolve();
      };
      this.bot.on("goal_reached", onReached);
      const timeoutId = setTimeout(() => {
        clearInterval(mcExecuteCheck);
        this.bot.removeListener("goal_reached", onReached);
        resolve();
      }, maxWaitMs);
      // Poll for mc_execute starting — abort immediately to avoid goal conflict
      const mcExecuteCheck = setInterval(() => {
        if (this.managed.mcExecuteActive) {
          clearInterval(mcExecuteCheck);
          clearTimeout(timeoutId);
          this.bot.removeListener("goal_reached", onReached);
          console.error(`[AutoSafety] navigateTo aborted: mc_execute became active`);
          resolve();
        }
      }, 200);
    });
    goalHandle.cleanup();
  }

  // ==================== Periodic block scan (10-second interval) ====================

  private async runPeriodicScan(): Promise<void> {
    const oreNames = [
      'iron_ore', 'deepslate_iron_ore',
      'gold_ore', 'deepslate_gold_ore',
      'diamond_ore', 'deepslate_diamond_ore',
      'coal_ore', 'deepslate_coal_ore',
      'copper_ore', 'deepslate_copper_ore',
    ];

    // Search for each ore type — max 1 result per type within 32 blocks
    const ores: SafetyState['nearbyOres'] = [];
    for (const oreName of oreNames) {
      const blockDef = (this.bot.registry as any).blocksByName[oreName];
      if (!blockDef) continue;
      const found = this.bot.findBlock({ matching: blockDef.id, maxDistance: 32 });
      if (found) ores.push({ name: oreName, pos: found.position });
    }

    // Nearest water source within 32 blocks
    const waterDef = (this.bot.registry as any).blocksByName['water'];
    const waterBlock = waterDef
      ? this.bot.findBlock({ matching: waterDef.id, maxDistance: 32 })
      : null;

    // Nearest chest within 32 blocks
    const chestDef = (this.bot.registry as any).blocksByName['chest'];
    const chestBlock = chestDef
      ? this.bot.findBlock({ matching: chestDef.id, maxDistance: 32 })
      : null;

    this.state.nearbyOres = ores;
    this.state.nearbyWater = waterBlock ? [waterBlock.position] : [];
    this.state.nearbyChests = chestBlock ? [chestBlock.position] : [];
    this.state.lastScanTime = Date.now();
  }

  // ==================== Helpers ====================

  private findNearestHostile(radius: number): { name: string; distance: number; entity: any } | null {
    let nearest: { name: string; distance: number; entity: any } | null = null;
    for (const entity of Object.values(this.bot.entities)) {
      if (entity === this.bot.entity) continue;
      if (!entity.name || !entity.position) continue;
      if (!isHostileMob(this.bot, entity.name.toLowerCase())) continue;
      const dist = entity.position.distanceTo(this.bot.entity.position);
      if (dist > radius) continue;
      if (!nearest || dist < nearest.distance) {
        nearest = { name: entity.name, distance: dist, entity };
      }
    }
    return nearest;
  }

  private isNearPortal(): boolean {
    const pos = this.bot.entity.position.floored();
    const feetBlock = this.bot.blockAt(pos);
    const headBlock = this.bot.blockAt(pos.offset(0, 1, 0));
    if (feetBlock?.name === "nether_portal" || feetBlock?.name === "end_portal" ||
        headBlock?.name === "nether_portal" || headBlock?.name === "end_portal") {
      console.error(`[AutoSafety] Creeper flee suppressed: inside portal`);
      return true;
    }
    // Check 6-block radius for nearby portals
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -6; dz <= 6; dz++) {
          const nb = this.bot.blockAt(pos.offset(dx, dy, dz));
          if (nb?.name === "nether_portal" || nb?.name === "end_portal") {
            console.error(`[AutoSafety] Creeper flee suppressed: near portal`);
            return true;
          }
        }
      }
    }
    return false;
  }

  private updateState(action: string, active: boolean, flag: keyof SafetyState): void {
    this.state[flag] = active as never;
    if (active) {
      this.state.lastAction = action;
      this.state.lastActionTime = Date.now();
    }
  }
}
