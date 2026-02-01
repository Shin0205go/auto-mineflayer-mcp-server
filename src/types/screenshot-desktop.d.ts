/**
 * Type declarations for screenshot-desktop
 */

declare module 'screenshot-desktop' {
  interface Display {
    id: string;
    name?: string;
  }

  interface ScreenshotOptions {
    format?: 'png' | 'jpg';
    screen?: string;
  }

  interface ScreenshotFunction {
    (options?: ScreenshotOptions): Promise<Buffer>;
    listDisplays(): Promise<Display[]>;
  }

  const screenshot: ScreenshotFunction;
  export = screenshot;
}
