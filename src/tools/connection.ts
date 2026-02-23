import { botManager } from "../bot-manager/index.js";
import { setAgentType } from "../agent-state.js";

export const connectionTools = {
  minecraft_connect: {
    description: "Connect to a Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {
        host: {
          type: "string",
          description: "Server host address (default: localhost)",
          default: "localhost",
        },
        port: {
          type: "number",
          description: "Server port (default: 25565)",
          default: 25565,
        },
        username: {
          type: "string",
          description: "Bot username",
        },
        version: {
          type: "string",
          description: "Minecraft version (optional, auto-detect if not specified)",
        },
        agentType: {
          type: "string",
          enum: ["game", "dev"],
          default: "dev",
          description: "Agent type: 'game' for Game Agent (basic tools only), 'dev' for Dev Agent (all tools). Default: 'dev' for Claude Code CLI.",
        },
      },
      required: ["username"],
    },
  },

  minecraft_disconnect: {
    description: "Disconnect from the Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_get_chat_messages: {
    description: "Get chat messages from players",
    inputSchema: {
      type: "object" as const,
      properties: {
        clear: {
          type: "boolean",
          description: "Whether to clear messages after reading (default: true)",
          default: true,
        },
      },
      required: [],
    },
  },
};

export async function handleConnectionTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_connect": {
      const host = (args.host as string) || process.env.MC_HOST || "localhost";
      const port = (args.port as number) || parseInt(process.env.MC_PORT || "25565");
      const username = (args.username as string) || process.env.BOT_USERNAME || "";
      const version = args.version as string | undefined;
      const agentType = (args.agentType as "game" | "dev") || "dev";

      if (!username) {
        throw new Error("Username is required (pass username arg or set BOT_USERNAME env var)");
      }

      // Set agent type for tool filtering
      setAgentType(agentType);

      try {
        await botManager.connect({ host, port, username, version });

        // Auto-validate survival environment for Game Agents
        // Can be disabled with SKIP_VALIDATION=true for debugging
        // DISABLED: Validation was too strict and blocked gameplay even when food was available
        // Bot can check inventory and explore for food after connecting
        const skipValidation = process.env.SKIP_VALIDATION === "true" || true; // Always skip for now
        if (agentType === "game" && !skipValidation) {
          // Import validation function dynamically to avoid circular dependency
          const { minecraft_validate_survival_environment } = await import("./high-level-actions.js");

          // Wait 2 seconds for the world to load
          await new Promise(resolve => setTimeout(resolve, 2000));

          try {
            // Check if bot is still connected before validation
            if (!botManager.isConnected(username)) {
              console.error(`[Connection] Bot ${username} disconnected before validation could start`);
              throw new Error(`Bot ${username} disconnected shortly after connection. Validation skipped.\n\nPossible causes:\n1. Server kicked the bot\n2. Network connection lost\n3. Server is not accepting connections\n\nCheck server logs for details.`);
            }

            const validationResult = await minecraft_validate_survival_environment(username, 100);

            // Check if bot is still connected after validation
            if (!botManager.isConnected(username)) {
              console.error(`[Connection] Bot ${username} disconnected during validation`);
              throw new Error(`Bot ${username} disconnected during environment validation.\n\nValidation results:\n${validationResult}\n\nThe bot was kicked or disconnected by the server during the validation check.`);
            }

            if (validationResult.includes("❌ CRITICAL")) {
              // CRITICAL: Log warning but allow connection - bot might have food in inventory
              // or food might be available further away
              console.warn(`[Connection] CRITICAL validation warning:\n${validationResult}`);
              console.warn(`[Connection] Proceeding with connection - bot may need to find food sources`);
              // Return validation result as part of success message instead of blocking
              return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})\n\n⚠️ ENVIRONMENT WARNING:\n${validationResult}\n\nConnection allowed - check inventory for food or explore to find food sources.`;
            }
          } catch (validationError) {
            // Validation failed critically - re-throw to block connection
            const errorMsg = validationError instanceof Error ? validationError.message : String(validationError);
            console.error(`[Connection] Survival validation failed: ${errorMsg}`);
            throw validationError;
          }
        }

        return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect to ${host}:${port}: ${errorMessage}`);
      }
    }

    case "minecraft_disconnect": {
      const username = botManager.requireSingleBot();
      await botManager.disconnect(username);
      return "Successfully disconnected from server";
    }

    case "minecraft_get_chat_messages": {
      const username = botManager.requireSingleBot();
      const clear = args.clear !== false;
      const messages = botManager.getChatMessages(username, clear);

      if (messages.length === 0) {
        return "No new chat messages";
      }

      return JSON.stringify(messages, null, 2);
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
