const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function callTool(client, name, args = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return result.content[0].text;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, BOT_USERNAME: 'Claude6' }
  });
  const client = new Client({ name: 'claude6-player', version: '1.0.0' });
  await client.connect(transport);

  console.log(await callTool(client, 'minecraft_connect', { host: 'localhost', port: 25565 }));
  await sleep(4000);

  // Step 1: Move to birch trees
  console.log('=== Moving to birch log at (11, 109, 19) ===');
  console.log(await callTool(client, 'minecraft_move_to', { x: 11, y: 109, z: 19 }));
  await sleep(1000);

  console.log('=== SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // Step 2: Dig birch logs
  console.log('=== Digging birch logs ===');
  for (let i = 0; i < 6; i++) {
    const result = await callTool(client, 'minecraft_dig_block', { blockName: 'birch_log' });
    console.log(`Dig ${i+1}: ${result}`);
    await sleep(500);
  }

  // Step 3: Collect dropped items
  console.log('=== Collecting items ===');
  console.log(await callTool(client, 'minecraft_collect_items', { range: 16 }));
  await sleep(1000);

  // Also try to dig leaves for saplings/apples
  console.log('=== Digging leaves ===');
  for (let i = 0; i < 4; i++) {
    const result = await callTool(client, 'minecraft_dig_block', { blockName: 'birch_leaves' });
    console.log(`Leaves ${i+1}: ${result}`);
    await sleep(300);
  }
  // Collect again
  console.log(await callTool(client, 'minecraft_collect_items', { range: 16 }));
  await sleep(500);

  // Step 4: Check inventory
  console.log('=== INVENTORY ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));

  // Step 5: Craft planks from birch logs
  console.log('=== Crafting birch planks ===');
  console.log(await callTool(client, 'minecraft_craft', { item: 'birch_planks', count: 16 }));
  await sleep(500);

  // Step 6: Use craft_chain for tools
  console.log('=== Crafting tools via craft_chain ===');
  console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_pickaxe', count: 1 }));
  await sleep(500);
  console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_sword', count: 1 }));
  await sleep(500);
  console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_axe', count: 1 }));
  await sleep(500);

  // Step 7: Check inventory after crafting
  console.log('=== INVENTORY AFTER CRAFTING ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));

  // Step 8: Equip weapon
  console.log('=== EQUIPPING ===');
  console.log(await callTool(client, 'minecraft_equip_weapon'));

  // Step 9: Look for more trees to gather more wood
  console.log('=== MORE WOOD ===');
  for (let i = 0; i < 4; i++) {
    const result = await callTool(client, 'minecraft_dig_block', { blockName: 'birch_log' });
    console.log(`Dig ${i+1}: ${result}`);
    await sleep(500);
  }
  console.log(await callTool(client, 'minecraft_collect_items', { range: 16 }));
  await sleep(500);

  // Step 10: Chat update
  console.log('=== CHAT UPDATE ===');
  const pos = await callTool(client, 'minecraft_get_position');
  const inv = await callTool(client, 'minecraft_get_inventory');
  console.log(await callTool(client, 'minecraft_chat', {
    message: `Claude6: 木材収集完了、ツール作成済み。座標: ${pos}`
  }));

  // Check chat from others
  console.log('=== CHAT MESSAGES ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  // Step 11: Look for animals
  console.log('=== LOOKING FOR ANIMALS ===');
  console.log(await callTool(client, 'minecraft_get_nearby_entities', { range: 96 }));

  // Step 12: Final status
  console.log('=== FINAL INVENTORY ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log('=== FINAL STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log('=== FINAL SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL:', e.message));
