/**
 * Vision Provider - Screen Capture for Minecraft
 *
 * Captures the Minecraft window screen and optimizes images for Gemini Live API.
 * Supports configurable FPS, resolution, and image format.
 */

import screenshot = require('screenshot-desktop');
import sharp from 'sharp';
import { EventEmitter } from 'events';

export interface VisionConfig {
  /** Target FPS for screen capture (0.5 - 2.0 recommended) */
  fps: number;
  /** Target width for resized images */
  width: number;
  /** Target height for resized images */
  height: number;
  /** Image format: 'webp' or 'jpeg' */
  format: 'webp' | 'jpeg';
  /** Image quality (1-100) */
  quality: number;
  /** Display ID for multi-monitor setups (optional) */
  displayId?: string;
}

export interface CapturedFrame {
  /** Image data as base64 string */
  base64: string;
  /** MIME type of the image */
  mimeType: string;
  /** Timestamp of capture */
  timestamp: number;
  /** Frame sequence number */
  frameNumber: number;
  /** Original dimensions before resize */
  originalSize: { width: number; height: number };
  /** Final dimensions after resize */
  finalSize: { width: number; height: number };
}

const DEFAULT_CONFIG: VisionConfig = {
  fps: 1.0,
  width: 768,
  height: 768,
  format: 'webp',
  quality: 80,
};

/**
 * VisionProvider captures and processes screen frames for AI consumption
 */
export class VisionProvider extends EventEmitter {
  private config: VisionConfig;
  private isCapturing = false;
  private captureInterval: NodeJS.Timeout | null = null;
  private frameNumber = 0;
  private lastCaptureTime = 0;
  private availableDisplays: string[] = [];

  constructor(config: Partial<VisionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the vision provider and detect available displays
   */
  async initialize(): Promise<void> {
    try {
      // Get list of available displays
      const displays = await screenshot.listDisplays();
      this.availableDisplays = displays.map((d: { id: string }) => d.id);
      console.log(`[Vision] Detected ${this.availableDisplays.length} display(s)`);

      // Test capture to ensure it works
      await this.captureFrame();
      console.log('[Vision] Screen capture initialized successfully');
    } catch (error) {
      console.error('[Vision] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Capture a single frame from the screen
   */
  async captureFrame(): Promise<CapturedFrame> {
    const startTime = Date.now();

    try {
      // Capture screenshot
      const screenshotOptions: { format: 'png' | 'jpg'; screen?: string } = {
        format: 'png', // Always capture as PNG for best quality before processing
      };

      if (this.config.displayId && this.availableDisplays.includes(this.config.displayId)) {
        screenshotOptions.screen = this.config.displayId;
      }

      const rawBuffer = await screenshot(screenshotOptions);

      // Get original image dimensions
      const metadata = await sharp(rawBuffer).metadata();
      const originalSize = {
        width: metadata.width || 0,
        height: metadata.height || 0,
      };

      // Process image: resize and compress
      let sharpInstance = sharp(rawBuffer).resize(this.config.width, this.config.height, {
        fit: 'cover',
        position: 'center',
      });

      let buffer: Buffer;
      let mimeType: string;

      if (this.config.format === 'webp') {
        buffer = await sharpInstance.webp({ quality: this.config.quality }).toBuffer();
        mimeType = 'image/webp';
      } else {
        buffer = await sharpInstance.jpeg({ quality: this.config.quality }).toBuffer();
        mimeType = 'image/jpeg';
      }

      const frame: CapturedFrame = {
        base64: buffer.toString('base64'),
        mimeType,
        timestamp: startTime,
        frameNumber: ++this.frameNumber,
        originalSize,
        finalSize: {
          width: this.config.width,
          height: this.config.height,
        },
      };

      this.lastCaptureTime = Date.now();
      const processingTime = this.lastCaptureTime - startTime;

      this.emit('frame', frame);
      this.emit('debug', {
        type: 'capture',
        frameNumber: frame.frameNumber,
        processingTimeMs: processingTime,
        sizeBytes: buffer.length,
      });

      return frame;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start continuous frame capture at the configured FPS
   */
  startCapture(): void {
    if (this.isCapturing) {
      console.warn('[Vision] Already capturing');
      return;
    }

    this.isCapturing = true;
    const intervalMs = Math.round(1000 / this.config.fps);

    console.log(`[Vision] Starting capture at ${this.config.fps} FPS (interval: ${intervalMs}ms)`);

    this.captureInterval = setInterval(async () => {
      try {
        await this.captureFrame();
      } catch (error) {
        console.error('[Vision] Capture error:', error);
      }
    }, intervalMs);

    this.emit('captureStarted', { fps: this.config.fps });
  }

  /**
   * Stop continuous frame capture
   */
  stopCapture(): void {
    if (!this.isCapturing) {
      return;
    }

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    this.isCapturing = false;
    console.log('[Vision] Capture stopped');
    this.emit('captureStopped', { totalFrames: this.frameNumber });
  }

  /**
   * Update capture configuration
   */
  updateConfig(config: Partial<VisionConfig>): void {
    const wasCapturing = this.isCapturing;

    if (wasCapturing) {
      this.stopCapture();
    }

    this.config = { ...this.config, ...config };

    if (wasCapturing) {
      this.startCapture();
    }

    console.log('[Vision] Config updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): VisionConfig {
    return { ...this.config };
  }

  /**
   * Get capture statistics
   */
  getStats(): {
    isCapturing: boolean;
    frameNumber: number;
    lastCaptureTime: number;
    config: VisionConfig;
  } {
    return {
      isCapturing: this.isCapturing,
      frameNumber: this.frameNumber,
      lastCaptureTime: this.lastCaptureTime,
      config: this.config,
    };
  }

  /**
   * Get list of available displays
   */
  getAvailableDisplays(): string[] {
    return [...this.availableDisplays];
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopCapture();
    this.removeAllListeners();
  }
}
