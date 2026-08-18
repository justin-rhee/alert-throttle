# Architecture Decision Records (ADRs)

Why this is shaped the way it is, decisions made while pulling the throttle out of the monitoring loop it came from.

## Loud the first time, then quieter on a schedule

A monitoring loop I run checks a handful of conditions every five minutes and posts a chat message when one fails. That's deliberate; a failure going unnoticed is worse than a noisy channel. Then one condition got stuck and stayed stuck, and the loop kept finding it and kept posting about it, one identical message after another, 324 times over about thirty hours.

The fix isn't quieter alerting. It's the same loudness on the first occurrence, because that part was never wrong, followed by a widening gap before a repeat is allowed to post: an hour, then six hours, then daily, capped there so a long outage doesn't keep accelerating toward silence either. `decideAlert` takes the throttle state, the alert line, and the current time, and hands back whether to post and what state to keep. Skip the widening and you're back to the original bug. Suppress everything after the first post and a real multi-day outage goes quiet, which trades one failure mode for a worse one: nobody hears about it again.

## The dedup key throws away the number and keeps the shape

Two alert lines that differ only in an embedded count, `queue depth n=12` and `queue depth n=13`, describe the same condition. If the dedup key were the literal line text, a fluctuating count would change the key on every call and the throttle would never recognize a repeat as a repeat, which reproduces the exact bug this module exists to close, just wearing a different disguise.

`alertKey` collapses every digit run in the line to `#` before hashing it into state, so both lines land on the same key. That's a real tradeoff and the README says so: two conditions that differ only by a number are treated as one, which means you shouldn't put anything in an alert line that has to stay distinct when the only difference is a number.

## Nothing in here reads a clock or writes a file

`decideAlert` takes `now` as an argument instead of calling `Date.now()`, and it takes state in and hands new state back instead of persisting anything itself. Both choices come from the same place: a module that reads its own clock or owns its own storage is hard to test at an exact boundary and easy to get subtly wrong across time zones or process restarts. Passing the clock in means a test can pin an exact timestamp and assert an exact behavior, which is how the eleven tests in the suite work.

The cost lands on the caller. Throw away the returned state instead of saving it and every call looks like a first sighting, which is the original bug again, this time self-inflicted rather than structural.

## A condition that goes away stops being tracked

Records untouched for `staleMs`, a week by default, get pruned on the next call. A condition that stopped happening a week ago isn't held in state waiting to suppress a future occurrence; it's gone, and the next time that condition happens it posts loud again, exactly as if it were new. The alternative, keeping every condition forever, would mean state grows without bound and a recovered condition quietly dampens its own recurrence months later for no reason anyone watching the channel could see.

## Extraction added a knob, not a behavior change

The only change from the version this was pulled out of is additive: `decideAlert` now takes an optional fourth argument for the backoff schedule and the staleness window, defaulting to the original constants, now exported as `DEFAULT_BACKOFF_MS` and `DEFAULT_STALE_MS`. The falsification test in the suite reproduces the original bug shape on purpose, a fresh empty state posting every single call versus threaded state posting once per window, which is there to prove the tests exercise the throttle and not a fixture built to look right.
