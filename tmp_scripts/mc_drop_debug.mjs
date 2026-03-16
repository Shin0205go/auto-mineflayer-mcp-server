/**
 * Debug drop collection - mine ONE block and observe EVERYTHING
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);
  console.log('Inventory before:', bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', '));

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Set up event listeners for ALL entity events
  bot.on('entitySpawn', (entity) => {
    if (entity.type === 'object' || entity.type === 'item_drop') {
      console.log(`\n[entitySpawn] type=${entity.type} name=${entity.name} objectType=${entity.objectType}`);
      console.log(`  pos: ${entity.position}`);
      console.log(`  metadata: ${JSON.stringify(entity.metadata?.slice(0, 15))}`);
    }
  });

  bot.on('playerCollect', (collector, collected) => {
    console.log(`\n[playerCollect] collector=${collector.username} item=${JSON.stringify(collected?.metadata)}`);
  });

  // Track all entities before mining
  const entitiesBefore = Object.keys(bot.entities).length;
  console.log('\nEntities before mining:', entitiesBefore);

  // Find nearest iron ore
  const oreId = bot.registry.blocksByName['iron_ore']?.id;
  const ore = bot.findBlock({ matching: oreId, maxDistance: 30 });
  if (!ore) {
    console.log('No iron ore nearby!');
    // Try stone for testing
    const stone = bot.findBlock({ matching: bot.registry.blocksByName['stone']?.id, maxDistance: 10 });
    if (!stone) { console.log('No stone!'); bot.end(); return; }

    console.log('Testing with stone at', stone.position);
    await new Promise((resolve) => {
      const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 10000);
      bot.pathfinder.setGoal(new GoalNear(stone.position.x, stone.position.y, stone.position.z, 1));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
    });

    const closeStone = bot.findBlock({ matching: bot.registry.blocksByName['stone']?.id, maxDistance: 2 });
    if (!closeStone) { console.log('Lost stone'); bot.end(); return; }

    // Unequip tool (hand mining) to test drops
    await bot.unequip('hand');
    console.log('Mining stone with hand at', closeStone.position, '...');
    console.log('Bot pos:', bot.entity.position);

    const invBefore = Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count]));

    await bot.dig(closeStone);
    console.log('Dig completed');
    console.log('Bot pos after dig:', bot.entity.position);

    await sleep(1000);
    const entitiesAfter = Object.keys(bot.entities).length;
    console.log('Entities after mining:', entitiesAfter, '(diff:', entitiesAfter - entitiesBefore, ')');

    const invAfter = Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count]));
    const changes = [];
    const allKeys = new Set([...Object.keys(invBefore), ...Object.keys(invAfter)]);
    for (const k of allKeys) {
      if ((invAfter[k] || 0) !== (invBefore[k] || 0)) {
        changes.push(`${k}: ${invBefore[k] || 0} -> ${invAfter[k] || 0}`);
      }
    }
    console.log('Inventory changes:', changes.join(', ') || 'NONE');

    // Check for item entities
    const items = Object.values(bot.entities).filter(e =>
      e.type === 'object' && e.objectType === 'Item'
    );
    console.log('Item entities on ground:', items.length);
    items.forEach(e => {
      const d = e.position.distanceTo(bot.entity.position);
      console.log(` dist=${d.toFixed(1)} pos=${e.position}`);
    });

    bot.end();
    return;
  }

  console.log('Iron ore at', ore.position);
  await new Promise((resolve) => {
    const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 10000);
    bot.pathfinder.setGoal(new GoalNear(ore.position.x, ore.position.y, ore.position.z, 1));
    bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
  });

  const closeOre = bot.findBlock({ matching: oreId, maxDistance: 2 });
  if (!closeOre) { console.log('Lost ore'); bot.end(); return; }

  const pick = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pick) await bot.equip(pick, 'hand');

  console.log('Mining ore at', closeOre.position, 'with', bot.heldItem?.name);
  console.log('Bot pos:', bot.entity.position);

  const invBefore = Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count]));

  await bot.dig(closeOre);
  console.log('\nDig completed!');
  console.log('Bot pos:', bot.entity.position);

  // Wait and observe
  for (let i = 0; i < 5; i++) {
    await sleep(500);
    const entAfter = Object.values(bot.entities).filter(e =>
      e.type === 'object' && e.objectType === 'Item' &&
      e.position.distanceTo(closeOre.position) < 5
    );
    const inv = bot.inventory.items();
    const rawIron = inv.find(i => i.name === 'raw_iron')?.count || 0;
    console.log(`t+${(i+1)*0.5}s: raw_iron=${rawIron} item_entities=${entAfter.length}`);
  }

  // Walk onto the exact ore spot
  console.log('\nWalking onto ore spot...');
  await new Promise((resolve) => {
    const to = setTimeout(resolve, 3000);
    bot.pathfinder.setGoal(new GoalNear(closeOre.position.x, closeOre.position.y, closeOre.position.z, 0));
    bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
    bot.once('path_update', () => { clearTimeout(to); resolve(); });
  });

  await sleep(1000);

  const invAfter = Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count]));
  const changes = [];
  const allKeys = new Set([...Object.keys(invBefore), ...Object.keys(invAfter)]);
  for (const k of allKeys) {
    if ((invAfter[k] || 0) !== (invBefore[k] || 0)) {
      changes.push(`${k}: ${invBefore[k] || 0} -> ${invAfter[k] || 0}`);
    }
  }
  console.log('\nInventory changes:', changes.join(', ') || 'NONE');

  const itemsOnGround = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'Item');
  console.log('Items on ground:', itemsOnGround.length);
  itemsOnGround.forEach(e => {
    const d = e.position.distanceTo(bot.entity.position);
    console.log(` dist=${d.toFixed(1)} pos=${Math.round(e.position.x)},${Math.round(e.position.y)},${Math.round(e.position.z)}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
