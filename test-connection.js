#!/usr/bin/env node

/**
 * Simple test to verify Minecraft connection works
 */

import { botManager } from "./dist/bot-manager/index.js";

async function test() {
  console.log("Testing Minecraft connection...");

  try {
    const result = await botManager.connect({
      host: "localhost",
      port: 25565,
      username: "TestBot",
    });

    console.log("✓ Connection successful:", result);

    // Get position
    const pos = botManager.getPosition("TestBot");
    console.log("✓ Position:", pos);

    // Get status
    const status = botManager.getStatus("TestBot");
    console.log("✓ Status:", status);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Disconnect
    await botManager.disconnect("TestBot");
    console.log("✓ Disconnected");

    process.exit(0);
  } catch (error) {
    console.error("✗ Error:", error.message);
    process.exit(1);
  }
}

test();
