export const MAX_EXPORT_AUTO_POLLS = 30
export const MAX_EXPORT_POLL_DELAY_MS = 30_000

export function exportPollDelay(attempt: number) {
  const safeAttempt = Math.max(0, Math.floor(attempt))
  return Math.min(2_000 * (2 ** safeAttempt), MAX_EXPORT_POLL_DELAY_MS)
}
