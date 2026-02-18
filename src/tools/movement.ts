import { botManager } from "../bot-manager/index.js";
import { Vec3 } from "vec3";

export const movementTools = {
  minecraft_get_position: {
    description: "Get the bot's current position in the Minecraft world",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_move_to: {
    description: "Move the bot to a specific position",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "X coordinate",
        },
        y: {
          type: "number",
          description: "Y coordinate",
        },
        z: {
          type: "number",
          description: "Z coordinate",
        },
      },
      required: ["x", "y", "z"],
    },
  },

  minecraft_chat: {
    description: "Send a chat message in the Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Message to send",
        },
      },
      required: ["message"],
    },
  },

  minecraft_enter_portal: {
    description: "Enter a Nether portal to teleport to the Nether or back to Overworld. The bot will find the nearest portal within 10 blocks, move into it, and wait for teleportation.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleMovementTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_position": {
      const pos = botManager.getPosition(username);
      if (!pos) {
        throw new Error("Not connected to any server");
      }
      return JSON.stringify({
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        z: Math.round(pos.z * 100) / 100,
      });
    }

    case "minecraft_move_to": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      // Guard: if target block is a portal but bot is already in that dimension,
      // skip enterPortal() delegation to avoid 30-second timeout.
      // (bot-movement.ts moveTo() delegates to enterPortal() unconditionally)
      {
        const managed = botManager.getBotByUsername(username);
        if (managed) {
          const bot = managed.bot;
          const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
          const targetBlock = bot.blockAt(targetPos);
          const dim = bot.game.dimension as string;
          if (targetBlock?.name === "nether_portal" && dim.includes("nether")) {
            return `Skipped enterPortal(): bot already in nether dimension. Move to an adjacent non-portal coordinate instead.`;
          }
          if (targetBlock?.name === "end_portal" && dim.includes("end")) {
            return `Skipped enterPortal(): bot already in end dimension. Move to an adjacent non-portal coordinate instead.`;
          }
        }
      }

      // For long distances (>50 blocks), move in small segments to handle chunk loading
      // Pathfinder can only navigate within loaded chunks, so small steps allow
      // progressive chunk loading as the bot moves toward the destination.
      const pos = botManager.getPosition(username);
      if (pos) {
        const dx = x - pos.x;
        const dy = y - pos.y;
        const dz = z - pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 50) {
          // Move in 30-block segments for reliable chunk-by-chunk navigation
          // Each segment is computed from the FINAL destination direction,
          // using current position to always move toward goal.
          const segmentSize = 30;
          const steps = Math.ceil(dist / segmentSize);
          let lastResult = "";
          for (let i = 1; i <= steps; i++) {
            // Recompute direction from current position each step
            const curPos = botManager.getPosition(username);
            if (!curPos) break;
            const rdx = x - curPos.x;
            const rdy = y - curPos.y;
            const rdz = z - curPos.z;
            const remainDist = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
            if (remainDist < 3) break; // Already at destination
            const t = Math.min(segmentSize / remainDist, 1.0);
            const ix = curPos.x + rdx * t;
            const iz = curPos.z + rdz * t;
            const iy = remainDist <= segmentSize ? y : (curPos.y + rdy * t);
            const segResult = await botManager.moveTo(username, ix, iy, iz);
            lastResult = segResult;
            // Continue even if segment partially failed — terrain may redirect us
          }
          return lastResult || await botManager.moveTo(username, x, y, z);
        }
      }

      const result = await botManager.moveTo(username, x, y, z);
      return result;
    }

    case "minecraft_chat": {
      const message = args.message as string;
      if (!message) {
        throw new Error("Message is required");
      }

      // Block dangerous commands (tp, teleport, kill, etc.) - except for whitelisted bots
      const whitelistedBots = ["Claude", "Claude1", "Claude2", "Claude3", "Claude4", "Claude5", "Claude6", "Claude7"];

      if (!whitelistedBots.includes(username)) {
        const blockedCommands = ["/tp", "/teleport", "/kill", "/gamemode", "/op", "/deop", "/ban", "/kick"];
        const lowerMessage = message.toLowerCase().trim();
        for (const cmd of blockedCommands) {
          if (lowerMessage.startsWith(cmd + " ") || lowerMessage === cmd) {
            throw new Error(`Command '${cmd}' is not allowed. Use move_to for movement.`);
          }
        }
      }

      botManager.chat(username, message);
      return `Sent message: ${message}`;
    }

    case "minecraft_enter_portal": {
      const result = await botManager.enterPortal(username);
      return result;
    }

    default:
      throw new Error(`Unknown movement tool: ${name}`);
  }
}
