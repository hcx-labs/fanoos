import type { DownloadLibrary, DownloadPlan, DownloadSelection, OfflineDownload, OfflineVideoDetail } from "@tube/shared";
export type DesktopDownloads = {
  connect(): Promise<void>;
  list(): Promise<DownloadLibrary>;
  plan(videoId: string): Promise<DownloadPlan>;
  add(selection: DownloadSelection): Promise<OfflineDownload>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  detail(id: string): Promise<OfflineVideoDetail>;
  state(): Promise<{ data: Record<string, unknown> | null; dirty: boolean; pendingProgress?: Record<string, number | null>; pendingHistory?: Record<string, { id: string; at: string }> }>;
  saveState(data: unknown): void;
  play(id: string): Promise<void>;
  open(): Promise<void>;
  reconnect(): Promise<boolean>;
  disconnect(): Promise<void>;
  subscribe(listener: () => void): () => void;
};
declare global {
  interface Window {
    fanoosDesktop?: {
      readonly platform: string;
      readyForProtectedPlayback(): Promise<void>;
      readonly offline?: boolean;
      readonly downloads?: DesktopDownloads;
      setTheme(theme: 'dark' | 'light' | 'system'): void;
    };
  }
}
