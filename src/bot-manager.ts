import mineflayer, { Bot } from "mineflayer";
import { Vec3 } from "vec3";

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

export class BotManager {
  private bot: Bot | null = null;
  private currentThinkingState: ThinkingState = "idle";
  private particleInterval: NodeJS.Timeout | null = null;

  isConnected(): boolean {
    return this.bot !== null;
  }

  getBot(): Bot | null {
    return this.bot;
  }

  async connect(config: BotConfig): Promise<void> {
    if (this.bot) {
      throw new Error("Already connected to a server");
    }

    return new Promise((resolve, reject) => {
      this.bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version,
      });

      this.bot.once("spawn", () => {
        resolve();
      });

      this.bot.once("error", (err) => {
        this.bot = null;
        reject(err);
      });

      this.bot.once("kicked", (reason) => {
        this.bot = null;
        reject(new Error(`Kicked: ${reason}`));
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    this.stopParticleLoop();
    this.bot.quit();
    this.bot = null;
  }

  getPosition(): { x: number; y: number; z: number } | null {
    if (!this.bot) return null;
    const pos = this.bot.entity.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  async moveTo(x: number, y: number, z: number): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    const goal = new Vec3(x, y, z);
    const start = this.bot.entity.position;
    const distance = start.distanceTo(goal);

    // Simple movement without pathfinder
    // For short distances, just walk towards the goal
    if (distance < 100) {
      await this.bot.lookAt(goal);
      this.bot.setControlState("forward", true);

      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.bot) {
            clearInterval(checkInterval);
            resolve();
            return;
          }

          const currentPos = this.bot.entity.position;
          const currentDist = currentPos.distanceTo(goal);

          if (currentDist < 2) {
            this.bot.setControlState("forward", false);
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.bot) {
            this.bot.setControlState("forward", false);
          }
          clearInterval(checkInterval);
          resolve();
        }, 30000);
      });
    }

    throw new Error("Distance too far for simple movement. Pathfinder not implemented.");
  }

  async chat(message: string): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }
    this.bot.chat(message);
  }

  async lookAround(radius: number = 5): Promise<BlockInfo[]> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    const blocks: BlockInfo[] = [];
    const pos = this.bot.entity.position;

    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        for (let z = -radius; z <= radius; z++) {
          const blockPos = pos.offset(x, y, z);
          const block = this.bot.blockAt(blockPos);
          if (block && block.name !== "air") {
            blocks.push({
              name: block.name,
              position: {
                x: Math.floor(blockPos.x),
                y: Math.floor(blockPos.y),
                z: Math.floor(blockPos.z),
              },
            });
          }
        }
      }
    }

    return blocks;
  }

  async visualizeThinking(state: ThinkingState, message?: string): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    this.currentThinkingState = state;

    // Stop existing particle loop
    this.stopParticleLoop();

    // Start new particle loop
    this.startParticleLoop();

    // Optional: display message in chat
    if (message) {
      this.bot.chat(`[${state}] ${message}`);
    }
  }

  private startParticleLoop(): void {
    if (!this.bot) return;

    this.particleInterval = setInterval(() => {
      this.emitThinkingParticle();
    }, 500);
  }

  private stopParticleLoop(): void {
    if (this.particleInterval) {
      clearInterval(this.particleInterval);
      this.particleInterval = null;
    }
  }

  private async emitThinkingParticle(): Promise<void> {
    if (!this.bot) return;

    const pos = this.bot.entity.position;
    const x = pos.x;
    const y = pos.y + 2.5; // Above the bot's head
    const z = pos.z;

    let particleCommand: string;

    switch (this.currentThinkingState) {
      case "idle":
        // Gray dust particles
        particleCommand = `particle dust 0.5 0.5 0.5 1 ${x} ${y} ${z} 0.3 0.3 0.3 0.1 5`;
        break;
      case "processing":
        // Flame particles
        particleCommand = `particle flame ${x} ${y} ${z} 0.2 0.2 0.2 0.02 10`;
        break;
      case "searching":
        // Enchant particles
        particleCommand = `particle enchant ${x} ${y} ${z} 0.5 0.5 0.5 1 20`;
        break;
      case "executing":
        // Green happy villager particles
        particleCommand = `particle happy_villager ${x} ${y} ${z} 0.3 0.3 0.3 0.1 10`;
        break;
      case "error":
        // Red dust particles
        particleCommand = `particle dust 1 0 0 1.5 ${x} ${y} ${z} 0.3 0.3 0.3 0.1 10`;
        break;
      default:
        return;
    }

    this.bot.chat(`/${particleCommand}`);
  }

  async placeBlock(
    blockType: string,
    x: number,
    y: number,
    z: number
  ): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    // Use setblock command (requires operator permissions)
    this.bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${blockType}`);
  }

  async buildStructure(
    structure: "house" | "tower" | "marker",
    x?: number,
    y?: number,
    z?: number
  ): Promise<void> {
    if (!this.bot) {
      throw new Error("Not connected to any server");
    }

    const pos = this.bot.entity.position;
    const baseX = x ?? Math.floor(pos.x) + 3;
    const baseY = y ?? Math.floor(pos.y);
    const baseZ = z ?? Math.floor(pos.z);

    switch (structure) {
      case "house":
        await this.buildHouse(baseX, baseY, baseZ);
        break;
      case "tower":
        await this.buildTower(baseX, baseY, baseZ);
        break;
      case "marker":
        await this.buildMarker(baseX, baseY, baseZ);
        break;
    }
  }

  private async buildHouse(x: number, y: number, z: number): Promise<void> {
    // Simple 5x5x4 house
    const width = 5;
    const depth = 5;
    const height = 4;

    // Floor
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        await this.placeBlock("oak_planks", x + dx, y, z + dz);
      }
    }

    // Walls
    for (let dy = 1; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        await this.placeBlock("oak_planks", x + dx, y + dy, z);
        await this.placeBlock("oak_planks", x + dx, y + dy, z + depth - 1);
      }
      for (let dz = 1; dz < depth - 1; dz++) {
        await this.placeBlock("oak_planks", x, y + dy, z + dz);
        await this.placeBlock("oak_planks", x + width - 1, y + dy, z + dz);
      }
    }

    // Door (remove blocks for entrance)
    await this.placeBlock("air", x + 2, y + 1, z);
    await this.placeBlock("air", x + 2, y + 2, z);

    // Window
    await this.placeBlock("glass", x + 2, y + 2, z + depth - 1);

    // Roof (simple flat roof)
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < depth; dz++) {
        await this.placeBlock("oak_slab", x + dx, y + height, z + dz);
      }
    }
  }

  private async buildTower(x: number, y: number, z: number): Promise<void> {
    const height = 10;

    // Base pillar
    for (let dy = 0; dy < height; dy++) {
      await this.placeBlock("cobblestone", x, y + dy, z);
      await this.placeBlock("cobblestone", x + 1, y + dy, z);
      await this.placeBlock("cobblestone", x, y + dy, z + 1);
      await this.placeBlock("cobblestone", x + 1, y + dy, z + 1);
    }

    // Top platform
    for (let dx = -1; dx <= 2; dx++) {
      for (let dz = -1; dz <= 2; dz++) {
        await this.placeBlock("stone_bricks", x + dx, y + height, z + dz);
      }
    }

    // Torch on top
    await this.placeBlock("torch", x, y + height + 1, z);
  }

  private async buildMarker(x: number, y: number, z: number): Promise<void> {
    // Simple marker pillar with glowstone
    await this.placeBlock("glowstone", x, y, z);
    await this.placeBlock("glowstone", x, y + 1, z);
    await this.placeBlock("glowstone", x, y + 2, z);
    await this.placeBlock("redstone_torch", x, y + 3, z);
  }
}

// Singleton instance
export const botManager = new BotManager();
