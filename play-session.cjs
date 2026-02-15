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

  // Connect
  console.log(await callTool(client, 'minecraft_connect', { host: 'localhost', port: 25565 }));
  await sleep(4000);

  // Get initial state
  console.log('=== STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log('=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));
  console.log('=== POSITION ===');
  console.log(await callTool(client, 'minecraft_get_position'));
  console.log('=== SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // Flee from any nearby danger
  console.log('=== FLEEING ===');
  console.log(await callTool(client, 'minecraft_flee', { distance: 25 }));
  await sleep(3000);

  // Check new position
  console.log('=== NEW POSITION ===');
  console.log(await callTool(client, 'minecraft_get_position'));
  console.log('=== NEW SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // Find wood
  console.log('=== FINDING WOOD ===');
  for (const wood of ['oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'acacia_log', 'cherry_log']) {
    const result = await callTool(client, 'minecraft_find_block', { blockName: wood, range: 64 });
    if (!result.includes('not found') && !result.includes('Error')) {
      console.log(`${wood}: ${result}`);
    }
  }

  // Find any log type and chop it
  console.log('=== GATHERING WOOD ===');
  const gatherResult = await callTool(client, 'minecraft_gather_resources', {
    blockType: 'oak_log',
    count: 8
  });
  console.log('GATHER:', gatherResult);
  await sleep(2000);

  // Check inventory
  console.log('=== INVENTORY ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));

  // Chat to other bots
  console.log('=== CHATTING ===');
  const pos = await callTool(client, 'minecraft_get_position');
  console.log(await callTool(client, 'minecraft_chat', { message: `Claude6: 起動しました！現在位置で木材収集中 ${pos}` }));

  // Try crafting planks and tools if we have wood
  const inv = await callTool(client, 'minecraft_get_inventory');
  if (inv.includes('log')) {
    console.log('=== CRAFTING ===');
    // Craft planks
    const plankResult = await callTool(client, 'minecraft_craft', { item: 'oak_planks', count: 4 });
    console.log('PLANKS:', plankResult);

    // Craft sticks
    const stickResult = await callTool(client, 'minecraft_craft', { item: 'stick', count: 4 });
    console.log('STICKS:', stickResult);

    // Craft crafting table
    const tableResult = await callTool(client, 'minecraft_craft', { item: 'crafting_table', count: 1 });
    console.log('TABLE:', tableResult);

    // Craft wooden pickaxe
    const pickResult = await callTool(client, 'minecraft_craft', { item: 'wooden_pickaxe', count: 1 });
    console.log('PICKAXE:', pickResult);

    // Craft wooden sword
    const swordResult = await callTool(client, 'minecraft_craft', { item: 'wooden_sword', count: 1 });
    console.log('SWORD:', swordResult);

    console.log('=== INVENTORY AFTER CRAFTING ===');
    console.log(await callTool(client, 'minecraft_get_inventory'));
  }

  // Equip weapons if available
  console.log('=== EQUIPPING ===');
  console.log(await callTool(client, 'minecraft_equip_weapon'));

  // Look for animals for food
  console.log('=== NEARBY ENTITIES ===');
  console.log(await callTool(client, 'minecraft_get_nearby_entities', { range: 64 }));

  // Get final status
  console.log('=== FINAL STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL ERROR:', e.message));
