/**
 * Regression suite for the incident this module fixes: one stuck condition produced 324
 * identical chat messages over about 30 hours, because the posting loop fired
 * unconditionally on every five minute cycle. These tests pin loud-once-then-backoff,
 * replay a cadence shaped like the incident to prove the post count collapses, and
 * falsify the fix by showing what happens when it is bypassed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideAlert,
  alertKey,
  hasActiveAlerts,
  repeatSuffix,
  DEFAULT_BACKOFF_MS,
} from "../src/alert-throttle.ts";
import type { AlertState } from "../src/alert-throttle.ts";

const T0 = 1_780_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const LINE = "health check failed, downstream dependency unreachable, region=us-east n=3";

test("the first sighting posts immediately, loudness is preserved", () => {
  const d = decideAlert({}, LINE, T0);
  assert.equal(d.post, true);
  assert.equal(d.repeat, undefined);
  assert.ok(hasActiveAlerts(d.state));
});

test("a repeat inside the backoff window is suppressed and counted", () => {
  let state: AlertState = decideAlert({}, LINE, T0).state;
  const d = decideAlert(state, LINE, T0 + 5 * MIN);
  assert.equal(d.post, false);
  state = d.state;
  assert.equal(Object.values(state)[0]!.suppressed, 1);
});

test("a cadence shaped like the incident: 30 hours of five minute cycles collapses to 3 posts", () => {
  let state: AlertState = {};
  const postedAtHours: number[] = [];
  // 12 cycles/hr for 30h, the incident's shape. Unthrottled, that is 360 calls.
  for (let i = 0; i < 12 * 30; i++) {
    const t = T0 + i * 5 * MIN;
    const d = decideAlert(state, LINE, t);
    state = d.state;
    if (d.post) postedAtHours.push((t - T0) / HOUR);
  }
  // Loud immediately, then +1h, then +6h. The next is due at 31h, past this window.
  assert.deepEqual(postedAtHours, [0, 1, 7]);
});

test("a repeat post says how long it has been failing and how many were withheld", () => {
  let state: AlertState = decideAlert({}, LINE, T0).state;
  for (let i = 1; i < 12; i++) state = decideAlert(state, LINE, T0 + i * 5 * MIN).state; // 11 suppressed
  const d = decideAlert(state, LINE, T0 + HOUR);
  assert.equal(d.post, true);
  assert.ok(d.repeat);
  assert.equal(d.repeat!.suppressed, 11);
  const suffix = repeatSuffix(d.repeat!);
  assert.ok(suffix.includes("1h"));
  assert.ok(suffix.includes("11 notices suppressed"));
  assert.ok(
    !/[a-z]{4,}=/.test(suffix.replace(/still failing|notices suppressed since the last one/g, "")),
    "integers only",
  );
});

test("a different condition is never suppressed by an unrelated one's window", () => {
  const state = decideAlert({}, LINE, T0).state;
  const other = decideAlert(state, "a security check tripped, redaction validator flagged input, n=1", T0 + MIN);
  assert.equal(other.post, true, "an unrelated condition must not be swallowed by another one's backoff");
});

test("recovery clears the slate so the next occurrence is loud again", () => {
  const state = decideAlert({}, LINE, T0).state;
  assert.ok(hasActiveAlerts(state));
  assert.equal(hasActiveAlerts({}), false, "cleared state means nothing outstanding");
  // after a clear, the same condition is a first sighting again
  assert.equal(decideAlert({}, LINE, T0 + 2 * HOUR).post, true);
});

test("stale records are pruned so state cannot grow without bound", () => {
  const old: AlertState = {
    "ancient#": { firstAt: 0, lastPostedAt: T0 - 8 * 24 * HOUR, suppressed: 5, postCount: 3 },
  };
  const d = decideAlert(old, LINE, T0);
  assert.equal(Object.keys(d.state).length, 1, "the 8 day old record is gone");
  assert.ok(!("ancient#" in d.state));
});

test("without threaded state, the original bug reproduces: every single call posts", () => {
  // This is the incident itself: a caller that hands decideAlert a fresh empty state on
  // every call, instead of carrying the returned state forward, gets no throttling at
  // all. Nothing in decideAlert can protect a caller that discards its own state.
  let postedCount = 0;
  for (let i = 0; i < 12 * 30; i++) {
    const t = T0 + i * 5 * MIN;
    const d = decideAlert({}, LINE, t); // fresh empty state every time, the bug
    if (d.post) postedCount += 1;
  }
  assert.equal(postedCount, 12 * 30, "every one of 360 cycles posted, exactly the failure mode being fixed");

  // Same cadence, but the caller does the one thing decideAlert asks of it: thread the
  // returned state into the next call. Only the first call posts inside the window.
  let state: AlertState = {};
  let postedWithState = 0;
  for (let i = 0; i < 12; i++) {
    const t = T0 + i * 5 * MIN; // one hour of cycles, all inside the first backoff window
    const d = decideAlert(state, LINE, t);
    state = d.state;
    if (d.post) postedWithState += 1;
  }
  assert.equal(postedWithState, 1, "with state threaded through, only the first call in the window posts");
});

test("a count changing in the line does not defeat dedup, a word changing does", () => {
  const a = "batch validation failed, queue depth n=12";
  const b = "batch validation failed, queue depth n=13";
  assert.equal(alertKey(a), alertKey(b), "two lines differing only by a number share a key");

  const state = decideAlert({}, a, T0).state;
  assert.equal(decideAlert(state, b, T0 + MIN).post, false, "the count-only variant is deduped as the same condition");

  const c = "batch validation failed, queue depth n=12";
  const d = "batch export failed, queue depth n=12";
  assert.notEqual(alertKey(c), alertKey(d), "two lines differing by a word are different conditions");
  assert.equal(decideAlert(state, d, T0 + 2 * MIN).post, true, "a genuinely different condition is never swallowed");
});

test("a caller supplied backoff schedule is honored instead of the default", () => {
  const opts = { backoffMs: [10 * MIN, 30 * MIN] };
  let state: AlertState = decideAlert({}, LINE, T0, opts).state;

  // Inside the custom 10 minute window, still suppressed.
  let d = decideAlert(state, LINE, T0 + 5 * MIN, opts);
  assert.equal(d.post, false);
  state = d.state;

  // Past the custom 10 minute window, posts again (would still be suppressed under the
  // 1 hour default, so this only passes if the custom schedule is actually in effect).
  d = decideAlert(state, LINE, T0 + 11 * MIN, opts);
  assert.equal(d.post, true);
  assert.notDeepEqual(opts.backoffMs, DEFAULT_BACKOFF_MS);
});

test("a caller supplied staleMs prunes on its own schedule", () => {
  const old: AlertState = {
    "ancient#": { firstAt: 0, lastPostedAt: T0 - 2 * HOUR, suppressed: 0, postCount: 1 },
  };
  // Default staleMs (7 days) would keep this record. A 1 hour staleMs drops it.
  const kept = decideAlert(old, LINE, T0);
  assert.ok("ancient#" in kept.state, "the default window keeps a 2 hour old record");

  const dropped = decideAlert(old, LINE, T0, { staleMs: HOUR });
  assert.ok(!("ancient#" in dropped.state), "a 1 hour staleMs prunes the same record");
});
