/**
 * Shared Reward System
 *
 * Server-side reward tracking accessible by all agents (Claude, Gemini, etc.)
 */

export interface ExplorationState {
  visitedPositions: Set<string>;
  discoveredBlocks: Set<string>;
  totalDistance: number;
  lastPosition: { x: number; y: number; z: number } | null;
  structuresBuilt: number;
  blocksPlaced: number;
  agentContributions: Map<string, number>;  // Track per-agent contributions
}

export interface RewardBreakdown {
  exploration: number;
  discovery: number;
  distance: number;
  structures: number;
  blocks: number;
  total: number;
  contributors: Record<string, number>;
}

const WEIGHTS = {
  NEW_POSITION: 1.0,
  NEW_BLOCK_TYPE: 5.0,
  DISTANCE: 0.1,
  STRUCTURE: 20.0,
  BLOCK_PLACED: 0.5,
};

class SharedRewardSystem {
  private state: ExplorationState;

  constructor() {
    this.state = {
      visitedPositions: new Set(),
      discoveredBlocks: new Set(),
      totalDistance: 0,
      lastPosition: null,
      structuresBuilt: 0,
      blocksPlaced: 0,
      agentContributions: new Map(),
    };
  }

  private addContribution(agentName: string, points: number): void {
    const current = this.state.agentContributions.get(agentName) || 0;
    this.state.agentContributions.set(agentName, current + points);
  }

  updatePosition(x: number, y: number, z: number, agentName: string = 'unknown'): number {
    const posKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    let pointsEarned = 0;

    // New position bonus
    if (!this.state.visitedPositions.has(posKey)) {
      this.state.visitedPositions.add(posKey);
      pointsEarned += WEIGHTS.NEW_POSITION;
    }

    // Distance bonus
    if (this.state.lastPosition) {
      const dx = x - this.state.lastPosition.x;
      const dy = y - this.state.lastPosition.y;
      const dz = z - this.state.lastPosition.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      this.state.totalDistance += dist;
      pointsEarned += dist * WEIGHTS.DISTANCE;
    }

    this.state.lastPosition = { x, y, z };

    if (pointsEarned > 0) {
      this.addContribution(agentName, pointsEarned);
    }

    return pointsEarned;
  }

  updateDiscoveredBlocks(blockTypes: string[], agentName: string = 'unknown'): number {
    let pointsEarned = 0;

    for (const blockType of blockTypes) {
      if (!this.state.discoveredBlocks.has(blockType)) {
        this.state.discoveredBlocks.add(blockType);
        pointsEarned += WEIGHTS.NEW_BLOCK_TYPE;
      }
    }

    if (pointsEarned > 0) {
      this.addContribution(agentName, pointsEarned);
    }

    return pointsEarned;
  }

  recordStructureBuilt(agentName: string = 'unknown'): number {
    this.state.structuresBuilt++;
    const points = WEIGHTS.STRUCTURE;
    this.addContribution(agentName, points);
    return points;
  }

  recordBlockPlaced(agentName: string = 'unknown'): number {
    this.state.blocksPlaced++;
    const points = WEIGHTS.BLOCK_PLACED;
    this.addContribution(agentName, points);
    return points;
  }

  calculateReward(): RewardBreakdown {
    const exploration = this.state.visitedPositions.size * WEIGHTS.NEW_POSITION;
    const discovery = this.state.discoveredBlocks.size * WEIGHTS.NEW_BLOCK_TYPE;
    const distance = this.state.totalDistance * WEIGHTS.DISTANCE;
    const structures = this.state.structuresBuilt * WEIGHTS.STRUCTURE;
    const blocks = this.state.blocksPlaced * WEIGHTS.BLOCK_PLACED;

    const contributors: Record<string, number> = {};
    this.state.agentContributions.forEach((points, agent) => {
      contributors[agent] = Math.round(points * 10) / 10;
    });

    return {
      exploration,
      discovery,
      distance,
      structures,
      blocks,
      total: exploration + discovery + distance + structures + blocks,
      contributors,
    };
  }

  getStateSummary(): string {
    const reward = this.calculateReward();

    const contributorList = Object.entries(reward.contributors)
      .sort((a, b) => b[1] - a[1])
      .map(([agent, points]) => `  - ${agent}: ${points}点`)
      .join('\n');

    return `
## 🏆 探索スコア: ${reward.total.toFixed(1)}点

### 内訳
- 訪問地点: ${this.state.visitedPositions.size}箇所 (+${reward.exploration.toFixed(1)})
- 発見ブロック: ${this.state.discoveredBlocks.size}種類 (+${reward.discovery.toFixed(1)})
- 移動距離: ${this.state.totalDistance.toFixed(1)}m (+${reward.distance.toFixed(1)})
- 建築物: ${this.state.structuresBuilt}個 (+${reward.structures.toFixed(1)})
- 設置ブロック: ${this.state.blocksPlaced}個 (+${reward.blocks.toFixed(1)})

### 貢献度
${contributorList || '  (まだ貢献なし)'}

目標: チームでスコアを最大化せよ！
`.trim();
  }

  getStateForAgent(agentName: string): string {
    const reward = this.calculateReward();
    const myContribution = reward.contributors[agentName] || 0;
    const totalContribution = Object.values(reward.contributors).reduce((a, b) => a + b, 0);
    const myPercentage = totalContribution > 0 ? (myContribution / totalContribution * 100).toFixed(1) : '0';

    return `
探索スコア: ${reward.total.toFixed(1)}点
あなたの貢献: ${myContribution}点 (${myPercentage}%)
訪問地点: ${this.state.visitedPositions.size} | 発見ブロック: ${this.state.discoveredBlocks.size}種類
`.trim();
  }

  reset(): void {
    this.state = {
      visitedPositions: new Set(),
      discoveredBlocks: new Set(),
      totalDistance: 0,
      lastPosition: null,
      structuresBuilt: 0,
      blocksPlaced: 0,
      agentContributions: new Map(),
    };
  }

  getRawState(): {
    visitedCount: number;
    discoveredCount: number;
    totalDistance: number;
    structuresBuilt: number;
    blocksPlaced: number;
    contributors: Record<string, number>;
  } {
    const contributors: Record<string, number> = {};
    this.state.agentContributions.forEach((points, agent) => {
      contributors[agent] = points;
    });

    return {
      visitedCount: this.state.visitedPositions.size,
      discoveredCount: this.state.discoveredBlocks.size,
      totalDistance: this.state.totalDistance,
      structuresBuilt: this.state.structuresBuilt,
      blocksPlaced: this.state.blocksPlaced,
      contributors,
    };
  }
}

// Singleton instance shared across all connections
export const sharedReward = new SharedRewardSystem();
