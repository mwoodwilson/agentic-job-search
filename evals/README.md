# Evals

An eval tests the fact-checker itself, not the hourly run. Each case is a resume where the right answer is already known: the finished example resume is true, so the fact-checker must approve it, and copies of it with one planted problem must be caught. If it gets every case right, its verdicts on your own resumes can be trusted.

The cases use the made-up person in `examples/` (Jordan Reyes), never your own profile or resumes. Run them after any change to the `check-resume` skill, the code checks or the Claude model. Target: every case passes.

| Command | What it runs | Cost |
|---|---|---|
| `node --test` | Code checks and regressions, including the eval cases' own files and scoring (no Claude calls) | free |
| `node evals/run-checker.mjs` | The live fact-checker on all 5 cases (5 headless Claude runs) | about $1.30 |
| `node evals/run-checker.mjs changed-number` | One case | about $0.25 |

The live run exits 1 if any case fails. For each case it prints what the checker flagged and why.

## How a run works

- The resume under test is in `tests/fixtures/` or `examples/evals/`. The facts the fact-checker may quote are `examples/profile/profile.md` and `stories.md`, under the names the skill uses for your own files (`profile/profile.md`, `profile/stories.md`). A resume is never its own source, so `outputs/tailored-resumes.md` is empty for every run.
- Each run is capped at `claude.maxUsdPerStep` in `examples/preferences.json` ($3), and `AJS_SETTINGS` points at that file.
- Each run writes its JSON verdicts to a temp folder, deleted afterwards (kept, and named, if a case fails). Nothing is written to `data/`, `outputs/` or `profile/`, and the runs are denied reading those folders and `archives/`.
- The code then checks the verdicts the way the hourly run does (`verifyCheck`). A planted line counts as caught when the checker marks it stretched or unsupported, or backs it with a quote that isn't in Jordan's files. A line the checker skipped is not a catch.

## Cases

The five cases are planted stretch types, each one a rule the fact-checker must hold. They are not a record of past incidents; when a real failure turns up, it becomes a new case (see Adding a case).

| Case | What it plants | Guards against |
|---|---|---|
| `jordan-final` | Nothing: the finished resume, true line by line | A fact-checker rejecting true lines, or approving a resume by quoting a copy of itself. This case must pass from the profile and stories alone |
| `changed-number` | One number changed: a no-show rate that fell from 18% is written as 28% | A number changed from the source. Numbers must match the user's files exactly |
| `inflated-ownership` | "Partnered with payments engineering" becomes "Led payments engineering" | Ownership upgraded beyond the source, such as partnering turned into leading. A verb may not claim more ownership than the source |
| `wrong-role` | The digital wallets launch, from the Senior Product Manager job, moved into the earlier Product Manager job | An achievement credited to a job where it didn't happen. Work stays in its own role |
| `keyword-list-summary` | One summary sentence rewritten as a string of keywords, each one a true skill | A summary line that is a list of keywords. Facts alone can't catch it: every word is true, but the sentence says nothing the person did, so the skill has its own rule for it |

The planted resumes in `examples/evals/` are copies of `tests/fixtures/jordan-final.md` with exactly one line changed. Every other line is true, so a flag on any other line is the checker being too strict. `tests/evals.test.mjs` checks that each copy differs in exactly one line and still passes every code check.

## Measured cost

First full run: 5/5 passed for $1.31 in total.

| Case | Result | Cost |
|---|---|---|
| `jordan-final` | pass | $0.29 |
| `changed-number` | flagged | $0.24 |
| `inflated-ownership` | flagged | $0.25 |
| `wrong-role` | flagged | $0.25 |
| `keyword-list-summary` | flagged | $0.27 |

## Adding a case

When something new goes wrong, add a case here before fixing it:

1. Add a resume to `examples/evals/` that is the finished resume with exactly one line changed to reproduce the failure, and a case for it in `checker-cases.json` with the exact line in `mustFlag`. Use fictional data only.
2. Run `node evals/run-checker.mjs <case>` and confirm it fails: the checker misses the line, as it did in the real failure.
3. Fix the skill or the code, rerun all cases, and keep the case.

If a case fails, fix the skill's wording or the planted resume. Never change the expected result to make it pass.
