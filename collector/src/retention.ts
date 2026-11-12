// How long to keep raw pools so the database never reaches Cloudflare's free limit (500 MB per database).
// The measured rate is about 1.6 MB a day (DATA-MODEL.md section 9), so 60 days is roughly 100 MB. The size read from
// the database itself tightens the window if activity turns out far busier than measured. The file size on D1 may not
// shrink after deletes (freed pages are reused, not returned), so a tightened window stays tight: that is deliberate,
// the cheap side to err on. Data older than the window is not lost, it is rolled into daily_stats first.
const MB = 1024 * 1024;
const DAY_MS = 86_400_000;

export const SOFT_LIMIT_BYTES = 300 * MB;
export const HARD_LIMIT_BYTES = 420 * MB;

export type RetentionPlan = { level: "normal" | "tight" | "emergency"; keepDays: number; cutoffMs: number };

export function retentionPlan(sizeBytes: number | null, nowMs: number): RetentionPlan {
  // Unknown size is treated as normal; the run log says the size was unknown so it can be noticed.
  const [level, keepDays] =
    sizeBytes !== null && sizeBytes >= HARD_LIMIT_BYTES ? (["emergency", 3] as const)
    : sizeBytes !== null && sizeBytes >= SOFT_LIMIT_BYTES ? (["tight", 14] as const)
    : (["normal", 60] as const);
  return { level, keepDays, cutoffMs: nowMs - keepDays * DAY_MS };
}
