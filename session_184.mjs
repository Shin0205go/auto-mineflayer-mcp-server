/**
 * Session 184 - Retreat from Nether, Secure Food, Re-enter
 * 2026-03-17
 *
 * Current state: HP=5, Hunger=4, Pos=(-12,110,2) in soul_sand_valley (Nether)
 * The Nether portal exit is at (-12,110,2) - we are right next to it!
 *
 * PLAN:
 * 1. Connect - bot is in Nether at portal location
 * 2. Step through portal to OW (portal at (-12,110,2))
 * 3. Wait for OW biome confirm
 * 4. Hunt animals for food (doMobLoot may still be disabled - check)
 * 5. If doMobLoot disabled: request admin, wait 60s
 * 6. Once Hunger>=16: navigate to portal (-45,93,87) and enter Nether
 * 7. Navigate to fortress (214,25,-134)
 * 8. Hunt blazes - WATCH HUNGER, retreat if food < 6
 *
 * HUNGER RULES:
 * - If hunger < 6 in Nether: retreat to portal immediately
 * - Check hunger every 3 combat attempts
 * - After Hunger=0: HP drains, death risk
 */

import { mc_connect, mc_status, mc_navigate, mc_chat, mc_eat, mc_combat } from '/Users/shingo/Develop/auto-mineflayer-mcp-server/dist/tools/core-tools.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(label, text) {
  const s = typeof text === 'string' ? text.slice(0, 2000) : JSON.stringify(text).slice(0, 2000);
  console.log(`\n=== ${label} ===\n${s}\n`);
}
async function checkChat() {
  try {
    const r = await mc_chat();
    if (r && r.length > 5 && !r.includes('No new messages')) log('CHAT', r);
    return r || '';
  } catch (e) { return ''; }
}
async function sendChat(msg) {
  try { await mc_chat(msg); console.log('SENT:', msg); }
  catch (e) { }
}
function parseHP(s) { const m = s.match(/"health":\s*(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 20; }
function parseFood(s) { const m = s.match(/"hunger":\s*(\d+)/); return m ? parseInt(m[1]) : 0; }
function parsePos(s) {
  const x = s.match(/"x":\s*(-?\d+(?:\.\d+)?)/), y = s.match(/"y":\s*(-?\d+(?:\.\d+)?)/), z = s.match(/"z":\s*(-?\d+(?:\.\d+)?)/);
  return { x: x ? parseFloat(x[1]) : 0, y: y ? parseFloat(y[1]) : 0, z: z ? parseFloat(z[1]) : 0 };
}
function countBlazeRods(s) {
  const m = s.match(/blaze_rod[^"]*x(\d+)/i); if (m) return parseInt(m[1]);
  return s.includes('blaze_rod') ? 1 : 0;
}
function countEnderPearls(s) {
  const m = s.match(/ender_pearl[^"]*x(\d+)/i); if (m) return parseInt(m[1]);
  return s.includes('ender_pearl') ? 1 : 0;
}
function isInNether(s) {
  return s.includes('"nether_wastes"') || s.includes('"basalt_deltas"') ||
         s.includes('"soul_sand_valley"') || s.includes('"crimson_forest"') ||
         s.includes('"warped_forest"') ||
         s.includes('soul_sand_valley') || s.includes('basalt_deltas') ||
         s.includes('nether_wastes') || s.includes('crimson_forest') ||
         s.includes('warped_forest');
}
function hasFood(s) {
  return s.includes('cooked_') || s.includes('"beef"') || s.includes('"porkchop"') ||
         s.includes('"chicken"') || s.includes('"mutton"') || s.includes('"bread"') ||
         s.includes('rotten_flesh') || s.includes('"apple"');
}
function getBiome(s) {
  const m = s.match(/Current biome:\s*([^\n"]+)/);
  return m ? m[1].trim() : 'unknown';
}

async function main() {
  console.log('=== Session 184: Retreat from Nether, Get Food, Blaze Hunt ===');
  console.log('Start:', new Date().toISOString());

  try {
    const r = await mc_connect({ action: 'connect', host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4' });
    log('CONNECT', r);
  } catch (e) { process.exit(1); }
  await sleep(4000);

  const chatStart = await checkChat();

  let status = await mc_status();
  log('INIT', status);
  let hp = parseHP(status), food = parseFood(status);
  let pos = parsePos(status);
  let rods = countBlazeRods(status), pearls = countEnderPearls(status);
  let inNether = isInNether(status);
  let biome = getBiome(status);

  console.log(`HP=${hp}, Hunger=${food}, Biome=${biome}`);
  console.log(`Pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}), InNether=${inNether}`);
  console.log(`Rods=${rods}/7, Pearls=${pearls}`);
  await sendChat(`[報告] Session 184開始。HP=${hp}, Hunger=${food}, Biome=${biome.slice(0,25)}`);

  // ====== STEP 1: Retreat from Nether if needed ======
  // Bot is at (-12,110,2) - right at the Nether portal
  // Need to step through it to go to OW
  if (inNether) {
    console.log('\n--- Retreating from Nether via portal ---');
    await sendChat('[退避] ネザーからOWへ退避（portal at -12,112,2付近）');

    // The Nether portal exit is at approximately (-12,110,2) in Nether
    // Try to navigate directly to the portal block
    let retreated = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Portal retreat attempt ${attempt}`);
      try {
        // Try to find and use nether_portal block
        const r = await mc_navigate({ target_block: 'nether_portal', max_distance: 30 });
        log(`RETREAT_NAV_${attempt}`, r);
        await sleep(8000); // Wait for teleport
        status = await mc_status();
        biome = getBiome(status);
        inNether = isInNether(status);
        console.log(`After attempt ${attempt}: biome=${biome}, inNether=${inNether}`);
        if (!inNether) { retreated = true; break; }
      } catch (e) {
        console.log(`Retreat attempt ${attempt} error:`, e.message.slice(0, 60));
        // Try coordinate-based approach - stand on the portal block
        try {
          await mc_navigate({ x: -12, y: 110, z: 2, tolerance: 2 });
          await sleep(8000);
          status = await mc_status();
          inNether = isInNether(status);
          if (!inNether) { retreated = true; break; }
        } catch {}
      }
    }

    if (!retreated) {
      console.log('Could not retreat via portal. Trying adjacent portal blocks...');
      // Try standing on various nearby portal positions
      for (const portalPos of [[-12,110,2],[-12,110,3],[-12,110,1],[-13,110,2],[-11,110,2]]) {
        try {
          await mc_navigate({ x: portalPos[0], y: portalPos[1], z: portalPos[2], tolerance: 1 });
          await sleep(8000);
          status = await mc_status();
          inNether = isInNether(status);
          if (!inNether) { retreated = true; break; }
        } catch {}
      }
    }

    if (!retreated) {
      await sendChat('[エラー] ポータル退避失敗！HP=' + hp);
      // Cannot retreat, check if we can survive at all
      status = await mc_status();
      hp = parseHP(status);
      if (hp < 5) {
        await sendChat('[要請] 管理者: /tp Claude1 -45 93 87 でOWに転送してください');
        process.exit(0);
      }
    } else {
      await sendChat('[報告] OW退避成功！食料確保します。');
      await sleep(2000);
    }
  }

  // ====== STEP 2: Get food in OW ======
  status = await mc_status();
  hp = parseHP(status); food = parseFood(status); pos = parsePos(status);
  inNether = isInNether(status);
  biome = getBiome(status);
  console.log(`\nOW state: HP=${hp}, Hunger=${food}, Biome=${biome}, Pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)})`);

  if (!inNether) {
    // Check if food already in inventory
    let foodOk = hasFood(status);
    if (foodOk) {
      console.log('Food in inventory - eating now');
      let eatAttempts = 0;
      while (food < 18 && eatAttempts < 5) {
        eatAttempts++;
        try {
          await mc_eat();
          await sleep(3000);
          status = await mc_status();
          hp = parseHP(status); food = parseFood(status);
          console.log(`After eat ${eatAttempts}: HP=${hp}, Hunger=${food}`);
          if (food >= 18) break;
          if (!hasFood(status)) break;
        } catch {}
      }
    }

    // If still low hunger, hunt animals
    if (food < 16) {
      console.log(`\n--- Hunting animals (hunger=${food}) ---`);
      await sendChat('[行動] 動物狩り。Hunger=' + food);

      let gotFood = false;
      let huntAttempts = 0;

      // Try hunting in multiple areas
      const huntAreas = [
        // Try current area first
        null,
        // Then common animal areas
        [40, 109, 63],
        [-100, 80, 100],
        [100, 80, 100],
        [0, 80, 150],
        [150, 80, 0],
      ];

      for (const area of huntAreas) {
        status = await mc_status();
        hp = parseHP(status); food = parseFood(status);
        if (food >= 16) { gotFood = true; break; }
        if (hp < 5) { await sendChat('[警告] HP=' + hp + '！狩り中断'); break; }

        if (area) {
          console.log(`Moving to hunt area (${area[0]},${area[1]},${area[2]})`);
          try {
            await mc_navigate({ x: area[0], y: area[1], z: area[2], tolerance: 25 });
            await sleep(2000);
          } catch (e) {
            console.log('Area nav err:', e.message.slice(0, 60));
          }
        }

        // Hunt all mobs
        for (const mob of ['cow', 'sheep', 'pig', 'chicken']) {
          status = await mc_status();
          hp = parseHP(status); food = parseFood(status);
          if (food >= 16 || hp < 5) break;

          try {
            console.log(`Hunting ${mob}...`);
            const r = await mc_combat(mob, 6);
            log(`HUNT_${mob}`, r);
            await sleep(2500);
            status = await mc_status();

            if (hasFood(status)) {
              gotFood = true;
              console.log('Got food! Eating...');
              await mc_eat();
              await sleep(3000);
              status = await mc_status();
              hp = parseHP(status); food = parseFood(status);
              console.log(`After eating: HP=${hp}, Hunger=${food}`);
              if (food >= 16) break;
            } else {
              // No food dropped
              huntAttempts++;
              if (huntAttempts === 2) {
                await sendChat('[警告] 動物を倒してもドロップなし。doMobLoot無効の可能性。管理者: /gamerule doMobLoot true');
              }
            }
          } catch (e) {
            const el = e.message.toLowerCase();
            if (!el.includes('no ') && !el.includes('not found')) {
              console.log(`Hunt ${mob} error:`, e.message.slice(0, 60));
            }
          }
        }

        if (gotFood && food >= 16) break;
      }

      // If still no food after hunting
      if (!gotFood || food < 10) {
        console.log(`\nFood situation: food=${food}, gotFood=${gotFood}`);
        await sendChat(`[要請] 食料確保失敗。Hunger=${food}。管理者: /give Claude1 cooked_beef 16`);
        console.log('Waiting 60 seconds for admin...');
        await sleep(60000);
        status = await mc_status();
        hp = parseHP(status); food = parseFood(status);
        console.log(`After wait: HP=${hp}, Hunger=${food}`);

        if (hasFood(status)) {
          await mc_eat();
          await sleep(3000);
          status = await mc_status();
          hp = parseHP(status); food = parseFood(status);
        }

        if (food < 8) {
          await sendChat('[報告] Session 184: 食料不足でネザー行けない。Hunger=' + food);
          process.exit(0);
        }
      }
    }

    // Final food status
    status = await mc_status();
    hp = parseHP(status); food = parseFood(status);
    console.log(`\nPre-Nether: HP=${hp}, Hunger=${food}`);
    await sendChat(`[報告] 食料確保完了。HP=${hp}, Hunger=${food}. ネザーへ！`);
  }

  // ====== STEP 3: Enter Nether ======
  status = await mc_status();
  inNether = isInNether(status);

  if (!inNether) {
    console.log('\n--- Entering Nether ---');

    status = await mc_status();
    hp = parseHP(status); food = parseFood(status);
    if (hp < 8) {
      await sendChat('[報告] HP=' + hp + 'でネザー行けない。');
      process.exit(0);
    }

    await sendChat('[移動] ネザーポータル(-45,93,87)へ。HP=' + hp + ' Hunger=' + food);

    // Navigate to portal
    try {
      const r = await mc_navigate({ x: -45, y: 93, z: 87, tolerance: 5 });
      log('NAV_PORTAL', r);
    } catch (e) {
      console.log('Portal nav err:', e.message.slice(0, 60));
      try { await mc_navigate({ target_block: 'nether_portal', max_distance: 600 }); } catch {}
    }
    await sleep(2000);

    // Step into portal
    await sendChat('[移動] ポータルへ入ります');
    try {
      await mc_navigate({ target_block: 'nether_portal', max_distance: 30 });
    } catch {
      try { await mc_navigate({ x: -44, y: 93, z: 87, tolerance: 1 }); } catch {}
    }
    console.log('Waiting for portal teleport...');
    await sleep(8000);

    status = await mc_status();
    biome = getBiome(status);
    inNether = isInNether(status);
    console.log(`After portal: biome=${biome}, inNether=${inNether}`);

    if (!inNether) {
      // Retry once
      try { await mc_navigate({ target_block: 'nether_portal', max_distance: 30 }); } catch {}
      await sleep(8000);
      status = await mc_status();
      inNether = isInNether(status);
      biome = getBiome(status);
    }

    if (!inNether) {
      await sendChat('[警告] ポータル転送失敗。biome=' + biome);
      process.exit(0);
    }
    await sendChat('[報告] ネザー到達！biome=' + biome);
    await sleep(2000);
  }

  // ====== STEP 4: Navigate to Nether Fortress ======
  await checkChat();
  status = await mc_status();
  hp = parseHP(status); food = parseFood(status); pos = parsePos(status);
  rods = countBlazeRods(status);
  biome = getBiome(status);

  console.log(`\nIn Nether: HP=${hp}, Hunger=${food}, Pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)})`);
  console.log(`Biome: ${biome}`);

  if (!isInNether(status)) {
    await sendChat('[警告] ネザーにいない！');
    process.exit(0);
  }

  if (hp < 6) {
    await sendChat('[緊急] HP危険(' + hp + ')！');
    process.exit(0);
  }

  // Navigate to fortress in stages (current Nether pos is ~(-12,110,2))
  // Fortress is at (214,25,-134)
  // Distance: ~233 blocks
  await sendChat('[移動] 要塞(214,25,-134)へ向かいます。Hunger=' + food);

  const fortressX = 214, fortressY = 25, fortressZ = -134;
  const navSteps = [
    { x: 100, y: 60, z: -70, desc: 'Stage 1 (halfway up)' },
    { x: 180, y: 40, z: -120, desc: 'Stage 2 (near fortress)' },
    { x: 214, y: 30, z: -134, desc: 'Stage 3 (fortress)' },
    { x: 214, y: 25, z: -134, desc: 'Stage 4 (fortress floor)' },
  ];

  for (const step of navSteps) {
    status = await mc_status();
    hp = parseHP(status); food = parseFood(status); pos = parsePos(status);
    if (hp < 6) { await sendChat('[緊急] HP=' + hp + '！中断'); break; }
    if (food < 4) {
      await sendChat('[警告] 空腹(' + food + ')！ネザー探索中断');
      break;
    }

    const dx = step.x - pos.x, dz = step.z - pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 25) { console.log(`Skipping ${step.desc} (already close: ${dist.toFixed(0)})`); continue; }

    console.log(`\nNavigating to ${step.desc}: (${step.x},${step.y},${step.z}), dist=${dist.toFixed(0)}`);
    await sendChat(`[移動] ${step.desc}`);

    try {
      const r = await mc_navigate({ x: step.x, y: step.y, z: step.z, tolerance: 20 });
      log(`NAV_${step.desc.replace(/\s+/g,'_')}`, r);
      await sleep(2000);
      await checkChat();
    } catch (e) {
      console.log(`Nav to ${step.desc} failed:`, e.message.slice(0, 60));
    }
  }

  // Try nether_bricks if still far
  status = await mc_status();
  pos = parsePos(status);
  const dxF = fortressX - pos.x, dzF = fortressZ - pos.z;
  const distToF = Math.sqrt(dxF*dxF + dzF*dzF);
  console.log(`\nDist to fortress: ${distToF.toFixed(0)}`);

  if (distToF > 40) {
    console.log('Still far from fortress, trying nether_bricks search...');
    await sendChat('[探索] nether_bricks探索中...');
    try {
      const r = await mc_navigate({ target_block: 'nether_bricks', max_distance: 500 });
      log('NETHER_BRICKS_SEARCH', r);
      await sleep(2000);
      status = await mc_status();
      pos = parsePos(status);
      const newBiome = getBiome(status);
      await sendChat(`[報告] nether_bricks到達: (${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}) biome=${newBiome}`);
    } catch (e) {
      console.log('nether_bricks search failed:', e.message.slice(0, 60));
      await sendChat('[警告] nether_bricks見つからない。範囲500ブロック内に要塞なし。');
    }
  }

  // ====== STEP 5: Blaze Hunt ======
  await checkChat();
  status = await mc_status();
  hp = parseHP(status); food = parseFood(status); pos = parsePos(status); rods = countBlazeRods(status);
  console.log(`\n--- Blaze Hunt ---`);
  console.log(`HP=${hp}, Hunger=${food}, Rods=${rods}/7, Pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)})`);

  if (hp < 6) { await sendChat('[緊急] HP危険(' + hp + ')！戦闘キャンセル'); process.exit(0); }

  await sendChat(`[戦闘] ブレイズ討伐！HP=${hp}, Hunger=${food}, Rods=${rods}/7`);

  // Exploration positions across the fortress (multiple Y levels)
  const explorePositions = [
    // Current position
    [Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)],
    // Known fortress area at various heights
    [168, 11, -133], [168, 15, -133], [175, 11, -130],
    [185, 11, -125], [195, 11, -130], [205, 11, -130],
    [210, 11, -134], [214, 11, -134], [220, 11, -134],
    [214, 15, -134], [214, 20, -134], [214, 25, -134],
    [220, 25, -130], [210, 25, -140], [225, 25, -125],
    [230, 30, -134], [214, 30, -134], [220, 30, -140],
  ];
  let exploreIdx = 0;
  let huntN = 0;
  let noBlaze = 0;

  while (rods < 7 && huntN < 60) {
    huntN++;
    await checkChat();
    status = await mc_status();
    hp = parseHP(status); rods = countBlazeRods(status); pos = parsePos(status); food = parseFood(status);
    console.log(`\nHunt ${huntN}/60: HP=${hp}, Hunger=${food}, Rods=${rods}/7, Pos=(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)})`);
    if (rods >= 7) break;

    // Critical HP check
    if (hp < 5) {
      await sendChat('[緊急] HP=' + hp + '！ネザー退避！');
      try { await mc_navigate({ x: -12, y: 110, z: 2, tolerance: 60 }); } catch {}
      break;
    }

    // Hunger check - retreat if very low
    if (food < 4) {
      await sendChat('[警告] 空腹(' + food + ')！OWへ退避して食料確保');
      try {
        await mc_navigate({ x: -12, y: 110, z: 2, tolerance: 60 });
        await sleep(3000);
        await mc_navigate({ target_block: 'nether_portal', max_distance: 30 });
        await sleep(8000);
        status = await mc_status();
        if (!isInNether(status)) {
          await sendChat('[報告] OW退避成功。食料確保して再挑戦します。');
        }
      } catch {}
      break;
    }

    // Combat
    try {
      const r = await mc_combat('blaze', 8);
      log(`B${huntN}`, r);
      await sleep(2500);
      const ns = await mc_status();
      const newRods = countBlazeRods(ns);
      if (newRods > rods) {
        rods = newRods; noBlaze = 0;
        await sendChat(`[報告] ブレイズロッド${rods}本！残り${7-rods}本`);
        console.log(`GOT ROD! ${rods}/7`);
      } else {
        // Killed blaze but no rod - doMobLoot disabled?
        const rLow = (r || '').toLowerCase();
        if (rods === 0 && huntN > 3 && (rLow.includes('killed') || rLow.includes('dead'))) {
          await sendChat('[警告] ブレイズを倒してもロッドなし。管理者: /gamerule doMobLoot true');
        }
      }
    } catch (e) {
      const el = e.message.toLowerCase();
      if (el.includes('no ') || el.includes('not found') || el.includes('cannot find')) {
        noBlaze++;
        // Move to next exploration position
        const expPos = explorePositions[exploreIdx % explorePositions.length];
        exploreIdx++;
        console.log(`No blaze (${noBlaze}). Moving to (${expPos[0]},${expPos[1]},${expPos[2]})`);
        if (noBlaze % 3 === 0) {
          await sendChat(`[探索] (${expPos[0]},${expPos[1]},${expPos[2]})`);
        }
        try {
          await mc_navigate({ x: expPos[0], y: expPos[1], z: expPos[2], tolerance: 12 });
          await sleep(1500);
        } catch (ne) {
          try { await mc_navigate({ target_block: 'nether_bricks', max_distance: 300 }); await sleep(1500); } catch {}
        }
      } else if (el.includes('lava')) {
        await sendChat('[緊急] 溶岩！退避！');
        try { await mc_navigate({ x: -12, y: 110, z: 2, tolerance: 60 }); } catch {}
        break;
      }
    }
    await sleep(1200);
  }

  // ====== FINAL ======
  await checkChat();
  const fs = await mc_status();
  log('FINAL', fs);
  const fr = countBlazeRods(fs), fp = countEnderPearls(fs);
  const fh = parseHP(fs), ff = parseFood(fs);
  const fpos = parsePos(fs);
  const fbiome = getBiome(fs);

  console.log(`\n=== Session 184 FINAL ===`);
  console.log(`HP=${fh}, Hunger=${ff}, Rods=${fr}/7, Pearls=${fp}`);
  console.log(`Pos=(${fpos.x.toFixed(0)},${fpos.y.toFixed(0)},${fpos.z.toFixed(0)})`);
  console.log(`Biome=${fbiome}`);

  if (fr >= 7) {
    await sendChat(`[報告] Phase 6 完了！ブレイズロッド${fr}本+エンダーパール${fp}個！Phase 7へ！`);
    console.log('*** PHASE 6 COMPLETE! ***');
  } else {
    await sendChat(`[報告] Session 184終了。Rods=${fr}/7, HP=${fh}, Hunger=${ff}`);
    if (fr === 0) {
      await sendChat('[要請] 管理者: (1)/gamerule doMobLoot true (2)/locate structure minecraft:nether_fortress');
    }
  }

  console.log('End:', new Date().toISOString());
  await sleep(2000);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message, '\n', e.stack); process.exit(1); });
