/**
 * @file src/types/electron.d.ts
 * @description Полные декларации типов API Electron (Main & Preload) для строгой проверки
 *              компилятором TypeScript (`tsc --noEmit`) в любой CI/CD и облачной среде.
 */

declare module 'electron' {
  export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface Display {
    id: number;
    bounds: Rectangle;
    workArea: Rectangle;
    scaleFactor: number;
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    frame?: boolean;
    resizable?: boolean;
    fullscreenable?: boolean;
    show?: boolean;
    backgroundColor?: string;
    title?: string;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    once(event: 'ready-to-show', listener: () => void): this;
    on(
      event: 'close' | 'closed',
      listener: (event: { preventDefault: () => void }) => void,
    ): this;
    show(): void;
    hide(): void;
    focus(): void;
    center(): void;
    isVisible(): boolean;
    getBounds(): Rectangle;
    setPosition(x: number, y: number, animate?: boolean): void;
    setSize(width: number, height: number, animate?: boolean): void;
    webContents: {
      setWindowOpenHandler(
        handler: (details: { url: string }) => { action: 'allow' | 'deny' },
      ): void;
    };
    static getAllWindows(): BrowserWindow[];
  }

  export interface NativeImage {
    isEmpty(): boolean;
  }

  export const nativeImage: {
    createFromDataURL(dataUrl: string): NativeImage;
    createFromPath(path: string): NativeImage;
  };

  export interface MenuItemConstructorOptions {
    label?: string;
    type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
    click?: () => void;
  }

  export class Menu {
    static buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  }

  export class Tray {
    constructor(image: NativeImage | string);
    setToolTip(toolTip: string): void;
    setContextMenu(menu: Menu | null): void;
    getBounds(): Rectangle;
    on(event: 'click' | 'right-click', listener: () => void): this;
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: 'userData' | 'home' | 'temp' | 'exe'): string;
    quit(): void;
    on(
      event: 'before-quit' | 'window-all-closed' | 'activate',
      listener: () => void,
    ): void;
  };

  export const screen: {
    getPrimaryDisplay(): Display;
  };

  export const ipcMain: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: any[]) => Promise<unknown> | unknown,
    ): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
    showItemInFolder(fullPath: string): void;
  };
}
