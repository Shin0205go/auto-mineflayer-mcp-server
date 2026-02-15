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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connectWithRetry(client, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await callTool(client, 'minecraft_connect', { host: 'localhost', port: 25565 });
    if (result.includes('Successfully connected') || result.includes('Already connected')) {
      console.log('Connected!');
      return true;
    }
    console.log(`Attempt ${i+1}: ${result.slice(0, 80)}`);
    await sleep(result.includes('server_full') ? 15000 : 5000);
  }
  return false;
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node', args: ['dist/index.js'],
    env: { ...process.env, BOT_USERNAME: 'Claude6' }
  });
  const client = new Client({ name: 'claude6-player', version: '1.0.0' });
  await client.connect(transport);

  if (!await connectWithRetry(client)) {
    console.log('Failed to connect'); await client.close(); return;
  }
  await sleep(4000);

  // === Phase 1: Assessment ===
  console.log('\n=== INITIAL STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_position'));

  // Check current inventory
  const currentInv = await callTool(client, 'minecraft_get_inventory');
  console.log('Inventory:', currentInv);

  // Check surroundings
  const surr = await callTool(client, 'minecraft_get_surroundings');
  console.log(surr);

  // === Phase 2: Gather more wood if needed ===
  const needWood = !currentInv.includes('log') ||
    (currentInv.match(/birch_log x(\d+)/) && parseInt(currentInv.match(/birch_log x(\d+)/)[1]) < 10);

  if (needWood) {
    console.log('\n=== GATHERING WOOD ===');

    // Find birch logs from surroundings
    const logMatch = surr.match(/birch_log:.*?最寄り.*?\((-?\d+), (\d+), (-?\d+)\)/);
    if (logMatch) {
      const tx = parseInt(logMatch[1]);
      const ty = parseInt(logMatch[2]);
      const tz = parseInt(logMatch[3]);
      console.log(`Tree at (${tx}, ${ty}, ${tz})`);

      // Move to tree
      console.log(await callTool(client, 'minecraft_move_to', { x: tx, y: ty, z: tz }));
      await sleep(1000);

      // Dig the tree (upward from base)
      for (let dy = 0; dy <= 6; dy++) {
        const result = await callTool(client, 'minecraft_dig_block', { x: tx, y: ty + dy, z: tz });
        if (result.includes('Dug') && result.includes('birch_log')) {
          console.log(`  Log at y=${ty+dy}: OK`);
        } else if (result.includes('No block')) {
          break;
        }
        await sleep(400);
      }
      await sleep(500);
      console.log(await callTool(client, 'minecraft_collect_items'));
    }

    // Check for more trees after first one
    const surr2 = await callTool(client, 'minecraft_get_surroundings');
    const logMatch2 = surr2.match(/birch_log:.*?最寄り.*?\((-?\d+), (\d+), (-?\d+)\)/);
    if (logMatch2) {
      const tx2 = parseInt(logMatch2[1]);
      const ty2 = parseInt(logMatch2[2]);
      const tz2 = parseInt(logMatch2[3]);
      console.log(`Another tree at (${tx2}, ${ty2}, ${tz2})`);

      console.log(await callTool(client, 'minecraft_move_to', { x: tx2, y: ty2, z: tz2 }));
      await sleep(1000);

      for (let dy = 0; dy <= 6; dy++) {
        const result = await callTool(client, 'minecraft_dig_block', { x: tx2, y: ty2 + dy, z: tz2 });
        if (result.includes('Dug') && result.includes('log')) {
          console.log(`  Log at y=${ty2+dy}: OK`);
        } else if (result.includes('No block')) {
          break;
        }
        await sleep(400);
      }
      await sleep(500);
      console.log(await callTool(client, 'minecraft_collect_items'));
    }
  }

  // === Phase 3: Craft tools ===
  console.log('\n=== CRAFTING ===');
  const invBeforeCraft = await callTool(client, 'minecraft_get_inventory');
  console.log('Before craft:', invBeforeCraft);

  if (invBeforeCraft.includes('birch_log') || invBeforeCraft.includes('oak_log')) {
    // Craft planks first
    console.log('Crafting planks...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'birch_planks', count: 16 }));
    await sleep(300);

    // Craft sticks
    console.log('Crafting sticks...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'stick', count: 8 }));
    await sleep(300);

    // Craft crafting table
    console.log('Crafting table...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'crafting_table', count: 1 }));
    await sleep(300);

    // Place crafting table
    const myPos = JSON.parse(await callTool(client, 'minecraft_get_position'));
    const tableX = Math.floor(myPos.x) + 1;
    const tableY = Math.floor(myPos.y);
    const tableZ = Math.floor(myPos.z);
    console.log('Placing crafting table...');
    console.log(await callTool(client, 'minecraft_place_block', {
      blockName: 'crafting_table', x: tableX, y: tableY, z: tableZ
    }));
    await sleep(300);

    // Craft pickaxe
    console.log('Crafting wooden_pickaxe...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'wooden_pickaxe', count: 1 }));
    await sleep(300);

    // Craft sword
    console.log('Crafting wooden_sword...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'wooden_sword', count: 1 }));
    await sleep(300);

    // Craft axe
    console.log('Crafting wooden_axe...');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'wooden_axe', count: 1 }));
    await sleep(300);

    console.log('After craft:', await callTool(client, 'minecraft_get_inventory'));

    // Equip sword
    console.log(await callTool(client, 'minecraft_equip_weapon'));
  }

  // === Phase 4: Mine stone for upgrades ===
  console.log('\n=== MINING STONE ===');

  // Equip pickaxe
  console.log(await callTool(client, 'minecraft_equip', { item_name: 'wooden_pickaxe' }));

  const pos = JSON.parse(await callTool(client, 'minecraft_get_position'));
  const mx = Math.floor(pos.x);
  const my = Math.floor(pos.y);
  const mz = Math.floor(pos.z);

  // Dig down to find stone
  let foundStone = false;
  for (let y = my - 1; y >= my - 8; y--) {
    const result = await callTool(client, 'minecraft_dig_block', { x: mx, y: y, z: mz });
    console.log(`Dig (${mx}, ${y}, ${mz}): ${result.slice(0, 60)}`);
    if (result.includes('cobblestone')) {
      foundStone = true;
    }
    await sleep(400);
  }

  // Also dig sideways for more stone
  if (!foundStone) {
    for (let y = my - 1; y >= my - 4; y--) {
      const result = await callTool(client, 'minecraft_dig_block', { x: mx + 1, y: y, z: mz });
      console.log(`Dig (${mx+1}, ${y}, ${mz}): ${result.slice(0, 60)}`);
      await sleep(400);
    }
  }

  console.log(await callTool(client, 'minecraft_collect_items'));
  await sleep(500);

  const invAfterMine = await callTool(client, 'minecraft_get_inventory');
  console.log('After mining:', invAfterMine);

  // Upgrade to stone tools
  if (invAfterMine.includes('cobblestone')) {
    console.log('\n=== UPGRADING TO STONE TOOLS ===');
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'stone_pickaxe', count: 1 }));
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'stone_sword', count: 1 }));
    console.log(await callTool(client, 'minecraft_craft', { item_name: 'stone_axe', count: 1 }));
    console.log(await callTool(client, 'minecraft_equip_weapon'));
    console.log('After upgrade:', await callTool(client, 'minecraft_get_inventory'));
  }

  // === Phase 5: Look for food ===
  console.log('\n=== FOOD SEARCH ===');
  const entities = await callTool(client, 'minecraft_get_nearby_entities', { range: 128 });
  console.log('Entities:', entities);

  // Try to kill animals for food
  const animals = ['cow', 'pig', 'sheep', 'chicken'];
  for (const animal of animals) {
    if (entities.includes(`"${animal}"`)) {
      console.log(`Found ${animal}! Attacking...`);
      for (let i = 0; i < 5; i++) {
        const atk = await callTool(client, 'minecraft_attack', { entityName: animal });
        console.log(`  Attack ${i+1}: ${atk.slice(0, 80)}`);
        await sleep(800);
        if (atk.includes('not found') || atk.includes('died')) break;
      }
      console.log(await callTool(client, 'minecraft_collect_items'));
      break;
    }
  }

  // === Phase 6: Chat communication ===
  console.log('\n=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  const finalPos = await callTool(client, 'minecraft_get_position');
  const finalInv = await callTool(client, 'minecraft_get_inventory');
  const hasFood = finalInv.match(/beef|pork|mutton|chicken|bread|apple|cookie|carrot/i);

  const chatMsg = hasFood
    ? `Claude6: ツール＆食料確保済み！位置${finalPos}`
    : `Claude6: ツール確保済み。食料未確保。位置${finalPos}。動物いたら教えて！`;
  console.log(await callTool(client, 'minecraft_chat', { message: chatMsg }));

  // === Final Status ===
  console.log('\n=== FINAL ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL:', e.message));
