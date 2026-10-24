import type { DownloadLibrary, DownloadPlan, DownloadSelection, OfflineDownload, OfflineVideoDetail } from "@tube/shared";
export type DesktopDownloads = {
  /** Services this desktop build can save; absent in builds that only download YouTube. */
  readonly backends?: readonly string[];
  /** "segments": server conversions (choose audio and quality); absent in older builds. */
  readonly formats?: readonly string[];
  connect(): Promise<void>;
  list(): Promise<DownloadLibrary>;
  /** A bare id is YouTube (the only form older builds accept). */
  plan(target: string | { backend: string; videoId: string }): Promise<DownloadPlan>;
  add(selection: DownloadSelection): Promise<OfflineDownload>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  pauseAll?(): Promise<void>;
  resumeAll?(): Promise<void>;
  remove(id: string): Promise<void>;
  detail(id: string): Promise<OfflineVideoDetail>;
  state(): Promise<{ data: Record<string, unknown> | null; dirty: boolean; pendingProgress?: Record<string, number | null>; pendingHistory?: Record<string, { id: string; at: string }> }>;
  saveState(data: unknown): void;
  play(id: string): Promise<void>;
  open(): Promise<void>;
  reconnect(): Promise<boolean>;
  disconnect(): Promise<void>;
  subscribe(listener: () => void): () => void;
  onCompleted?(listener: (item: { id: string; title: string }) => void): () => void;
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
