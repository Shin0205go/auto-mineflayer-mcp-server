/**
 * Self-Improvement Learning System
 *
 * Implements Reflexion pattern:
 * Action → Result → Reflection → Apply to next
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "learning");
const EXPERIENCE_FILE = path.join(DATA_DIR, "experience.jsonl");
const REFLECTION_FILE = path.join(DATA_DIR, "reflection.md");
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

// 場所記憶の型定義
export interface SavedLocation {
  name: string;           // 場所の名前（例: "作業台1", "拠点", "鉄鉱脈"）
  type: string;           // タイプ（crafting_table, furnace, chest, bed, base, resource等）
  x: number;
  y: number;
  z: number;
  note?: string;          // メモ
  savedAt: string;        // 保存日時
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

  save_skill: {
    description: "成功した手順をスキルとして保存。再利用可能にする。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "スキル名（例: 'かまど作成'）" },
        description: { type: "string", description: "スキルの説明" },
        steps: { type: "array", items: { type: "string" }, description: "手順リスト" },
        prerequisites: { type: "array", items: { type: "string" }, description: "前提条件" },
      },
      required: ["name", "description", "steps"],
    },
  },

  get_skills: {
    description: "保存されたスキルを取得。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name_filter: { type: "string", description: "スキル名でフィルタ" },
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

  // === 場所記憶 ===
  remember_location: {
    description: "重要な場所を記憶する。作業台、かまど、チェスト、拠点、鉱脈などを保存して後で戻れるようにする。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "場所の名前（例: '作業台1', '拠点', '鉄鉱脈'）" },
        type: { type: "string", description: "タイプ（crafting_table, furnace, chest, bed, base, resource, other）" },
        x: { type: "number", description: "X座標" },
        y: { type: "number", description: "Y座標" },
        z: { type: "number", description: "Z座標" },
        note: { type: "string", description: "メモ（任意）" },
      },
      required: ["name", "type", "x", "y", "z"],
    },
  },

  recall_locations: {
    description: "保存した場所を思い出す。作業台やかまどの場所を確認できる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        type_filter: { type: "string", description: "タイプでフィルタ（crafting_table, furnace, chest等）" },
        nearest_to_x: { type: "number", description: "この座標に近い順にソート（X）" },
        nearest_to_z: { type: "number", description: "この座標に近い順にソート（Z）" },
      },
    },
  },

  forget_location: {
    description: "保存した場所を削除する。",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "削除する場所の名前" },
      },
      required: ["name"],
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

    case "save_skill": {
      return saveSkill({
        name: args.name as string,
        description: args.description as string,
        steps: args.steps as string[],
        prerequisites: args.prerequisites as string[] | undefined,
      });
    }

    case "get_skills": {
      const nameFilter = args.name_filter as string | undefined;
      const skills = getSkills(nameFilter);

      if (skills.length === 0) {
        return "保存されたスキルがありません。";
      }

      const lines = skills.map(s =>
        `## ${s.name} (使用${s.successCount}回)\n${s.description}\n手順:\n${s.steps.map((st, i) => `  ${i + 1}. ${st}`).join("\n")}`
      );

      return lines.join("\n\n");
    }

    case "get_reflection_insights": {
      return getReflectionInsights();
    }

    // === 場所記憶 ===
    case "remember_location": {
      return rememberLocation({
        name: args.name as string,
        type: args.type as string,
        x: args.x as number,
        y: args.y as number,
        z: args.z as number,
        note: args.note as string | undefined,
      });
    }

    case "recall_locations": {
      const typeFilter = args.type_filter as string | undefined;
      const nearX = args.nearest_to_x as number | undefined;
      const nearZ = args.nearest_to_z as number | undefined;
      const locations = recallLocations(typeFilter, nearX, nearZ);

      if (locations.length === 0) {
        return typeFilter
          ? `タイプ「${typeFilter}」の場所は保存されていません。`
          : "保存された場所はありません。";
      }

      const lines = locations.map(l => {
        const dist = nearX !== undefined && nearZ !== undefined
          ? ` (距離: ${Math.sqrt((l.x - nearX) ** 2 + (l.z - nearZ) ** 2).toFixed(0)}m)`
          : "";
        return `- ${l.name} [${l.type}]: (${l.x}, ${l.y}, ${l.z})${dist}${l.note ? ` - ${l.note}` : ""}`;
      });

      return `保存された場所 (${locations.length}件):\n${lines.join("\n")}`;
    }

    case "forget_location": {
      return forgetLocation(args.name as string);
    }

    default:
      throw new Error(`Unknown learning tool: ${name}`);
  }
}
