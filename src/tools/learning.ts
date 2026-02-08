/**
 * Self-Improvement Learning System
 *
 * Implements Reflexion pattern:
 * Action → Result → Reflection → Apply to next
 *
 * Memory API: Unified storage for locations, rules, insights
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "learning");
const EXPERIENCE_FILE = path.join(DATA_DIR, "experience.jsonl");
const REFLECTION_FILE = path.join(DATA_DIR, "reflection.md");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
// Legacy files (for migration)
const SKILL_LIBRARY_FILE = path.join(DATA_DIR, "skills.json");
const LOCATIONS_FILE = path.join(DATA_DIR, "locations.json");

// 学習ディレクトリを確保
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 経験の型定義
export interface Experience {
  timestamp: string;
  action: string;           // 実行した行動
  result: string;           // 結果（成功/失敗）
  context: string;          // 状況（装備、HP、場所など）
  outcome: "success" | "failure" | "partial";
  learning?: string;        // 得られた学び
  tags?: string[];          // タグ（crafting, mining, combat等）
}

// スキルの型定義
export interface Skill {
  name: string;
  description: string;
  steps: string[];
  prerequisites?: string[];
  successCount: number;
  lastUsed: string;
}

// 場所記憶の型定義 (legacy, for migration)
export interface SavedLocation {
  name: string;
  type: string;
  x: number;
  y: number;
  z: number;
  note?: string;
  savedAt: string;
}

// === Unified Memory API ===
export type MemoryType = "location" | "rule" | "insight";

export interface LocationData {
  x: number;
  y: number;
  z: number;
  locationType: string;  // crafting_table, furnace, chest, bed, base, resource
}

export interface RuleData {
  description: string;
  steps: string[];
  prerequisites?: string[];
}

export interface InsightData {
  content: string;
  source?: string;  // reflection, experience, etc.
}

export interface Memory {
  id: string;
  type: MemoryType;
  name: string;
  data: LocationData | RuleData | InsightData;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  usedCount: number;
}

// MCPツール定義
export const learningTools = {
  log_experience: {
    description: "行動と結果を経験ログに記録。自己学習のため、重要な行動後に呼ぶ。",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "実行した行動（例: 'oak_logを採掘'）" },
        result: { type: "string", description: "結果（例: '成功、oak_log x4 取得'）" },
        context: { type: "string", description: "状況（例: 'HP:20, 木の斧装備, 森バイオーム'）" },
        outcome: { type: "string", enum: ["success", "failure", "partial"], description: "成功/失敗/部分的成功" },
        learning: { type: "string", description: "得られた学び（任意）" },
        tags: { type: "array", items: { type: "string" }, description: "タグ（crafting, mining等）" },
      },
      required: ["action", "result", "context", "outcome"],
    },
  },

  get_recent_experiences: {
    description: "最近の経験ログを取得。振り返りや戦略立案に使用。",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "取得件数（デフォルト20）" },
        outcome_filter: { type: "string", enum: ["success", "failure", "partial", "all"], description: "結果でフィルタ" },
        tag_filter: { type: "string", description: "タグでフィルタ（例: 'mining'）" },
      },
    },
  },

  reflect_and_learn: {
    description: "経験を振り返り、パターンを分析して学びを抽出。定期的に（10ループごと等）呼ぶ。",
    inputSchema: {
      type: "object" as const,
      properties: {
        focus_area: { type: "string", description: "特に分析したい領域（mining, crafting, combat等）" },
      },
    },
  },

  get_reflection_insights: {
    description: "これまでの振り返りで得られた知見を取得。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  // === Unified Memory API ===
  save_memory: {
    description: "場所・ルール・知見を統一メモリに保存。type: location(座標), rule(手順), insight(学び)",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["location", "rule", "insight"],
          description: "メモリタイプ"
        },
        name: { type: "string", description: "名前（例: '拠点', 'かまど作成', '夜の生存術'）" },
        // Location data
        x: { type: "number", description: "[location] X座標" },
        y: { type: "number", description: "[location] Y座標" },
        z: { type: "number", description: "[location] Z座標" },
        locationType: { type: "string", description: "[location] 場所タイプ（crafting_table, furnace, chest, bed, base, resource）" },
        // Rule data
        description: { type: "string", description: "[rule/insight] 説明" },
        steps: { type: "array", items: { type: "string" }, description: "[rule] 手順リスト" },
        prerequisites: { type: "array", items: { type: "string" }, description: "[rule] 前提条件" },
        // Common
        tags: { type: "array", items: { type: "string" }, description: "タグ（任意）" },
      },
      required: ["type", "name"],
    },
  },

  recall_memory: {
    description: "保存したメモリを取得。場所・ルール・知見を検索。",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["location", "rule", "insight", "all"], description: "タイプでフィルタ（デフォルト: all）" },
        name_filter: { type: "string", description: "名前で部分一致検索" },
        tag_filter: { type: "string", description: "タグでフィルタ" },
        location_type: { type: "string", description: "[location] 場所タイプでフィルタ" },
        nearest_to_x: { type: "number", description: "[location] この座標に近い順にソート" },
        nearest_to_z: { type: "number", description: "[location] この座標に近い順にソート" },
        limit: { type: "number", description: "最大件数（デフォルト20）" },
      },
    },
  },

  forget_memory: {
    description: "保存したメモリを削除。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "削除するメモリの名前" },
        type: { type: "string", enum: ["location", "rule", "insight"], description: "タイプ（同名が複数ある場合）" },
      },
      required: ["name"],
    },
  },

  // === Agent Skills ===
  list_agent_skills: {
    description: "利用可能なエージェントスキル一覧を取得。状況に応じて適切なスキルを選ぶ参考に。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  get_agent_skill: {
    description: "指定したスキルの詳細を取得。スキルの知識に従って行動するために使用。",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_name: { type: "string", description: "スキル名（例: 'iron-mining', 'food-hunting', 'combat-basics'）" },
      },
      required: ["skill_name"],
    },
  },
};

/**
 * 経験をログに追加
 */
