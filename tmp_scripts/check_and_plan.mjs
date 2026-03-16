/**
 * Check current state and plan next steps
 * Also look for a natural path to the dungeon
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay);

  // Wait for full day
  while (bot.time.timeOfDay > 6000 && bot.time.timeOfDay < 12000) {
    // Middle of day is best
    break;
  }
  while (bot.time.timeOfDay > 12541) {
    console.log('Night, waiting... time:', bot.time.timeOfDay);
    await sleep(5000);
  }

  console.log('Day check OK, time:', bot.time.timeOfDay);

  // Inventory check
  const inv = bot.inventory.items();
  console.log('Inventory:', inv.map(i => i.name + 'x' + i.count).join(', '));

  // Search for cave entrances near dungeon area
  // Look for air blocks from y=60 down to y=20 near (87, ?, -62)
  // This helps find a cave path to the dungeon

  // Check if there's a natural path by finding air blocks going downward
  const dungeonSurface = { x: 87, z: -62 };

  // Find the natural terrain height at dungeon location
  for (let y = 100; y > 0; y--) {
    const block = bot.blockAt({ x: 87, y: y, z: -62 });
    if (block && block.name !== 'air') {
      console.log('Ground at dungeon x: y=' + y + ' block=' + block.name);
      break;
    }
  }

  // Scan for cave openings (air blocks accessible from above)
  // between surface and y=35
  for (let y = 60; y >= 35; y--) {
    const b = bot.blockAt({ x: 87, y: y, z: -62 });
    const bAbove = bot.blockAt({ x: 87, y: y + 1, z: -62 });
    if (b && b.name === 'air' && bAbove && bAbove.name !== 'air') {
      console.log('Cave opening at y=' + y + ' from above');
    }
  }

  // Check if we can access from nearby - look for air at y=35-40 in nearby columns
  console.log('Scanning for cave access routes to (87,35,-62)...');
  let bestEntry = null;
  for (let dx = -10; dx <= 10; dx += 2) {
    for (let dz = -10; dz <= 10; dz += 2) {
      for (let dy = 0; dy <= 20; dy++) {
        const b = bot.blockAt({ x: 87 + dx, y: 35 + dy, z: -62 + dz });
        if (b && b.name === 'air') {
          // Check if accessible from above
          const bAbove = bot.blockAt({ x: 87 + dx, y: 35 + dy + 1, z: -62 + dz });
          if (bAbove && bAbove.name !== 'air') continue;
          if (!bestEntry || dy < bestEntry.dy) {
            bestEntry = { x: 87 + dx, y: 35 + dy, z: -62 + dz, dy };
          }
        }
      }
    }
  }

  if (bestEntry) {
    console.log('Best cave entry near dungeon:', bestEntry);
  } else {
    console.log('No natural cave entry found - dungeon is sealed underground');
  }

  // Report via chat
  await bot.chat('[状況] dungeon chest (87,35,-62) 発見済み。昼間アクセス試みるも3回死亡。スポーナーが危険');
  await sleep(500);
  await bot.chat('[計画] 廃坑チェスト探索継続。sugar_cane探索継続。管理者サポート待ち');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
