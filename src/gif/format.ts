/** "840 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "0.5 s", "12 s". */
export const formatSeconds = (s: number): string => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