export function logExperience(exp: Omit<Experience, "timestamp">): string {
  ensureDataDir();

  const experience: Experience = {
    ...exp,
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(experience) + "\n";
  fs.appendFileSync(EXPERIENCE_FILE, line);

  return `経験を記録しました: ${exp.action} → ${exp.outcome}`;
}

/**
 * 最近の経験を取得
 */
export function getRecentExperiences(
  limit: number = 20,
  outcomeFilter?: "success" | "failure" | "partial" | "all",
  tagFilter?: string
): Experience[] {
  ensureDataDir();

  if (!fs.existsSync(EXPERIENCE_FILE)) {
    return [];
  }

  const content = fs.readFileSync(EXPERIENCE_FILE, "utf-8");
  const lines = content.trim().split("\n").filter(l => l);

  let experiences: Experience[] = lines.map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(e => e !== null);

  // フィルタリング
  if (outcomeFilter && outcomeFilter !== "all") {
    experiences = experiences.filter(e => e.outcome === outcomeFilter);
  }

  if (tagFilter) {
    experiences = experiences.filter(e => e.tags?.includes(tagFilter));
  }

  // 最新からlimit件取得
  return experiences.slice(-limit).reverse();
}

/**
 * 振り返りを実行して知見を抽出
 */
export function reflectAndLearn(focusArea?: string): string {
  ensureDataDir();

  const experiences = getRecentExperiences(50, "all");

  if (experiences.length === 0) {
    return "経験ログがまだありません。行動を記録してから振り返りを行ってください。";
  }

  // 統計を計算
  const stats = {
    total: experiences.length,
    success: experiences.filter(e => e.outcome === "success").length,
    failure: experiences.filter(e => e.outcome === "failure").length,
    partial: experiences.filter(e => e.outcome === "partial").length,
  };

  // タグ別の成功率
  const tagStats: Record<string, { success: number; total: number }> = {};
  for (const exp of experiences) {
    for (const tag of exp.tags || []) {
      if (!tagStats[tag]) {
        tagStats[tag] = { success: 0, total: 0 };
      }
      tagStats[tag].total++;
      if (exp.outcome === "success") {
        tagStats[tag].success++;
      }
    }
  }

  // 失敗パターンを抽出
  const failures = experiences.filter(e => e.outcome === "failure");
  const failurePatterns: Record<string, number> = {};
  for (const f of failures) {
    const key = f.action.split(" ")[0]; // 最初の単語でグループ化
    failurePatterns[key] = (failurePatterns[key] || 0) + 1;
  }

  // レポート生成
  const timestamp = new Date().toLocaleString("ja-JP");
  let report = `## 振り返りレポート (${timestamp})\n\n`;

  report += `### 全体統計\n`;
  report += `- 総行動数: ${stats.total}\n`;
  report += `- 成功: ${stats.success} (${(stats.success / stats.total * 100).toFixed(1)}%)\n`;
  report += `- 失敗: ${stats.failure} (${(stats.failure / stats.total * 100).toFixed(1)}%)\n`;
  report += `- 部分的成功: ${stats.partial}\n\n`;

  report += `### カテゴリ別成功率\n`;
  for (const [tag, stat] of Object.entries(tagStats)) {
    const rate = (stat.success / stat.total * 100).toFixed(1);
    report += `- ${tag}: ${rate}% (${stat.success}/${stat.total})\n`;
  }
  report += "\n";

  if (Object.keys(failurePatterns).length > 0) {
    report += `### よくある失敗\n`;
    const sorted = Object.entries(failurePatterns).sort((a, b) => b[1] - a[1]);
    for (const [pattern, count] of sorted.slice(0, 5)) {
      report += `- ${pattern}: ${count}回\n`;
    }
    report += "\n";
  }

  // 学びをまとめる
  const learnings = experiences
    .filter(e => e.learning)
    .map(e => e.learning!)
    .slice(-10);

  if (learnings.length > 0) {
    report += `### 最近の学び\n`;
    for (const learning of learnings) {
      report += `- ${learning}\n`;
    }
    report += "\n";
  }

  // reflection.mdに追記
  fs.appendFileSync(REFLECTION_FILE, report + "\n---\n\n");

  return report;
}

/**
 * スキルを保存
 */
export function saveSkill(skill: Omit<Skill, "successCount" | "lastUsed">): string {
  ensureDataDir();

  let skills: Skill[] = [];
  if (fs.existsSync(SKILL_LIBRARY_FILE)) {
    try {
      skills = JSON.parse(fs.readFileSync(SKILL_LIBRARY_FILE, "utf-8"));
    } catch {
      skills = [];
    }
  }

  // 既存スキルを更新または新規追加
  const existingIndex = skills.findIndex(s => s.name === skill.name);
  const newSkill: Skill = {
    ...skill,
    successCount: existingIndex >= 0 ? skills[existingIndex].successCount + 1 : 1,
    lastUsed: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    skills[existingIndex] = newSkill;
  } else {
    skills.push(newSkill);
  }

  fs.writeFileSync(SKILL_LIBRARY_FILE, JSON.stringify(skills, null, 2));

  return `スキル「${skill.name}」を保存しました（使用回数: ${newSkill.successCount}）`;
}

/**
 * スキルを取得
 */
export function getSkills(nameFilter?: string): Skill[] {
  ensureDataDir();

  if (!fs.existsSync(SKILL_LIBRARY_FILE)) {
    return [];
  }

  try {
    const skills: Skill[] = JSON.parse(fs.readFileSync(SKILL_LIBRARY_FILE, "utf-8"));

    if (nameFilter) {
      return skills.filter(s =>
        s.name.toLowerCase().includes(nameFilter.toLowerCase())
      );
    }

    return skills;
  } catch {
    return [];
  }
}

/**
 * 振り返り知見を取得
 */
export function getReflectionInsights(): string {
  ensureDataDir();

  if (!fs.existsSync(REFLECTION_FILE)) {
    return "振り返りの記録がまだありません。reflect_and_learnを実行してください。";
  }

  const content = fs.readFileSync(REFLECTION_FILE, "utf-8");

  // 最新3つのレポートを返す
  const reports = content.split("---").filter(r => r.trim());
  return reports.slice(-3).join("\n---\n");
}

/**
 * 場所を記憶する
 */
export function rememberLocation(location: Omit<SavedLocation, "savedAt">): string {
  ensureDataDir();

  let locations: SavedLocation[] = [];
  if (fs.existsSync(LOCATIONS_FILE)) {
    try {
      locations = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));
    } catch {
      locations = [];
    }
  }

  // 同じ名前があれば更新
  const existingIndex = locations.findIndex(l => l.name === location.name);
  const newLocation: SavedLocation = {
    ...location,
    savedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    locations[existingIndex] = newLocation;
  } else {
    locations.push(newLocation);
  }

  fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 2));
  return `場所「${location.name}」を記憶しました: (${location.x}, ${location.y}, ${location.z}) [${location.type}]`;
}

