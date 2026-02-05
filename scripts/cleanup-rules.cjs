#!/usr/bin/env node
/**
 * ルールファイルのクリーンアップスクリプト
 *
 * - high priorityのみ保持
 * - 重複ルールを削除
 * - 上限50件に制限
 */

const fs = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, '..', 'learning', 'rules.json');
const MAX_RULES = 50;

function main() {
  if (!fs.existsSync(RULES_FILE)) {
    console.log('Rules file not found');
    return;
  }

  const data = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
  const originalCount = data.rules.length;
  console.log(`Original rules: ${originalCount}`);

  // Step 1: Keep only high priority
  let rules = data.rules.filter(r => r.priority === 'high');
  console.log(`After priority filter (high only): ${rules.length}`);

  // Step 2: Remove duplicates (same rule text)
  const seen = new Set();
  rules = rules.filter(r => {
    const key = r.rule.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`After deduplication: ${rules.length}`);

  // Step 3: Limit
  rules = rules.slice(0, MAX_RULES);
  console.log(`After limit (${MAX_RULES}): ${rules.length}`);

  // Save
  const backup = RULES_FILE + '.backup';
  fs.copyFileSync(RULES_FILE, backup);
  console.log(`Backup saved to: ${backup}`);

  data.rules = rules;
  data.version = (data.version || 0) + 1;
  data.lastUpdated = new Date().toISOString();

  fs.writeFileSync(RULES_FILE, JSON.stringify(data, null, 2));
  console.log(`Cleaned up: ${originalCount} -> ${rules.length} rules`);
}

main();
