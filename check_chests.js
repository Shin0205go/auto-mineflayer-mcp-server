const { getBotByUsername } = require('./dist/bot-manager.js');
const Vec3 = require('vec3').Vec3;

const managed = getBotByUsername('Claude5');
if (!managed) {
  console.log('Bot not found');
  process.exit(1);
}

const bot = managed.bot;

// Search for all chests within 10 blocks
const chestPositions = [];
for (let x = -90; x <= -70; x++) {
  for (let y = 75; y <= 85; y++) {
    for (let z = -60; z <= -45; z++) {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (block && block.name === 'chest') {
        chestPositions.push({ x, y, z });
      }
    }
  }
}

console.log('Found chests:', chestPositions);

async function checkChests() {
  for (const pos of chestPositions) {
    try {
      const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
      if (block && block.name === 'chest') {
        const chest = await bot.openContainer(block);
        const items = chest.containerItems();
        console.log(`\nChest at (${pos.x}, ${pos.y}, ${pos.z}):`);
        if (items.length === 0) {
          console.log('  Empty');
        } else {
          items.forEach(item => {
            console.log(`  ${item.name} x${item.count}`);
          });
        }
        chest.close();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.log(`Error checking chest at (${pos.x}, ${pos.y}, ${pos.z}): ${err.message}`);
    }
  }
  process.exit(0);
}

checkChests();
