/**
 * BitFlyer API - 読み取り専用
 * 価格取得のみ、トレード機能なし
 */

export interface TickerData {
  product_code: string;
  timestamp: string;
  tick_id: number;
  best_bid: number;
  best_ask: number;
  best_bid_size: number;
  best_ask_size: number;
  total_bid_depth: number;
  total_ask_depth: number;
  ltp: number; // Last Traded Price
  volume: number;
  volume_by_product: number;
}

export interface PriceHistory {
  timestamp: number;
  price: number;
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

class BitFlyerClient {
  private baseUrl = "https://api.bitflyer.com";
  private priceHistory: PriceHistory[] = [];
  private maxHistoryLength = 100;

  // ローソク足用
  private candles: CandleData[] = [];
  private currentCandle: CandleData | null = null;
  private candleIntervalMs = 10000; // 10秒足
  private maxCandles = 50;

  /**
   * BTC/JPY の現在価格を取得
   */
  async getCurrentPrice(): Promise<TickerData> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/ticker?product_code=BTC_JPY`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as TickerData;

      const now = Date.now();
      const price = data.ltp;

      // 履歴に追加
      this.priceHistory.push({
        timestamp: now,
        price: price,
      });

      // 履歴が長すぎたら古いのを削除
      if (this.priceHistory.length > this.maxHistoryLength) {
        this.priceHistory.shift();
      }

      // ローソク足の更新
      this.updateCandle(now, price);

      return data;
    } catch (error) {
      console.error("BitFlyer API error:", error);
      throw error;
    }
  }

  /**
   * 価格履歴を取得
   */
  getPriceHistory(): PriceHistory[] {
    return [...this.priceHistory];
  }

  /**
   * 価格を整形して文字列に
   */
  formatPrice(price: number): string {
    return price.toLocaleString("ja-JP") + " 円";
  }

  /**
   * 価格変動の方向を判定
   */
  getPriceTrend(): "up" | "down" | "stable" {
    if (this.priceHistory.length < 2) return "stable";

    const latest = this.priceHistory[this.priceHistory.length - 1].price;
    const previous = this.priceHistory[this.priceHistory.length - 2].price;

    if (latest > previous) return "up";
    if (latest < previous) return "down";
    return "stable";
  }

  /**
   * ローソク足を更新
   */
  private updateCandle(timestamp: number, price: number): void {
    const candleStart = Math.floor(timestamp / this.candleIntervalMs) * this.candleIntervalMs;

    if (!this.currentCandle || this.currentCandle.timestamp !== candleStart) {
      // 前のローソク足を確定
      if (this.currentCandle) {
        this.candles.push(this.currentCandle);
        if (this.candles.length > this.maxCandles) {
          this.candles.shift();
        }
      }

      // 新しいローソク足を開始
      this.currentCandle = {
        timestamp: candleStart,
        open: price,
        high: price,
        low: price,
        close: price,
      };
    } else {
      // 既存のローソク足を更新
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
    }
  }

  /**
   * ローソク足データを取得
   */
  getCandles(): CandleData[] {
    const result = [...this.candles];
    if (this.currentCandle) {
      result.push(this.currentCandle);
    }
    return result;
  }

  /**
   * ローソク足の間隔を設定（ミリ秒）
   */
  setCandleInterval(ms: number): void {
    this.candleIntervalMs = ms;
    // リセット
    this.candles = [];
    this.currentCandle = null;
  }
}

export const bitFlyerClient = new BitFlyerClient();
