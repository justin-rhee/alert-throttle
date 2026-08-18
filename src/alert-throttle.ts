/**
 * Alert dedup and backoff (pure).
 *
 * Why this exists: a monitoring loop posted its failure alert unconditionally, once per
 * five minute cycle. One stuck condition produced 324 identical chat messages over about
 * thirty hours, delivered one after another, because nothing in the loop asked "have I
 * already said this." The loop was deliberately loud, that part was correct, but loud
 * once and loud forever were never distinguished.
 *
 * The rule this encodes: the first occurrence posts immediately (loudness preserved),
 * then the same condition re-posts on a widening schedule (1 hour, then 6 hours, then
 * daily, by default), and each repeat carries how long it has been failing and how many
 * notices were suppressed since the last one. A condition that clears is announced once
 * and forgotten, so the next occurrence is loud again.
 *
 * Content free by construction: the dedup key comes from the alert line itself, and the
 * only thing this module appends to an outbound message is integers.
 *
 * Pure: state, a line, and the current time go in, a decision and the next state come
 * out. There is no file IO and no call to the system clock in here. The caller owns
 * persistence (writing state wherever it lives) and owns the clock, which is also what
 * makes this trivial to test with any timestamp you like.
 */

export type AlertRecord = {
  /** When this condition was first seen, in milliseconds. */
  firstAt: number;
  /** When a notice for it was last actually posted, in milliseconds. */
  lastPostedAt: number;
  /** Notices withheld since lastPostedAt. */
  suppressed: number;
  /** How many notices have been posted for this condition (1 is the initial loud one). */
  postCount: number;
};

export type AlertState = Record<string, AlertRecord>;

export type ThrottleDecision = {
  post: boolean;
  state: AlertState;
  /** Present only on a repeat post. Drives the "still failing" suffix. */
  repeat?: { forMs: number; suppressed: number };
};

export type ThrottleOptions = {
  /**
   * Widening re-post schedule, in milliseconds. Index is the number of notices already
   * posted, clamped to the last entry once the schedule runs out.
   */
  backoffMs?: readonly number[];
  /** Records untouched for this long are pruned so state cannot grow without bound. */
  staleMs?: number;
};

/** Default widening re-post schedule: 1 hour, then 6 hours, then daily. */
export const DEFAULT_BACKOFF_MS: readonly number[] = [
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];

/** Default staleness window: 7 days. */
export const DEFAULT_STALE_MS = 7 * 24 * 60 * 60_000;

function backoffFor(postCount: number, backoffMs: readonly number[]): number {
  return backoffMs[Math.min(Math.max(postCount, 1) - 1, backoffMs.length - 1)]!;
}

/**
 * Collapse an alert line to a stability key. Digit runs become "#" so a line whose only
 * change is a count (n=12 becomes n=13) is still recognized as the same underlying
 * condition. Without this, a fluctuating count embedded in the message would defeat
 * dedup entirely, which is the exact failure mode this module exists to close.
 */
export function alertKey(line: string): string {
  return line.replace(/\d+/g, "#").slice(0, 200);
}

/** Drop records not touched for staleMs. */
function prune(state: AlertState, now: number, staleMs: number): AlertState {
  const out: AlertState = {};
  for (const [k, r] of Object.entries(state)) {
    if (now - r.lastPostedAt < staleMs) out[k] = r;
  }
  return out;
}

/**
 * Decide whether this alert line should actually go out now.
 *
 * First sighting of a condition posts. A repeat inside the current backoff window is
 * suppressed, and counted. A repeat past the window posts again, carrying how long the
 * condition has been failing and how many notices were withheld since the last one.
 *
 * opts lets a caller override the backoff schedule and the staleness window; both
 * default to the constants above.
 */
export function decideAlert(
  state: AlertState,
  line: string,
  now: number,
  opts?: ThrottleOptions,
): ThrottleDecision {
  const backoffMs = opts?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const next = prune(state, now, staleMs);
  const key = alertKey(line);
  const rec = next[key];

  if (!rec) {
    next[key] = { firstAt: now, lastPostedAt: now, suppressed: 0, postCount: 1 };
    return { post: true, state: next };
  }

  if (now - rec.lastPostedAt >= backoffFor(rec.postCount, backoffMs)) {
    const repeat = { forMs: now - rec.firstAt, suppressed: rec.suppressed };
    next[key] = {
      firstAt: rec.firstAt,
      lastPostedAt: now,
      suppressed: 0,
      postCount: rec.postCount + 1,
    };
    return { post: true, state: next, repeat };
  }

  next[key] = { ...rec, suppressed: rec.suppressed + 1 };
  return { post: false, state: next };
}

/** Integers only. Safe to append to any already sanitized line. */
export function repeatSuffix(repeat: { forMs: number; suppressed: number }): string {
  const hours = Math.max(1, Math.round(repeat.forMs / 3_600_000));
  return ` (still failing after ${hours}h, ${repeat.suppressed} notices suppressed since the last one)`;
}

/** True when any condition is currently outstanding, i.e. a recovery would be worth announcing. */
export function hasActiveAlerts(state: AlertState): boolean {
  return Object.keys(state).length > 0;
}
