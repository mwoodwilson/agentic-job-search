# Examples

A complete made-up person, so you can see what finished files look like and try the workflow before writing your own. Jordan Reyes, the three companies, the school and every number are invented. The job boards in `preferences.json` are real public boards.

| File | What it is |
|---|---|
| `profile/profile.md` | Jordan's facts: two narratives, three roles with exact numbers, skills and education |
| `profile/stories.md` | Jordan's raw notes, answering the prompts in the blank template |
| `profile/resume-rules.md` | The fixed hard rules, plus four rules of Jordan's own |
| `preferences.json` | Jordan's settings: boards to watch, resume roles, banned wording. Notifications and the schedule are off |
| `sample-job.md` | A made-up job (Senior Product Manager, Checkout at Saltmere) in the inbox format |
| `../tests/fixtures/jordan-final.md` | The finished resume for that job. It follows every hard rule and each line traces to Jordan's files. The tests and evals use it as the model answer |
| `evals/*.md` | Four copies of that finished resume, each with one planted problem, for the fact-checker evals ([evals/README.md](../evals/README.md)) |
| `output/` | What a real run made from the files above: the tailored resume, its Word and PDF files, and the fact-check JSON for the Saltmere job |

## Try it

Do this in a fresh copy of the project: it replaces your own profile files. Those files (`profile/profile.md`, `stories.md`, `resume-rules.md`) are git-ignored, so what you write in them is never committed. Blank copies are made from `profile/*.example.md` when they're missing.

1. Copy `examples/profile/*` into `profile/`, and `examples/preferences.json` to `config/preferences.json`.
2. Run `node scripts/check-setup.mjs`. With Claude Code installed, it should report no problems.
3. Run `node scripts/job-pull.mjs --no-ai --backlog`. It checks the example boards once without Claude, lists what's open as `Backlog` (no resumes, no cost) and creates `inbox.md` from [integrations/optional-inbox.md](../integrations/optional-inbox.md).
4. Paste the contents of `sample-job.md` into `inbox.md`, below the `<!-- ENTRIES BELOW -->` line.
5. Run `node scripts/job-pull.mjs --resume-only`. It skips the job boards, imports the job from the inbox and writes, checks and builds a resume for it alone (typically $2 to $4 of Claude usage).

Boards open and close roles, so a board can show nothing that matches on a given day. That is normal.
