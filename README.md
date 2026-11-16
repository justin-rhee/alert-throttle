# alert-throttle

[![tests](https://github.com/justin-rhee/alert-throttle/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/alert-throttle/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg) ![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

Stops a monitoring loop from posting the same alert over and over, and tells you how many repeats it held back.

```ts
import { decideAlert } from "./alert-throttle.ts";

let state = {};
const t0 = Date.parse("2026-11-13T12:00:00Z");

let d = decideAlert(state, "queue depth n=12", t0);           // post: true, first sighting
d = decideAlert(d.state, "queue depth n=13", t0 + 10 * 60e3); // post: false, same condition, counted
d = decideAlert(d.state, "queue depth n=15", t0 + 70 * 60e3); // post: true, repeat: { forMs: 4200000, suppressed: 1 }
```

A monitoring loop of mine kept finding a stuck condition and kept posting about it: 324 identical messages in one channel over about thirty hours. Being loud the first time was right. It just had no line saying when to stop.

## Use it if

- you alert on a condition rather than on a change
- a stuck check can repost on every loop
- you want each repeat to carry the age and the suppressed count, with the decision pure and the storage yours

## Install

Copy `src/alert-throttle.ts` into your project. It's about 140 lines with no dependencies, and runs under Node 22 or newer, which reads TypeScript directly.

```sh
git clone https://github.com/justin-rhee/alert-throttle
cp alert-throttle/src/alert-throttle.ts your-project/src/
```

To use a different schedule, pass options as a fourth argument: `{ backoffMs: [15 * 60_000, 60 * 60_000], staleMs: 24 * 60 * 60_000 }`.

## How it works

1. a first sighting posts right away
2. a repeat inside the backoff window returns `post: false` and is counted
3. once the window passes it posts again, carrying how long it's been failing and how many it held back
4. the window widens after each repeat: an hour, six hours, then once a day

Digit runs in the alert line collapse before matching, so `n=12` and `n=13` count as the same condition. A condition that stops showing up drops out after a week and posts loud again next time. It never reads the clock, a file or the network: state goes in, a decision and the next state come out.

## What it won't do

- persist anything, so loading and saving the state is on you, and throwing it away brings back the original bug where every call posts
- read the clock, since you pass `now` in, which is what makes it testable
- tell apart two conditions that differ only by a number, so anything that must stay distinct on a number doesn't belong in an alert line
- detect problems or decide what counts as one; it only throttles delivery

## How I tested it

- 11 tests on Node's built-in runner, against the TypeScript source: `bash tests/run.sh`
- one reproduces the original bug on purpose: a fresh empty state on every call posts every time, while threading the state through posts only the first
- one pins the digit-collapse key, so a changing count matches while a changing word doesn't

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md). Design decisions: [docs/ADR.md](docs/ADR.md).

<!-- related:start -->
## Related

- [freshness-gate](https://github.com/justin-rhee/freshness-gate): makes a health check treat never-seen exactly like dead
- [alert-redactor](https://github.com/justin-rhee/alert-redactor): builds alert text from exceptions without leaking record contents

Part of a small set of tools I pulled out of my own agent harness. I use them myself and read every issue. More on my [GitHub profile](https://github.com/justin-rhee).
<!-- related:end -->
