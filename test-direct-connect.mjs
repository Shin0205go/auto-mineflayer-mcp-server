#!/usr/bin/env node

/**
 * Direct Minecraft connection test (bypassing MCP)
 */

import { botManager } from "./dist/bot-manager/index.js";

async function main() {
  try {
    console.log("Connecting to Minecraft server...");
    const result = await botManager.connect({
      host: "localhost",
      port: 25565,
      username: "Claude1Test",
    });
    console.log("Success:", result);

    // Get status
    setTimeout(async () => {
      const status = botManager.getBot("Claude1Test");
      if (status) {
        console.log("Bot status:", {
          health: status.health,
          food: status.food,
          position: status.entity.position,
        });
      }

      // Disconnect after 5 seconds
      setTimeout(async () => {
        await botManager.disconnect("Claude1Test");
        console.log("Disconnected");
        process.exit(0);
      }, 5000);
    }, 2000);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
