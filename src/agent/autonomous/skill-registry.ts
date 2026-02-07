/**
 * Skill Registry
 *
 * Defines available skills with their tool sets and context guidance.
 * Skills are the bridge between L2 Tactician decisions and L1 Executor actions.
 */

import type { SkillDefinition } from "./types.js";

const SKILLS: SkillDefinition[] = [
  {
    name: "survival",
    description: "緊急生存行動: 食事、回復、危険回避",
    context: `## survivalスキルガイド
- HP10以下なら即座に食事（minecraft_eat）
- 食料がなければ近くの動物を倒して肉を入手
- 敵が近い場合はまず逃走（minecraft_flee）してから回復
- 安全な場所を確保してから食事
- 装備が外れていれば装着（minecraft_equip_armor, minecraft_equip_weapon）`,
    toolNames: [
      "minecraft_eat",
      "minecraft_flee",
      "minecraft_equip_armor",
      "minecraft_equip_weapon",
      "minecraft_attack",
    ],
  },
  {
    name: "combat",
    description: "戦闘: 敵モブとの戦い、装備切替",
    context: `## combatスキルガイド
- 戦闘前に最強武器を装備（minecraft_equip_weapon）
- 防具も装着（minecraft_equip_armor）
- 攻撃（minecraft_attack）で敵を倒す
- HP5以下になったら逃走（minecraft_flee）
- 複数の敵がいる場合は1体ずつ処理
- スケルトンには接近戦、クリーパーは距離を取って攻撃`,
    toolNames: [
      "minecraft_attack",
      "minecraft_equip_weapon",
      "minecraft_equip_armor",
      "minecraft_flee",
    ],
  },
  {
    name: "mining",
    description: "採掘: 鉱石採掘、ブランチマイニング、松明設置",
    context: `## miningスキルガイド
- 適切なツルハシを装備してから採掘
- ダイヤモンド: Y=-59でブランチマイニング
- 鉄: Y=16付近、洞窟探索も有効
- 石炭: Y=0-128の広い範囲
- 松明は8ブロック間隔で設置
- インベントリ満杯で帰還
- 溶岩に注意: 下を掘る前にシフト
- find_blockで目標鉱石を探してからmove_toで移動`,
    toolNames: [
      "minecraft_dig_block",
      "minecraft_find_block",
      "minecraft_collect_items",
      "minecraft_equip",
      "minecraft_place_block",
    ],
  },
  {
    name: "woodcutting",
    description: "伐採: 木材収集、原木の確保",
    context: `## woodcuttingスキルガイド
- find_blockで近くの原木(oak_log, birch_log等)を探す
- 斧があれば装備して伐採が速くなる
- 下から順に掘って上の原木も落とす
- 苗木があれば植え直す
- 木材は建築・クラフトの基本素材`,
    toolNames: [
      "minecraft_dig_block",
      "minecraft_find_block",
      "minecraft_collect_items",
      "minecraft_equip",
    ],
  },
  {
    name: "crafting",
    description: "クラフト: アイテム作成、装備製作",
    context: `## craftingスキルガイド
- まずcheck_infrastructureで作業台の有無を確認
- 作業台がなければ木材→板材→作業台の順でクラフト
- レシピはminecraft_craftにアイテム名を指定するだけ
- 複雑なアイテムは素材を先に用意
- 装備は作ったらすぐequipで装着
- 精錬が必要ならかまど(furnace)を使用`,
    toolNames: [
      "minecraft_craft",
      "minecraft_get_inventory",
      "minecraft_equip",
      "minecraft_check_infrastructure",
      "minecraft_smelt",
      "minecraft_drop_item",
    ],
  },
  {
    name: "building",
    description: "建築: 構造物の建設、ブロック設置",
    context: `## buildingスキルガイド
- 平坦な場所を確保（minecraft_level_ground）
- ブロックを1つずつ設置（minecraft_place_block）
- 壁→屋根→ドアの順で建設
- 松明を内部に設置してモブ湧き防止
- 素材が不足したらcraftingスキルを要求
- シェルターは最低3x3x3の空間が必要`,
    toolNames: [
      "minecraft_place_block",
      "minecraft_dig_block",
      "minecraft_level_ground",
      "minecraft_collect_items",
      "minecraft_craft",
    ],
  },
  {
    name: "shelter",
    description: "緊急シェルター: 夜間の安全確保、簡易建築",
    context: `## shelterスキルガイド
- 緊急時は地面を3ブロック掘って中に入り、上を塞ぐ
- 余裕があれば壁と屋根のある小屋を建設
- 松明を設置して明るくする
- ドアがあれば設置（ゾンビ対策）
- ベッドがあれば設置して夜をスキップ
- 朝になったら行動再開`,
    toolNames: [
      "minecraft_place_block",
      "minecraft_dig_block",
      "minecraft_craft",
      "minecraft_find_block",
    ],
  },
  {
    name: "exploration",
    description: "探索: 周囲の調査、資源発見、バイオーム探索",
    context: `## explorationスキルガイド
- get_surroundingsで周囲を確認
- find_blockで特定ブロックを探索
- 未知の方向に移動して新しいエリアを発見
- check_infrastructureで設備の位置を確認
- 重要な場所はremember_locationで記録
- 洞窟を発見したら入口を記録してから探索`,
    toolNames: [
      "minecraft_find_block",
      "minecraft_check_infrastructure",
    ],
  },
  {
    name: "farming",
    description: "農業: 作物の植え付け・収穫、食料生産",
    context: `## farmingスキルガイド
- 水源の近くに畑を作る
- クワで土を耕す
- 種を植える（小麦の種、ニンジン等）
- 成長を待つか他の作業をする
- 成熟した作物を収穫（dig_block）
- 収穫後に再植え付け`,
    toolNames: [
      "minecraft_dig_block",
      "minecraft_place_block",
      "minecraft_find_block",
      "minecraft_collect_items",
      "minecraft_equip",
    ],
  },
  {
    name: "smelting",
    description: "精錬: かまどでの鉱石精錬、食料調理",
    context: `## smeltingスキルガイド
- check_infrastructureでかまどの有無を確認
- かまどがなければ丸石8個でクラフト
- minecraft_smeltで精錬開始
- 燃料は石炭・木炭・板材が使える
- 鉄鉱石→鉄インゴット、金鉱石→金インゴット
- 生肉→焼き肉（食料として優秀）`,
    toolNames: [
      "minecraft_smelt",
      "minecraft_check_infrastructure",
      "minecraft_craft",
      "minecraft_equip",
    ],
  },
];

/**
 * Skill Registry - manages available skills
 */
export class SkillRegistry {
  private skills: Map<string, SkillDefinition>;

  constructor() {
    this.skills = new Map();
    for (const skill of SKILLS) {
      this.skills.set(skill.name, skill);
    }
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill names and descriptions for L2 Tactician (no tool details)
   */
  getSummary(): string {
    return this.getAll()
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
  }

  /**
   * Get tool names for a set of active skills (deduplicated)
   */
  getToolNames(activeSkills: Set<string>): string[] {
    const tools = new Set<string>();
    for (const skillName of activeSkills) {
      const skill = this.skills.get(skillName);
      if (skill) {
        for (const tool of skill.toolNames) {
          tools.add(tool);
        }
      }
    }
    return Array.from(tools);
  }

  /**
   * Get context text for active skills (for Executor system prompt)
   */
  getContexts(activeSkills: Set<string>): string {
    const contexts: string[] = [];
    for (const skillName of activeSkills) {
      const skill = this.skills.get(skillName);
      if (skill) {
        contexts.push(skill.context);
      }
    }
    return contexts.join("\n\n");
  }
}
