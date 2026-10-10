# alert-throttle

[![tests](https://github.com/justin-rhee/alert-throttle/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/alert-throttle/actions/workflows/test.yml)

One small TypeScript module for monitoring loops that alert on a condition: **decide whether an alert may post now**, **count what got suppressed in between**, and **attach the age and held-back count to each repeat**. About 140 lines, no dependencies, one file to copy.

It exists because a monitoring loop I run kept finding a stuck condition and kept posting about it: 324 identical messages in one channel over about thirty hours. The loop was right to be loud the first time; it just had no line saying when to stop. So this is that line: post immediately, then widen the gap between repeats.

## Use it if

- you alert on a condition rather than on a change
- a stuck check can repost on every loop
- you want a repeat to carry the age and the suppressed count, with the decision pure and the storage yours

## How it works

You call `decideAlert` with your current throttle state, the alert line you're about to send, and the current time. It hands back a decision (post or don't post) and the state to keep for next time. A first sighting posts right away with nothing held back; a repeat inside the backoff window returns `post: false` and is counted as suppressed; once the window passes it posts again, carrying how long the condition has been failing and how many notices were suppressed, so the message can say "still failing after 6h, 71 notices suppressed since the last one."

The default schedule widens after each repeat: an hour, then six hours, then once a day, capped there. Conditions are keyed on the alert line with digit runs collapsed to a placeholder, so "queue depth n=12" and "n=13" hash to the same key and a fluctuating count can't defeat the mechanism. A condition that stops showing up falls out of state after a week and posts loud again next time. The module is pure: no file reads, no writes, no clock reads, state in and decision and next state out.

## Install

Copy `src/alert-throttle.ts` into your project. It has no dependencies, so there's nothing else to install. Confirm the copy works before you build on it:

```sh
bash tests/run.sh   # 11 tests should pass
```

```sh
git clone https://github.com/justin-rhee/alert-throttle
cp alert-throttle/src/alert-throttle.ts your-project/src/
```

Verify it took effect rather than assuming: call it twice with the same alert line inside the first window and confirm the second call returns `post: false`. Want a different schedule than the default? Pass a fourth argument: `decideAlert(state, alertLine, Date.now(), { backoffMs: [15 * 60_000, 60 * 60_000], staleMs: 24 * 60 * 60_000 })`.

## What it won't do

- persist anything: loading the state before the call and saving it after is on you, and throwing the returned state away puts you back on the original bug where every call looks like a first sighting and every call posts
- read the clock: you pass `now` in yourself, which is what makes it testable with any timestamp
- tell apart two conditions that differ only by a number: the digit-collapse key treats them as one, so nothing that has to stay distinct on a number belongs in an alert line
- detect problems, decide what counts as a failure, or know what the alert line means: it throttles delivery and the rest stays on your side of the call

## How I tested it

I adapted the original regression suite and added three more cases: a falsification test that reproduces the original bug on purpose (call decideAlert with a fresh empty state on every call and watch every single one post, then thread the state through properly and watch only the first call in the window post), a test that pins the digit-collapse key so a changing count dedups while a changing word doesn't, and tests for the custom backoff schedule and staleMs options. Eleven tests, run with node's built in test runner against the TypeScript source directly, no build step:

```sh
bash tests/run.sh
```

```
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md). Design decisions and what changed while building it: [docs/ADR.md](docs/ADR.md).

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you run into any issues, or anything that looks off, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).
