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

  // === Check current state ===
  console.log('=== STATUS ===');
  console.log(await callTool(client, 'minecraft_get_status'));
  const pos = JSON.parse(await callTool(client, 'minecraft_get_position'));
  console.log('Position:', JSON.stringify(pos));
  console.log('=== INVENTORY ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log('=== CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  // === Phase 1: Mine coal ===
  console.log('\n=== MINING COAL ===');
  // Equip stone pickaxe
  console.log(await callTool(client, 'minecraft_equip', { item_name: 'stone_pickaxe' }));

  // Coal ore is nearby at (32, 92, 37) - dig it
  const px = Math.floor(pos.x);
  const py = Math.floor(pos.y);
  const pz = Math.floor(pos.z);

  // Mine coal ore (at 32, 92, 37 and nearby)
  for (const [cx, cy, cz] of [[32, 92, 37], [32, 91, 37], [31, 92, 37], [33, 92, 37], [32, 92, 38], [32, 93, 37]]) {
    const result = await callTool(client, 'minecraft_dig_block', { x: cx, y: cy, z: cz });
    if (result.includes('Dug') && (result.includes('coal_ore') || result.includes('coal'))) {
      console.log(`Coal at (${cx},${cy},${cz}): OK`);
    }
    await sleep(300);
  }

  // Collect items
  console.log(await callTool(client, 'minecraft_collect_items'));
  await sleep(500);

  // === Phase 2: Dig to the surface to look for animals ===
  console.log('\n=== GOING UP TO SURFACE ===');
  // We're underground at y=93, need to get to surface (~y=108+)
  // Pillar up or dig up
  console.log(await callTool(client, 'minecraft_pillar_up', { height: 15 }));
  await sleep(2000);

  const newPos = JSON.parse(await callTool(client, 'minecraft_get_position'));
  console.log('New position:', JSON.stringify(newPos));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  // === Phase 3: Explore for animals ===
  console.log('\n=== EXPLORING FOR ANIMALS ===');
  // Move in different directions to find animals
  const searchDirs = [
    { x: newPos.x + 50, z: newPos.z },       // east
    { x: newPos.x, z: newPos.z + 50 },        // south
    { x: newPos.x - 50, z: newPos.z },         // west
    { x: newPos.x, z: newPos.z - 50 },         // north
  ];

  let foundAnimal = false;
  for (const dir of searchDirs) {
    console.log(`\n--- Moving to (${Math.floor(dir.x)}, ${Math.floor(dir.z)}) ---`);
    console.log(await callTool(client, 'minecraft_move_to', { x: dir.x, y: newPos.y, z: dir.z }));
    await sleep(1000);

    const entities = await callTool(client, 'minecraft_get_nearby_entities', { range: 64 });

    // Check for food animals
    for (const animal of ['cow', 'pig', 'sheep', 'chicken', 'rabbit']) {
      if (entities.includes(`"${animal}"`)) {
        console.log(`Found ${animal}!`);
        foundAnimal = true;

        // Attack it
        for (let i = 0; i < 6; i++) {
          console.log(await callTool(client, 'minecraft_equip_weapon'));
          const atk = await callTool(client, 'minecraft_attack', { entityName: animal });
          console.log(`  Attack ${i+1}: ${atk.slice(0, 100)}`);
          await sleep(600);
          if (atk.includes('not found') || atk.includes('died') || atk.includes('killed')) break;
        }
        console.log(await callTool(client, 'minecraft_collect_items'));
        await sleep(500);

        // Try to eat
        const inv = await callTool(client, 'minecraft_get_inventory');
        if (inv.match(/beef|pork|mutton|chicken_meat|rabbit|cooked/i)) {
          // We need to cook it first...
          console.log('Got raw meat! Need to cook it.');
        }
        break;
      }
    }
    if (foundAnimal) break;

    // Check for crops
    const surr = await callTool(client, 'minecraft_get_surroundings');
    if (surr.includes('wheat') || surr.includes('carrot') || surr.includes('potato') || surr.includes('melon') || surr.includes('apple')) {
      console.log('Found crops!');
      console.log(surr);
      break;
    }
  }

  // === Phase 4: Try fishing if no animals ===
  if (!foundAnimal) {
    console.log('\n=== TRYING FISHING ===');
    // Craft fishing rod: 3 sticks + 2 string
    // Need string from spiders or crafting
    // Let's check if we have string
    const inv = await callTool(client, 'minecraft_get_inventory');
    if (inv.includes('string')) {
      console.log('Crafting fishing rod...');
      console.log(await callTool(client, 'minecraft_craft', { item_name: 'fishing_rod', count: 1 }));
      console.log(await callTool(client, 'minecraft_fish', {}));
    } else {
      console.log('No string for fishing rod. Need to kill spiders.');

      // Look for spiders
      const ents = await callTool(client, 'minecraft_get_nearby_entities', { range: 64 });
      if (ents.includes('"spider"')) {
        console.log('Found spider! Attacking for string...');
        console.log(await callTool(client, 'minecraft_equip_weapon'));
        for (let i = 0; i < 5; i++) {
          const atk = await callTool(client, 'minecraft_attack', { entityName: 'spider' });
          console.log(`  Attack ${i+1}: ${atk.slice(0, 100)}`);
          await sleep(600);
          if (atk.includes('not found') || atk.includes('died')) break;
        }
        console.log(await callTool(client, 'minecraft_collect_items'));
      }
    }
  }

  // === Phase 5: Smelt raw meat if we have it ===
  const invBeforeSmelt = await callTool(client, 'minecraft_get_inventory');
  console.log('\n=== INVENTORY BEFORE SMELT ===');
  console.log(invBeforeSmelt);

  if (invBeforeSmelt.includes('raw') || invBeforeSmelt.includes('beef') || invBeforeSmelt.includes('porkchop') || invBeforeSmelt.includes('mutton') || invBeforeSmelt.includes('chicken')) {
    console.log('=== SMELTING MEAT ===');
    // Need furnace - check if nearby or craft one
    if (invBeforeSmelt.includes('cobblestone')) {
      console.log(await callTool(client, 'minecraft_craft', { item_name: 'furnace', count: 1 }));
      // Place furnace
      const p = JSON.parse(await callTool(client, 'minecraft_get_position'));
      console.log(await callTool(client, 'minecraft_place_block', {
        block_type: 'furnace', x: Math.floor(p.x) + 1, y: Math.floor(p.y), z: Math.floor(p.z)
      }));
    }
    // Try smelting
    for (const meat of ['beef', 'porkchop', 'mutton', 'chicken']) {
      if (invBeforeSmelt.includes(meat)) {
        console.log(await callTool(client, 'minecraft_smelt', { item_name: meat, fuel: 'birch_planks' }));
        break;
      }
    }
  }

  // === Phase 6: Chat and final ===
  console.log('\n=== FINAL CHAT ===');
  console.log(await callTool(client, 'minecraft_get_chat_messages'));

  const finalPos = await callTool(client, 'minecraft_get_position');
  const finalInv = await callTool(client, 'minecraft_get_inventory');
  const hasFood = finalInv.match(/cooked|bread|apple|golden_apple|carrot/i);

  let msg = `Claude6: 石ツール装備済み。位置${finalPos}。`;
  if (hasFood) msg += '食料あり！';
  else msg += '食料なし。動物・作物見つけたら教えて！';
  console.log(await callTool(client, 'minecraft_chat', { message: msg }));

  console.log('\n=== FINAL STATUS ===');
  console.log(await callTool(client, 'minecraft_get_inventory'));
  console.log(await callTool(client, 'minecraft_get_status'));
  console.log(await callTool(client, 'minecraft_get_surroundings'));

  await client.close();
}

main().catch(e => console.error('FATAL:', e.message));
