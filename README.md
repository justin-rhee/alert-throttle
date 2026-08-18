# alert-throttle

I run a monitoring loop that posts a chat message when a check fails. Loud on purpose, because a failure was never supposed to slip past unnoticed. Then one condition got stuck and stayed stuck, and the loop kept checking every five minutes, kept finding the same failure, kept posting about it. Over about thirty hours that came to 324 identical messages in one channel

The loop was right to be loud the first time. It just had no idea when to stop, and nothing in it drew that line. If you alert on a condition rather than on a change, you have this too, and you'll find out the day something stays broken overnight.

So this is the missing line, about 140 lines of TypeScript: post immediately, then widen the gap between repeats, and when a repeat goes out, say how long the thing has been broken and how many notices got held back.

## Use it if

- you alert on a condition rather than on a change
- a stuck check can repost on every loop
- you want a repeat to carry the age and the suppressed count
- you'd rather keep the decision pure and own the storage yourself

## How it works

You call decideAlert with three things: your current throttle state, the alert line you're about to send, and the current time. It hands back a decision (post or don't post) and the state you should keep for next time.

The first time a condition shows up it posts right away, with nothing held back on a first sighting. If the same condition comes back before its backoff window has passed, the call returns post: false and counts it as suppressed. Once the window has passed it posts again, and the decision carries how long the condition has been failing and how many notices were suppressed since the last one, so the eventual message can say something like "still failing after 6h, 71 notices suppressed since the last one."

The default schedule widens after each repeat: an hour, then six hours, then once a day, capped there so a long outage doesn't keep accelerating. Conditions are matched by a key derived from the alert line itself, with digit runs collapsed to a placeholder, so "queue depth n=12" and "queue depth n=13" hash to the same key and a fluctuating count embedded in the message can't defeat the mechanism. A condition that stops showing up falls out of state on its own after a week by default, and the next time it happens it's treated as new and posts loud again.

The whole module is pure. No file reads, no writes, no call to the system clock anywhere inside it. State in, decision and next state out.

## Install

Copy src/alert-throttle.ts into your project. It has no dependencies, so there's nothing else to install.

```ts
import { decideAlert, repeatSuffix } from "./alert-throttle";

let state = loadStateFromWherever();
const decision = decideAlert(state, alertLine, Date.now());
state = decision.state;
saveStateWherever(state);

if (decision.post) {
  const message = decision.repeat
    ? alertLine + repeatSuffix(decision.repeat)
    : alertLine;
  send(message);
}
```

Want a different schedule than the default? Pass a fourth argument:

```ts
decideAlert(state, alertLine, Date.now(), {
  backoffMs: [15 * 60_000, 60 * 60_000],
  staleMs: 24 * 60 * 60_000,
});
```

## What it won't do

It doesn't persist anything. Loading the state before the call and saving it after is on you. Throw the returned state away and you're back to the original bug: every call looks like a first sighting, and every call posts.

It doesn't read the clock. You pass now in yourself, which is what makes it testable with any timestamp you like and keeps this module from quietly depending on wall clock time.

The digit-collapse key means two conditions that differ only by a number are treated as one condition. That's deliberate rather than a defect, and it means you should not put anything in an alert line that needs to stay distinct when the only difference is a number.

It throttles delivery. It doesn't detect problems, decide what counts as a failure, or know anything about what the alert line means. All of that logic stays on your side of the call.

## How I tested it

I adapted the original regression suite and added three more cases: a falsification test that reproduces the original bug on purpose (call decideAlert with a fresh empty state on every call and watch every single one post, then thread the state through properly and watch only the first call in the window post), a test that pins the digit-collapse key so a changing count dedups while a changing word doesn't, and tests for the custom backoff schedule and staleMs options. Eleven tests, run with node's built in test runner against the TypeScript source directly, no build step.

```
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

Design decisions and what changed while building it: [docs/ADR.md](docs/ADR.md).

---

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you spot something weird, or just want to ask how it works, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).
