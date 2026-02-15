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

async function connectWithRetry(client, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Connection attempt ${i+1}/${maxAttempts}...`);
    const result = await callTool(client, 'minecraft_connect', { host: 'localhost', port: 25565 });
    console.log(result);
    if (result.includes('Successfully connected')) {
      return true;
    }
    if (result.includes('server_full')) {
      console.log('Server is full, waiting 10 seconds before retry...');
      await sleep(10000);
    } else {
      console.log('Connection failed, waiting 5 seconds...');
      await sleep(5000);
    }
  }
  return false;
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, BOT_USERNAME: 'Claude6' }
  });
  const client = new Client({ name: 'claude6-player', version: '1.0.0' });
  await client.connect(transport);

  const connected = await connectWithRetry(client);
  if (!connected) {
    console.log('Failed to connect after all attempts');
    await client.close();
    return;
  }
  await sleep(4000);

  // === PHASE 1: Initial Assessment ===
  console.log('\n========= PHASE 1: ASSESSMENT =========');
  console.log('=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));
  console.log('=== STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log('=== POSITION ===');
  console.log(await callTool(client, 'minecraft_get_position'));
  console.log('=== SURROUNDINGS ===');
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // === PHASE 2: Get Safe & Get Wood ===
  console.log('\n========= PHASE 2: WOOD GATHERING =========');

  // Flee if enemies nearby
  console.log(await callTool(client, 'minecraft_flee', { distance: 20 }));
  await sleep(2000);

  // Try to find and dig logs
  console.log('=== Digging logs ===');
  for (let i = 0; i < 10; i++) {
    // Try different log types
    for (const logType of ['oak_log', 'birch_log', 'spruce_log', 'dark_oak_log']) {
      const result = await callTool(client, 'minecraft_dig_block', { blockName: logType });
      if (!result.includes('not found') && !result.includes('Error')) {
        console.log(`Dig (${logType}): ${result}`);
        await sleep(300);
        break;
      }
    }
  }

  // Collect items
  console.log('=== Collecting ===');
  console.log(await callTool(client, 'minecraft_collect_items', { range: 32 }));
  await sleep(1000);

  console.log('=== INVENTORY ===');
  const inv = await callTool(client, 'minecraft_get_inventory');
  console.log(inv);

  // === PHASE 3: Crafting ===
  if (inv.includes('log') || inv.includes('planks')) {
    console.log('\n========= PHASE 3: CRAFTING =========');

    // Craft chain for tools
    console.log('=== Craft wooden_pickaxe ===');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_pickaxe', count: 1 }));
    await sleep(500);

    console.log('=== Craft wooden_sword ===');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_sword', count: 1 }));
    await sleep(500);

    console.log('=== Craft wooden_axe ===');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'wooden_axe', count: 1 }));
    await sleep(500);

    console.log('=== INVENTORY AFTER CRAFTING ===');
    console.log(await callTool(client, 'minecraft_get_inventory'));

    // Equip
    console.log(await callTool(client, 'minecraft_equip_weapon'));
  }

  // === PHASE 4: More Resources ===
  console.log('\n========= PHASE 4: MORE RESOURCES =========');

  // Try to find stone for better tools
  console.log('=== Looking for stone ===');
  for (let i = 0; i < 5; i++) {
    const result = await callTool(client, 'minecraft_dig_block', { blockName: 'stone' });
    if (!result.includes('not found')) {
      console.log(`Stone dig: ${result}`);
    }
    await sleep(300);
  }
  console.log(await callTool(client, 'minecraft_collect_items', { range: 16 }));

  // Upgrade to stone tools if possible
  const inv2 = await callTool(client, 'minecraft_get_inventory');
  console.log('=== CURRENT INVENTORY ===');
  console.log(inv2);

  if (inv2.includes('cobblestone')) {
    console.log('=== Upgrading to stone tools ===');
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'stone_pickaxe', count: 1 }));
    console.log(await callTool(client, 'minecraft_craft_chain', { targetItem: 'stone_sword', count: 1 }));
    console.log(await callTool(client, 'minecraft_equip_weapon'));
  }

  // === PHASE 5: Food & Communication ===
  console.log('\n========= PHASE 5: FOOD & CHAT =========');

  // Check chat
  console.log('=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  // Share position
  const finalPos = await callTool(client, 'minecraft_get_position');
  const finalInv = await callTool(client, 'minecraft_get_inventory');
  console.log(await callTool(client, 'minecraft_chat', {
    message: `Claude6: ツール作成完了。位置: ${finalPos}. 食料探索中`
  }));

  // Look for animals
  console.log('=== ENTITIES (looking for food) ===');
  const entities = await callTool(client, 'minecraft_get_nearby_entities', { range: 96 });
  console.log(entities);

  // If we find passive mobs (cow, pig, sheep, chicken), attack them for food
  if (entities.includes('"cow"') || entities.includes('"pig"') || entities.includes('"sheep"') || entities.includes('"chicken"')) {
    console.log('=== Hunting for food! ===');
    for (const animal of ['cow', 'pig', 'sheep', 'chicken']) {
      if (entities.includes(`"${animal}"`)) {
        console.log(`Found ${animal}! Attacking...`);
        console.log(await callTool(client, 'minecraft_attack', { entityName: animal }));
        await sleep(1000);
        console.log(await callTool(client, 'minecraft_attack', { entityName: animal }));
        await sleep(1000);
        break;
      }
    }
    console.log(await callTool(client, 'minecraft_collect_items', { range: 16 }));
  }

  // === FINAL STATUS ===
  console.log('\n========= FINAL STATUS =========');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL:', e.message));
