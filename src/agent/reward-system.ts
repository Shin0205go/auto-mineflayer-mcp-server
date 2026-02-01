/**
 * Exploration Reward System
 *
 * Tracks agent exploration and calculates reward scores.
 */

export interface ExplorationState {
  // Unique positions visited (rounded to integers)
  visitedPositions: Set<string>;

  // Unique block types discovered
  discoveredBlocks: Set<string>;

  // Total distance traveled
  totalDistance: number;

  // Last known position
  lastPosition: { x: number; y: number; z: number } | null;

  // Structures built
  structuresBuilt: number;

  // Blocks placed
  blocksPlaced: number;
}

export interface RewardBreakdown {
  exploration: number;      // Points for visiting new positions
  discovery: number;        // Points for finding new block types
  distance: number;         // Points for total distance traveled
  structures: number;       // Points for building structures
  blocks: number;           // Points for placing blocks
  total: number;
}

// Reward weights
const WEIGHTS = {
  NEW_POSITION: 1.0,        // Per unique position
  NEW_BLOCK_TYPE: 5.0,      // Per new block type discovered
  DISTANCE: 0.1,            // Per block traveled
  STRUCTURE: 20.0,          // Per structure built
  BLOCK_PLACED: 0.5,        // Per block placed
};

export class RewardSystem {
  private state: ExplorationState;

  constructor() {
    this.state = {
      visitedPositions: new Set(),
      discoveredBlocks: new Set(),
      totalDistance: 0,
      lastPosition: null,
      structuresBuilt: 0,
      blocksPlaced: 0,
    };
  }

  /**
   * Update state with new position
   */
  updatePosition(x: number, y: number, z: number): void {
    const posKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    this.state.visitedPositions.add(posKey);

    if (this.state.lastPosition) {
      const dx = x - this.state.lastPosition.x;
      const dy = y - this.state.lastPosition.y;
      const dz = z - this.state.lastPosition.z;
      this.state.totalDistance += Math.sqrt(dx*dx + dy*dy + dz*dz);
    }

    this.state.lastPosition = { x, y, z };
  }

  /**
   * Update state with discovered blocks
   */
  updateDiscoveredBlocks(blockTypes: string[]): void {
    for (const blockType of blockTypes) {
      this.state.discoveredBlocks.add(blockType);
    }
  }

  /**
   * Record a structure being built
   */
  recordStructureBuilt(): void {
    this.state.structuresBuilt++;
  }

  /**
   * Record a block being placed
   */
  recordBlockPlaced(): void {
    this.state.blocksPlaced++;
  }

  /**
   * Calculate current reward breakdown
   */
  calculateReward(): RewardBreakdown {
    const exploration = this.state.visitedPositions.size * WEIGHTS.NEW_POSITION;
    const discovery = this.state.discoveredBlocks.size * WEIGHTS.NEW_BLOCK_TYPE;
    const distance = this.state.totalDistance * WEIGHTS.DISTANCE;
    const structures = this.state.structuresBuilt * WEIGHTS.STRUCTURE;
    const blocks = this.state.blocksPlaced * WEIGHTS.BLOCK_PLACED;

    return {
      exploration,
      discovery,
      distance,
      structures,
      blocks,
      total: exploration + discovery + distance + structures + blocks,
    };
  }

  /**
   * Get current state summary for Gemini prompt
   */
  getStateSummary(): string {
    const reward = this.calculateReward();

    return `
## 探索スコア: ${reward.total.toFixed(1)}点

内訳:
- 訪問地点: ${this.state.visitedPositions.size}箇所 (+${reward.exploration.toFixed(1)})
- 発見ブロック: ${this.state.discoveredBlocks.size}種類 (+${reward.discovery.toFixed(1)})
- 移動距離: ${this.state.totalDistance.toFixed(1)}m (+${reward.distance.toFixed(1)})
- 建築物: ${this.state.structuresBuilt}個 (+${reward.structures.toFixed(1)})
- 設置ブロック: ${this.state.blocksPlaced}個 (+${reward.blocks.toFixed(1)})

目標: スコアを最大化せよ！新しい場所を探索し、様々なブロックを発見しよう。
`.trim();
  }

  /**
   * Reset the reward system
   */
  reset(): void {
    this.state = {
      visitedPositions: new Set(),
      discoveredBlocks: new Set(),
      totalDistance: 0,
      lastPosition: null,
      structuresBuilt: 0,
      blocksPlaced: 0,
    };
  }

  /**
   * Get raw state for debugging
   */
  getState(): ExplorationState {
    return { ...this.state };
  }
}
