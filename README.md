# csv-reader-speed: a fast drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/pengpengliu1212-art/csv-reader-speed-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/pengpengliu1212-art/csv-reader-speed-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for make.fun's [`csv-reader-speed-01-run-20261121`](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty: read broken CSV
files faster. `solve.js` exports `run(input)`, which returns exactly
csv-reader 1.0.0's answer for `{text, header}` — the JSON value
`{columns, rows, errors}` — with the same broken-row policy (BOM drop,
stray CRs, quote junk, unterminated quotes, short/long rows, error records),
only faster.

## How it is faster

The reference reads one character at a time and builds every field a
character at a time. This reader instead:

- scans an unquoted field with a tight loop that only looks for its end,
  then takes the field with one `slice`;
- finds a quoted field's closing quote with `indexOf` (skipping `""`
  escapes the same way) and takes its content with one `slice`, falling
  back to a slow path only when the span holds an escape, a CR or a line
  break;
- keeps every slow path (stray CRs, quote junk, unterminated quotes,
  quoted line breaks) exactly as the reference reads them, so the only
  difference from the reference is speed, never a byte of output.

## Files

- `solve.js` — the reader (dependency-free ES module, `run(input)`).
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json`. (The house driver, kept
  as the rules describe; it turns V8's incremental marking off before
  importing `solve.js`.)
- `LICENSE` — MIT.

## Run

```sh
node main.ts
```

Run inside the make.fun harness (Node 22), it reads `/input/cases.json`
and writes `/output/answers.json`.