/**
 * 記憶した場所を取得
 */
export function recallLocations(
  typeFilter?: string,
  nearestToX?: number,
  nearestToZ?: number
): SavedLocation[] {
  ensureDataDir();

  if (!fs.existsSync(LOCATIONS_FILE)) {
    return [];
  }

  try {
    let locations: SavedLocation[] = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));

    // タイプフィルタ
    if (typeFilter) {
      locations = locations.filter(l => l.type === typeFilter || l.type.includes(typeFilter));
    }

    // 距離でソート
    if (nearestToX !== undefined && nearestToZ !== undefined) {
      locations.sort((a, b) => {
        const distA = Math.sqrt((a.x - nearestToX) ** 2 + (a.z - nearestToZ) ** 2);
        const distB = Math.sqrt((b.x - nearestToX) ** 2 + (b.z - nearestToZ) ** 2);
        return distA - distB;
      });
    }

    return locations;
  } catch {
    return [];
  }
}

/**
 * 場所を削除
 */
export function forgetLocation(name: string): string {
  ensureDataDir();

  if (!fs.existsSync(LOCATIONS_FILE)) {
    return `場所「${name}」は見つかりませんでした`;
  }

  try {
    let locations: SavedLocation[] = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));
    const before = locations.length;
    locations = locations.filter(l => l.name !== name);

    if (locations.length === before) {
      return `場所「${name}」は見つかりませんでした`;
    }

    fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 2));
    return `場所「${name}」を削除しました`;
  } catch {
    return `場所「${name}」の削除に失敗しました`;
  }
}

