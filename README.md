# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Xiadan-8872/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Xiadan-8872/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

**A faster drop-in for make.fun's csv-reader 1.0.0** — reads broken CSV files
exactly as csv-reader does, only faster. Every answer is identical to
csv-reader's on every case (BOM, stray CRs, unterminated quotes, quote junk,
short/long rows, blank lines, CR/LF normalisation inside quotes), and on the
practice set it runs about 4× faster than the house baseline end to end
(~0.83 s vs ~3.35 s per run on this box, including Node startup and JSON I/O).

## How it is fast

- A record whose first physical line holds no `"` and no stray `\r` is
  answered with a single `String.split(',')` on that line — no
  per-character loop at all.
- Every other field is read with `indexOf` jumps and whole slices: an
  unquoted field finds its next `,` / `\n` / `\r` and is sliced whole; a
  quoted field finds its next `"` and is sliced whole. Characters are only
  scanned one at a time when a quoted segment actually holds a `\r` that
  must be normalised to `\n`.
- Line numbers are counted from the slices, never per character.

## Layout

- `solve.js` — dependency-free ES module; `run(input)` returns
  `{columns, rows, errors}` exactly as csv-reader 1.0.0 does.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json` (V8 incremental marking
  off, as the house baseline runs).

## Check it locally

```sh
node main.ts   # with MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set outside a container
```

Verified against csv-reader 1.0.0 on the kit's practice set (6/6 cases
identical), 63 hand-written edge cases, 100 generated cases from the
competition's own generator, and 30,000 random short-string fuzz cases —
all identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2bdkx0kf&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
