import { botManager } from "../bot-manager/index.js";

export const bootstrapTools = {
  minecraft_check_bootstrap: {
    description:
      "Check if bot has bootstrap items (food, tools, infrastructure). Returns detailed status and suggestions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: {
          type: "string",
          description: "Bot username to check (optional, uses connected bot if omitted)",
        },
      },
      required: [],
    },
  },

  minecraft_generate_bootstrap_script: {
    description:
      "Generate a bootstrap script that admin can paste into Minecraft server console. Creates /give commands for all connected bots or specified bots.",
    inputSchema: {
      type: "object" as const,
      properties: {
        bots: {
          type: "array",
          items: { type: "string" },
          description:
            "List of bot usernames to generate bootstrap for (optional, uses all connected bots if omitted)",
        },
        format: {
          type: "string",
          enum: ["console", "chat"],
          default: "console",
          description:
            "Format: 'console' for server console (recommended), 'chat' for in-game chat",
        },
      },
      required: [],
    },
  },

  minecraft_list_bootstrap_needs: {
    description:
      "List all connected bots and their bootstrap status. Shows which bots need items and what they need.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

/**
 * Generate bootstrap script for admin to paste into server console
 */
function generateBootstrapScript(bots: string[]): string {
  const bootstrapItems = [
    { item: "bread", count: 30 },
    { item: "cooked_beef", count: 20 },
    { item: "crafting_table", count: 1 },
    { item: "furnace", count: 1 },
    { item: "cobblestone", count: 64 },
    { item: "wooden_pickaxe", count: 1 },
  ];

  let script = `# ===== MINECRAFT BOOTSTRAP SCRIPT =====
# Paste these commands into your Minecraft server console (NOT in-game chat)
# Each /give command is separate - do NOT combine them into one line

`;

  for (const bot of bots) {
    script += `\n# Bootstrap for ${bot}\n`;
    for (const itemConfig of bootstrapItems) {
      script += `/give ${bot} ${itemConfig.item} ${itemConfig.count}\n`;
    }
  }

  script += `
# ===== VERIFICATION =====
# After running all /give commands above, verify with:
# /execute as Claude1 run data get entity @s Inventory
# (Check that Inventory is NOT empty)

# If commands fail with "Unknown or incomplete command":
# 1. Make sure you're pasting into SERVER CONSOLE, not in-game chat
# 2. Each /give command should be on its own line
# 3. Check server supports /give command (Java Edition 1.4.2+)
# 4. Verify you have OP/admin permissions to use /give

# If players still don't have items:
# - Server may have keepInventory=false (items drop on death)
# - Try /gamerule keepInventory true
# - Or manually place items in accessible chests
`;

  return script;
}

/**
 * Check if a bot has bootstrap items in inventory
 */
function checkBotBootstrap(
  username: string
): {
  hasFood: boolean;
  hasTools: boolean;
  hasInfrastructure: boolean;
  missingItems: string[];
  details: string;
} {
  if (!botManager.isConnected(username)) {
    return {
      hasFood: false,
      hasTools: false,
      hasInfrastructure: false,
      missingItems: ["Bot not connected"],
      details: `❌ ${username} is not connected to server`,
    };
  }

  const inventory = botManager.getInventory(username);
  const items = new Map<string, number>();

  // Count items in inventory
  for (const item of inventory) {
    const count = items.get(item.name) || 0;
    items.set(item.name, count + item.count);
  }

  // Check required items
  const requiredFood = ["bread", "cooked_beef", "cooked_chicken", "cooked_pork", "beef"];
  const requiredTools = ["crafting_table", "furnace", "wooden_pickaxe", "stone_pickaxe"];
  const requiredBlocks = ["cobblestone", "dirt", "stone"];

  const hasFood =
    requiredFood.some(food => (items.get(food) || 0) >= 20) &&
    requiredFood.some(food => (items.get(food) || 0) >= 5);
  const hasTools = requiredTools.some(tool => (items.get(tool) || 0) >= 1);
  const hasInfrastructure =
    (items.get("crafting_table") || 0) >= 1 &&
    (items.get("furnace") || 0) >= 1 &&
    (items.get("cobblestone") || 0) >= 32;

  // List missing items
  const missingItems: string[] = [];
  if ((items.get("bread") || 0) + (items.get("cooked_beef") || 0) < 20)
    missingItems.push("food (need 20+ bread/cooked_beef)");
  if ((items.get("crafting_table") || 0) < 1) missingItems.push("crafting_table (1)");
  if ((items.get("furnace") || 0) < 1) missingItems.push("furnace (1)");
  if ((items.get("cobblestone") || 0) < 32)
    missingItems.push(`cobblestone (need 32, have ${items.get("cobblestone") || 0})`);
  if (
    (items.get("wooden_pickaxe") || 0) +
      (items.get("stone_pickaxe") || 0) +
      (items.get("iron_pickaxe") || 0) <
    1
  )
    missingItems.push("pickaxe (wooden/stone/iron)");

  const status =
    hasFood && hasTools && hasInfrastructure
      ? "✅ BOOTSTRAP COMPLETE"
      : hasFood && hasTools
        ? "⚠️ PARTIAL (missing infrastructure)"
        : hasFood
          ? "❌ CRITICAL (missing tools)"
          : "🔴 CRITICAL (no food or tools)";

  const details = `
${status}
${username} Inventory:
  Food: ${(items.get("bread") || 0) + (items.get("cooked_beef") || 0)} items
  Tools: crafting_table ${items.get("crafting_table") || 0}, furnace ${items.get("furnace") || 0}
  Blocks: cobblestone ${items.get("cobblestone") || 0}

${missingItems.length > 0 ? `Missing: ${missingItems.join(", ")}` : "No missing items"}
`;

  return {
    hasFood,
    hasTools,
    hasInfrastructure,
    missingItems,
    details,
  };
}

export async function handleBootstrapTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_check_bootstrap": {
      const username = (args.username as string) || botManager.requireSingleBot();
      const check = checkBotBootstrap(username);
      return check.details;
    }

    case "minecraft_generate_bootstrap_script": {
      const botsArg = args.bots as unknown;
      const bots: string[] =
        Array.isArray(botsArg) && botsArg.length > 0
          ? (botsArg as string[])
          : botManager.getAllBots();

      if (bots.length === 0) {
        return "❌ No bots specified and none connected. Connect a bot first or pass bot usernames.";
      }

      const script = generateBootstrapScript(bots);
      return `✅ Bootstrap script generated for ${bots.length} bot(s):\n\n${script}`;
    }

    case "minecraft_list_bootstrap_needs": {
      const bots = botManager.getAllBots();

      if (bots.length === 0) {
        return "No bots connected. Connect a bot first with minecraft_connect.";
      }

      let report = "=== BOOTSTRAP STATUS FOR ALL BOTS ===\n\n";
      for (const botName of bots) {
        const check = checkBotBootstrap(botName);
        report += check.details + "\n";
      }

      report += "\n=== NEXT STEPS ===\n";
      const needsBootstrap = bots.filter(b => {
        const check = checkBotBootstrap(b);
        return !check.hasFood || !check.hasTools || !check.hasInfrastructure;
      });

      if (needsBootstrap.length > 0) {
        report += `\n${needsBootstrap.length} bot(s) need bootstrap:\n`;
        for (const bot of needsBootstrap) {
          report += `  - ${bot}\n`;
        }
        report += `\nRun: minecraft_generate_bootstrap_script to get admin commands\n`;
      } else {
        report += `\n✅ All ${bots.length} bot(s) are bootstrapped and ready!\n`;
      }

      return report;
    }

    default:
      throw new Error(`Unknown bootstrap tool: ${name}`);
  }
}