// === Unified Memory API Implementation ===

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function loadMemories(): Memory[] {
  ensureDataDir();
  if (!fs.existsSync(MEMORY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveMemories(memories: Memory[]): void {
  ensureDataDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
}

/**
 * Migrate legacy data to unified memory
 */
export function migrateToMemoryAPI(): string {
  const migrated: string[] = [];

  // Migrate locations
  if (fs.existsSync(LOCATIONS_FILE)) {
    try {
      const locations: SavedLocation[] = JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf-8"));
      const memories = loadMemories();
      for (const loc of locations) {
        if (!memories.find(m => m.type === "location" && m.name === loc.name)) {
          memories.push({
            id: generateId(),
            type: "location",
            name: loc.name,
            data: {
              x: loc.x,
              y: loc.y,
              z: loc.z,
              locationType: loc.type,
            } as LocationData,
            tags: [loc.type],
            createdAt: loc.savedAt,
            updatedAt: loc.savedAt,
            usedCount: 0,
          });
        }
      }
      saveMemories(memories);
      migrated.push(`locations: ${locations.length}件`);
    } catch { /* ignore */ }
  }

  // Migrate skills/rules
  if (fs.existsSync(SKILL_LIBRARY_FILE)) {
    try {
      const skills: Skill[] = JSON.parse(fs.readFileSync(SKILL_LIBRARY_FILE, "utf-8"));
      const memories = loadMemories();
      for (const skill of skills) {
        if (!memories.find(m => m.type === "rule" && m.name === skill.name)) {
          memories.push({
            id: generateId(),
            type: "rule",
            name: skill.name,
            data: {
              description: skill.description,
              steps: skill.steps,
              prerequisites: skill.prerequisites,
            } as RuleData,
            createdAt: skill.lastUsed,
            updatedAt: skill.lastUsed,
            usedCount: skill.successCount,
          });
        }
      }
      saveMemories(memories);
      migrated.push(`rules: ${skills.length}件`);
    } catch { /* ignore */ }
  }

  return migrated.length > 0
    ? `マイグレーション完了: ${migrated.join(", ")}`
    : "マイグレーション対象なし";
}

/**
 * Save memory (location, rule, or insight)
 */
export function saveMemory(args: {
  type: MemoryType;
  name: string;
  x?: number;
  y?: number;
  z?: number;
  locationType?: string;
  description?: string;
  steps?: string[];
  prerequisites?: string[];
  tags?: string[];
}): string {
  const memories = loadMemories();
  const now = new Date().toISOString();

  let data: LocationData | RuleData | InsightData;

  if (args.type === "location") {
    if (args.x === undefined || args.y === undefined || args.z === undefined) {
      return "エラー: location には x, y, z が必要です";
    }
    data = {
      x: args.x,
      y: args.y,
      z: args.z,
      locationType: args.locationType || "other",
    };
  } else if (args.type === "rule") {
    if (!args.description || !args.steps) {
      return "エラー: rule には description と steps が必要です";
    }
    data = {
      description: args.description,
      steps: args.steps,
      prerequisites: args.prerequisites,
    };
  } else {
    // insight
    data = {
      content: args.description || "",
      source: "manual",
    };
  }

  // Update existing or create new
  const existing = memories.findIndex(m => m.type === args.type && m.name === args.name);
  if (existing >= 0) {
    memories[existing].data = data;
    memories[existing].updatedAt = now;
    memories[existing].usedCount++;
    if (args.tags) memories[existing].tags = args.tags;
  } else {
    memories.push({
      id: generateId(),
      type: args.type,
      name: args.name,
      data,
      tags: args.tags || (args.type === "location" && args.locationType ? [args.locationType] : undefined),
      createdAt: now,
      updatedAt: now,
      usedCount: 1,
    });
  }

  saveMemories(memories);

  if (args.type === "location") {
    const loc = data as LocationData;
    return `メモリ保存: ${args.name} [${args.type}] (${loc.x}, ${loc.y}, ${loc.z})`;
  }
  return `メモリ保存: ${args.name} [${args.type}]`;
}

/**
 * Recall memories with filters
 */
export function recallMemory(args: {
  type?: MemoryType | "all";
  name_filter?: string;
  tag_filter?: string;
  location_type?: string;
  nearest_to_x?: number;
  nearest_to_z?: number;
  limit?: number;
}): Memory[] {
  let memories = loadMemories();

  // Type filter
  if (args.type && args.type !== "all") {
    memories = memories.filter(m => m.type === args.type);
  }

  // Name filter
  if (args.name_filter) {
    const filter = args.name_filter.toLowerCase();
    memories = memories.filter(m => m.name.toLowerCase().includes(filter));
  }

  // Tag filter
  if (args.tag_filter) {
    memories = memories.filter(m => m.tags?.includes(args.tag_filter!));
  }

  // Location type filter
  if (args.location_type) {
    memories = memories.filter(m => {
      if (m.type !== "location") return false;
      const loc = m.data as LocationData;
      return loc.locationType === args.location_type || loc.locationType?.includes(args.location_type!);
    });
  }

  // Sort by distance for locations
  if (args.nearest_to_x !== undefined && args.nearest_to_z !== undefined) {
    memories.sort((a, b) => {
      if (a.type !== "location" && b.type !== "location") return 0;
      if (a.type !== "location") return 1;
      if (b.type !== "location") return -1;
      const locA = a.data as LocationData;
      const locB = b.data as LocationData;
      const distA = Math.sqrt((locA.x - args.nearest_to_x!) ** 2 + (locA.z - args.nearest_to_z!) ** 2);
      const distB = Math.sqrt((locB.x - args.nearest_to_x!) ** 2 + (locB.z - args.nearest_to_z!) ** 2);
      return distA - distB;
    });
  }

  // Limit
  const limit = args.limit || 20;
  return memories.slice(0, limit);
}

/**
 * Forget (delete) a memory
 */
export function forgetMemory(name: string, type?: MemoryType): string {
  const memories = loadMemories();
  const before = memories.length;

  const filtered = memories.filter(m => {
    if (m.name !== name) return true;
    if (type && m.type !== type) return true;
    return false;
  });

  if (filtered.length === before) {
    return `メモリ「${name}」が見つかりません`;
  }

  saveMemories(filtered);
  return `メモリ「${name}」を削除しました`;
}

// === Agent Skills ===
const SKILLS_DIR = path.join(process.cwd(), ".claude", "skills");

interface AgentSkillInfo {
  name: string;
  description: string;
}

/**
 * .claude/skills/ から利用可能なスキル一覧を取得
 */
export function listAgentSkills(): AgentSkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }

  const skills: AgentSkillInfo[] = [];
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const skillPath = path.join(SKILLS_DIR, dir.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;

    try {
      const content = fs.readFileSync(skillPath, "utf-8");
      // YAML frontmatter から description を抽出
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const descMatch = yamlMatch[1].match(/description:\s*\|?\s*\n?\s*(.+?)(?:\n\s{2,}|$)/s);
        const desc = descMatch ? descMatch[1].trim().split("\n")[0] : "";
        skills.push({ name: dir.name, description: desc });
      } else {
        skills.push({ name: dir.name, description: "" });
      }
    } catch {
      skills.push({ name: dir.name, description: "" });
    }
  }

  return skills;
}

