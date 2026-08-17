/** 安全展示 agent transcript，避免 JSON.parse 抛错导致整页白屏 */
export function formatTranscript(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