/**
 * 指定したスキルの内容を取得
 */
export function getAgentSkill(skillName: string): string {
  const skillPath = path.join(SKILLS_DIR, skillName, "SKILL.md");

  if (!fs.existsSync(skillPath)) {
    // 部分一致を試す
    if (fs.existsSync(SKILLS_DIR)) {
      const dirs = fs.readdirSync(SKILLS_DIR);
      const match = dirs.find(d => d.includes(skillName) || skillName.includes(d));
      if (match) {
        const matchPath = path.join(SKILLS_DIR, match, "SKILL.md");
        if (fs.existsSync(matchPath)) {
          return fs.readFileSync(matchPath, "utf-8");
        }
      }
    }
    return `スキル「${skillName}」が見つかりません。list_agent_skills で一覧を確認してください。`;
  }

  return fs.readFileSync(skillPath, "utf-8");
}

/**
 * 学習ツールのハンドラー
 */
export async function handleLearningTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "log_experience": {
      return logExperience({
        action: args.action as string,
        result: args.result as string,
        context: args.context as string,
        outcome: args.outcome as "success" | "failure" | "partial",
        learning: args.learning as string | undefined,
        tags: args.tags as string[] | undefined,
      });
    }

    case "get_recent_experiences": {
      const limit = (args.limit as number) || 20;
      const outcomeFilter = args.outcome_filter as "success" | "failure" | "partial" | "all" | undefined;
      const tagFilter = args.tag_filter as string | undefined;

      const experiences = getRecentExperiences(limit, outcomeFilter, tagFilter);

      if (experiences.length === 0) {
        return "経験ログがありません。";
      }

      const lines = experiences.map(e =>
        `[${e.outcome}] ${e.action} → ${e.result}${e.learning ? ` (学び: ${e.learning})` : ""}`
      );

      return `最近の経験 (${experiences.length}件):\n${lines.join("\n")}`;
    }

    case "reflect_and_learn": {
      const focusArea = args.focus_area as string | undefined;
      return reflectAndLearn(focusArea);
    }

    case "get_reflection_insights": {
      return getReflectionInsights();
    }

    // === Unified Memory API ===
    case "save_memory": {
      return saveMemory({
        type: args.type as MemoryType,
        name: args.name as string,
        x: args.x as number | undefined,
        y: args.y as number | undefined,
        z: args.z as number | undefined,
        locationType: args.locationType as string | undefined,
        description: args.description as string | undefined,
        steps: args.steps as string[] | undefined,
        prerequisites: args.prerequisites as string[] | undefined,
        tags: args.tags as string[] | undefined,
      });
    }

    case "recall_memory": {
      const memories = recallMemory({
        type: args.type as MemoryType | "all" | undefined,
        name_filter: args.name_filter as string | undefined,
        tag_filter: args.tag_filter as string | undefined,
        location_type: args.location_type as string | undefined,
        nearest_to_x: args.nearest_to_x as number | undefined,
        nearest_to_z: args.nearest_to_z as number | undefined,
        limit: args.limit as number | undefined,
      });

      if (memories.length === 0) {
        return "メモリが見つかりません。";
      }

      const lines = memories.map(m => {
        if (m.type === "location") {
          const loc = m.data as LocationData;
          return `- [location] ${m.name}: (${loc.x}, ${loc.y}, ${loc.z}) [${loc.locationType}]`;
        } else if (m.type === "rule") {
          const rule = m.data as RuleData;
          return `- [rule] ${m.name}: ${rule.description} (${rule.steps.length}手順)`;
        } else {
          const insight = m.data as InsightData;
          return `- [insight] ${m.name}: ${insight.content.slice(0, 50)}...`;
        }
      });

      return `メモリ (${memories.length}件):\n${lines.join("\n")}`;
    }

    case "forget_memory": {
      return forgetMemory(
        args.name as string,
        args.type as MemoryType | undefined
      );
    }

    case "migrate_memory": {
      return migrateToMemoryAPI();
    }

    // === Legacy (backward compatibility) ===
    case "save_rule": {
      // Redirect to save_memory
      return saveMemory({
        type: "rule",
        name: args.name as string,
        description: args.description as string,
        steps: args.steps as string[],
        prerequisites: args.prerequisites as string[] | undefined,
      });
    }

    case "get_rules": {
      const memories = recallMemory({ type: "rule", name_filter: args.name_filter as string | undefined });
      if (memories.length === 0) {
        return "保存された学習ルールがありません。";
      }
      const lines = memories.map(m => {
        const rule = m.data as RuleData;
        return `## ${m.name} (使用${m.usedCount}回)\n${rule.description}\n手順:\n${rule.steps.map((st, i) => `  ${i + 1}. ${st}`).join("\n")}`;
      });
      return lines.join("\n\n");
    }

    case "remember_location": {
      // Redirect to save_memory
      return saveMemory({
        type: "location",
        name: args.name as string,
        x: args.x as number,
        y: args.y as number,
        z: args.z as number,
        locationType: args.type as string,
      });
    }

    case "recall_locations": {
      const memories = recallMemory({
        type: "location",
        location_type: args.type_filter as string | undefined,
        nearest_to_x: args.nearest_to_x as number | undefined,
        nearest_to_z: args.nearest_to_z as number | undefined,
        limit: args.limit as number | undefined,
      });

      if (memories.length === 0) {
        return "保存された場所はありません。";
      }

      const nearX = args.nearest_to_x as number | undefined;
      const nearZ = args.nearest_to_z as number | undefined;

      const lines = memories.map(m => {
        const loc = m.data as LocationData;
        const dist = nearX !== undefined && nearZ !== undefined
          ? ` (距離: ${Math.sqrt((loc.x - nearX) ** 2 + (loc.z - nearZ) ** 2).toFixed(0)}m)`
          : "";
        return `- ${m.name} [${loc.locationType}]: (${loc.x}, ${loc.y}, ${loc.z})${dist}`;
      });

      return `保存された場所 (${memories.length}件):\n${lines.join("\n")}`;
    }

    case "forget_location": {
      return forgetMemory(args.name as string, "location");
    }

    // === Agent Skills ===
    case "list_agent_skills": {
      const skills = listAgentSkills();
      if (skills.length === 0) {
        return "エージェントスキルがありません。";
      }
      const lines = skills.map(s => `- **${s.name}**: ${s.description}`);
      return `利用可能なスキル (${skills.length}個):\n${lines.join("\n")}\n\n使用例: get_agent_skill { skill_name: "iron-mining" }`;
    }

    case "get_agent_skill": {
      const skillName = args.skill_name as string;
      return getAgentSkill(skillName);
    }

    default:
      throw new Error(`Unknown learning tool: ${name}`);
  }
}
