# Architecture

One rule shapes the whole design: **code decides, Claude judges.** A plain Node script runs every step, enforces every rule it can measure, and sets every status. Claude is called only for work that needs judgment (reading free text, writing, deciding whether a claim is true, investigating the web). Each of those calls is a separate, narrow, capped run, and code checks what comes back.

## One run, step by step

`node scripts/job-pull.mjs` is the run. The hourly job is just this command on a schedule.

1. **Start.** Load `config/preferences.json` and stop with a plain list of problems if a required setting is missing, before any file is touched. Take the lock, make any missing profile file from its template, and put the hard-rules block back if it was edited.
2. **Pull.** Read every company's public job board (Greenhouse, Lever, Ashby, Gem or Workday), up to 8 at once, so the pull takes about as long as the slowest board. Keep roles that pass the title, place and pay rules and haven't been seen before: not by link, and not by the same company and title under another link.
3. **List and archive.** Add each new role to `data/jobs.csv` (newest first) and its full description to the archive for its role family in `archives/`. A new role gets the Status `New`, except on the first successful read of a company's board (`data/boards-pulled.json` keeps each board read so far): the roles already open there get `Backlog`, so adding a company never queues every open role for a paid resume.
4. **Inbox.** If `inbox.md` has entries, Claude reads them (import-jobs) and code adds them to the same list and archives.
5. **New roles.** If text or email is on and the run added roles, one line goes out right away: "Job search: N new roles added." (with the job list attached when the Numbers sheet is on).
6. **Write and check.** For every role with the Status `New`, up to 3 at once, the writer and checker loop runs (below). Each role is written in its own draft file (`data/drafts/`), and code files it in `outputs/tailored-resumes.md` once the loop ends. The writer and the fact-checker get the files they need (your profile, stories, rules, finalized resumes, the job's description and role guide) in the prompt, so they don't spend turns opening them.
7. **Build and send.** Each resume that passed becomes a Word file and a PDF the moment it passes, while the next roles are still being written, and goes out right away in its own text (its line and job link, then the PDF) and its own email, where those are on. Builds and sends go one at a time. A resume over one page goes back to the writer to drop its least relevant bullet, up to twice, and then the code checks run again. A resume still over one page after two trims, one that fails the code checks after trimming, or a file build that fails, ends as `Needs review`.
8. **Upkeep.** After the messages: the Numbers sheet (if on) gets the final statuses; once a day, the first run after new postings were archived updates those families' competencies files (what the postings ask for and how your profile covers it; `data/competencies.json` keeps what's waiting); if a board has failed three runs in a row, the repair agent investigates and writes a proposal; and if the weekly scout is on and due, it runs and writes a proposal.
9. **Finish.** When anything happened (a new role, a resume, a hold, a role that could not be tailored, or a problem), write one summary line to the log. Save the run to the history folder if anything changed, and write anything that went wrong to `data/workflow-log.md`.

Other ways to run it: `--no-ai` (pull and list roles only, no Claude calls; new roles stay `New`, so the next full run writes their resumes), `--backlog` (add every new role as `Backlog`, no resumes or messages), `--resume-only` (skip the job boards: import the inbox, write for `New` roles, build and send), `--retailor <link>` (write a fresh resume for a role that already has one; the old one stays as history) and `--numbers` (only refresh the Numbers sheet).

## What code does and what Claude does

| Work | Who |
|---|---|
| Read the job boards, apply the title, place and pay rules, skip roles already seen | Code |
| Keep the job list newest first and set every Status | Code |
| Read inbox entries written as free text | Claude (`import-jobs`); code adds the roles |
| Summarize what postings ask for | Claude (`update-competencies`); code puts back the role guide if it changes |
| Write and revise the resume | Claude (`tailor-resume`) |
| Summary and bullet length, a number in every bullet, time-bound results, headings, your roles and banned words, keyword count | Code (`scripts/lib/check-resume.mjs`) |
| Judge whether each line is true to your files | Claude (`check-resume`) |
| Confirm every line was checked, every quote exists, every keyword's quote appears in the resume and coverage is at least 70% | Code (`verifyCheck`) |
| Decide to retry, hold or finish | Code (`scripts/lib/tailor-loop.mjs`) |
| Build the Word file and PDF, count pages | Code (Pages makes the PDF) |
| Send messages, never twice | Code |
| Investigate a broken job board | Claude (`diagnose-board`), proposal only |
| Find companies worth watching | Claude (`scout-companies`), proposal only |

## The writer and checker loop

`scripts/lib/tailor-loop.mjs`, for one role, with at most 3 tries (`MAX_TRIES`):

1. **Write.** The writer (the `tailor-resume` skill) writes the resume from the job description, your profile and your stories (`profile/profile.md` and `profile/stories.md`, both living documents you keep adding to), and saves it in the role's own draft file (`data/drafts/`), the only file it can write; code files the finished resume in `outputs/tailored-resumes.md`. On a later try it gets the list of problems and fixes only those lines.
2. **Code checks.** Five of the six hard rules (summary length, bullet length, a number in every bullet, time-bound results, keyword coverage) plus your own rules from the settings. Hard rule 5, that every line is backed by your files, is confirmed in step 4. A resume that breaks a rule goes straight back to the writer, so the paid fact-check waits for a version that passes.
3. **Fact-check.** A separate Claude run (the `check-resume` skill) judges every summary sentence and every bullet as supported, stretched or unsupported, and for each supported line copies the exact line from your files that backs it. It never edits the resume. If it writes nothing, or skips lines, that is the checker's problem, not the writer's: it is rerun once and the writer isn't called.
4. **Quotes verified by code.** This is hard rule 5. `verifyCheck` confirms that every line has a verdict, that each quote is at least 15 characters long and really appears in one of your files (`profile/profile.md`, `profile/stories.md`, or a resume you finalized, never the resume being checked), and that each keyword the resume claims is really in it. It recomputes keyword coverage from that, and at least 70% is required.
5. **Decide.** No problems: `Resume ready`. Problems: back to step 1 with the list. After the third try, or if the fact-check fails to finish twice, `Needs review`, with the reasons in `data/workflow-log.md`. If the writer honestly reports that the role can't be covered with true material, `Could not tailor`.

If Claude itself isn't answering (a run fails without doing any work, for example when Claude Code is signed out, a usage limit is reached or the network is down), that isn't the role's fault: the role stays `New`, no more roles, trims or scout start this run, and one line goes to `data/workflow-log.md`. The next run tries again.

Code sets the Status; Claude never edits `data/jobs.csv`. A resume saved by a run that crashed is checked, not written again.

## The two agents that only propose

Both agents can read files inside the project folder only, use web tools, and write exactly one proposal file in `data/proposals/`. Neither can change settings, data or code. Both are told to treat every web page as data, not instructions.

- **Repair agent** (`diagnose-board`). Runs when a board returns an error, or 0 open roles, three runs in a row (`data/health.json` counts the streaks and raises one alert per streak). It reproduces the problem, finds the company's real careers page, names the likely cause with evidence and proposes the smallest fix, such as a corrected board name. You ask Claude to apply it.
- **Scout agent** (`scout-companies`). Runs once a week when `schedule.scout.enabled` is `true` (off by default), at the first run after the day and hour you set. It searches the web for up to 8 companies hiring for your roles, confirms each one's job board can be read, and proposes the exact lines to add. Its last run is in `data/scout.json`.

## Safeguards

| Safeguard | How it works |
|---|---|
| One run at a time | `data/job-pull.lock` holds the process id and time. A second run skips itself. A lock older than 30 minutes whose process is gone is cleared. |
| Files are replaced whole | State files are written to a temporary file and then renamed, so a crash never leaves half a file. |
| Nothing sent twice | `data/sent-log.json` keys each resume sent by role link, channel and a hash of the resume text, so a rerun or a crash never sends the same resume twice; a changed resume goes out again. A resume that didn't go out (a failed send, or a run whose Numbers sheet didn't update) is re-queued for each channel that is on until it does. The first run that finds text or email turned on marks the resumes already ready as handled on it, at the start of the run before anything is built, so turning a channel on later never sends old resumes and a run that stops before sending can't make a new resume look old. A run whose only news is a resume going out by email again sends no text. (The fixed "Run complete: no matching roles were found." text is not logged: it goes out after every run with nothing new only when `notifications.imessage.everyRun` is on, which is off by default.) |
| Read and write limits | Every Claude run can read files only inside the project folder (one full-path `Read` rule, which Claude Code also applies to Grep and Glob) and can write only the files its step needs (see the table below), each given as a full-path `editRule`. The shell is turned off for every run (`--disallowedTools Bash`), because Claude Code runs commands such as `cat` without asking, in any folder. Web tools are turned off too, except for the two agents that are given them, because Claude Code opens its own list of documentation sites without asking. `--permission-mode dontAsk` means it can never stop to ask, so anything else, such as a read of `~/.ssh`, is denied. `--setting-sources project` keeps your personal plugins and hooks out of it, and so does leaving out your local `settings.local.json` in `.claude`, where a "don't ask again" from your own Claude Code sessions would otherwise widen a step. |
| Dollar caps | Every run passes `--max-budget-usd` from `claude.maxUsdPerStep` (the scout uses `claude.maxUsdScout`). Claude Code 2.1.317 has no turn limit, so the dollar cap is the limit. |
| Time limit | Every Claude run is stopped after 20 minutes (`CLAUDE_TIMEOUT_MS` in `scripts/lib/claude.mjs`), so a stuck run can't keep the lock and make every later hourly run skip itself. |
| No Pages, no wait | Whether Pages is installed is checked once per run by looking for the app, never by asking Pages (which opens a "Where is Pages?" dialog when it's missing). Without it, resumes are Word files only. |
| Hard rules restored | The block between `<!-- HARD RULES START -->` and `<!-- HARD RULES END -->` in `profile/resume-rules.md` is rewritten as shipped at the start of every run, and the log says so if it had to. |
| Role guide restored | The researched guide at the top of a competencies file is saved before `update-competencies` runs and put back if it changed. |
| Settings checked first | A missing or invalid required setting stops the run, and the schedule installer refuses to turn the hourly job on, until it is fixed. |
| Notifications off by default | Each one is turned on separately, and one with no address is a settings problem. |
| Problems never go to your phone | Failures, broken boards and proposals are written to `data/workflow-log.md`: one line each, kind (`run`, `success`, `failure`, `decision`, `fix` or `alert`) and time. |
| History | After every run, your data is saved to `.history/`, a separate local git folder with the project as its work tree. Any run's changes can be seen and undone with git, and `git pull` for new code never collides. Resume binaries and the lock are left out. It never pushes. |

### What each Claude step can do

Every step can use its skill and read files inside the project folder, and nothing outside it. No step can run shell commands.

| Step | Skill | May write | Web |
|---|---|---|---|
| Read inbox entries | `import-jobs` | `inbox.md` and `data/inbox-import.json` | No |
| Update competencies | `update-competencies` | `archives/competencies-*.md` | No |
| Write, revise or trim a resume | `tailor-resume` | `outputs/tailored-resumes.md` | No |
| Fact-check a resume | `check-resume` | its own `data/checks/<id>.json` | No |
| Repair a board | `diagnose-board` | one file in `data/proposals/` | Opens web pages |
| Scout companies | `scout-companies` | one file in `data/proposals/` | Searches the web and opens pages |

`tests/permissions.test.mjs` fails if any run is given a write or shell rule that doesn't come from `editRule`, a bare `Read`, `Grep` or `Glob` (which would allow reading anywhere), if a step keeps a web tool it wasn't given, or if the shell is no longer turned off or your local `settings.local.json` is loaded again. Four skills are run by you, not by the hourly job: `/setup`, `/research-resume-rules`, `/craft-stories` and `/interview-prep`.

## Where things live

| Folder or file | What it holds | In git |
|---|---|---|
| `scripts/`, `scripts/lib/` | The run, the checks, the loop, the Word builder, the schedule installer | Yes |
| `.claude/skills/` | One skill per Claude step | Yes |
| `config/preferences.example.json`, `profile/*.example.md` | Blank templates | Yes |
| `tests/`, `evals/`, `examples/` | Tests, the fact-checker evals and the made-up example person | Yes |
| `templates/`, `prompts/`, `integrations/`, `docs/` | The sample Word template, the resume-research prompt, the inbox guide and these docs | Yes |
| `config/preferences.json` | Your settings | No |
| `profile/profile.md`, `stories.md`, `resume-rules.md` | Your facts and notes (living documents you keep adding to) and your rules | No |
| `data/` | The job list, what's been seen and sent, board health, fact-check results, proposals, the log, the lock | No |
| `archives/` | Full job descriptions and competencies, one pair of files per role family | No |
| `outputs/` | `tailored-resumes.md` and the Word and PDF files in `outputs/resumes/` | No |
| `inbox.md` | Jobs you or another agent dropped in | No |
| `.history/` | Your local run history | No |

## Tests and evals

**Tests** run with `node --test` and are free: no Claude calls, and only the made-up example person (Jordan Reyes) for resumes and settings. They cover, among other things:

- the six hard rules, one change at a time (`tests/check-resume.test.mjs`);
- the writer and checker loop with a stand-in for Claude: retries, holds, a fact-check that never finishes, the writer limited to its own draft, several roles at once (`tests/tailor-loop.test.mjs`);
- every message that can be sent, and that nothing is sent when notifications are off (`tests/messages.test.mjs`);
- settings validation, the schedule installer and the setup check (`tests/settings.test.mjs`, `tests/install-schedule.test.mjs`, `tests/check-setup.test.mjs`);
- that every Claude run is limited to its named files (`tests/permissions.test.mjs`), and that every skill names only files that exist and no one's personal details (`tests/skills.test.mjs`);
- the docs: every link resolves, every setting and script they name exists (`tests/docs.test.mjs`);
- past failures pinned so they can't come back (`tests/regressions.test.mjs`).

**Evals** test the fact-checker itself, which code alone can't: `node evals/run-checker.mjs` runs the real `check-resume` skill on a true resume (which it must approve) and on copies with one planted problem each (which it must flag): a changed number, inflated ownership, work moved to the wrong role, a summary that is only keywords. Code scores the verdicts with the same `verifyCheck` the hourly run uses. It costs about $1.30 for all 5 cases (measured: $1.31), and exits 1 if any case fails. Run it after changing the `check-resume` skill, the code checks or the Claude model. When something new goes wrong, it is added as a case before it is fixed. Details are in [evals/README.md](../evals/README.md).

## What it costs, and how it's capped

- A quiet run makes no Claude calls.
- Each Claude step is capped by `claude.maxUsdPerStep` (default $3); the scout by `claude.maxUsdScout` (default $5).
- A full resume (writer plus fact-check, up to 3 tries) typically costs about $2 to $4 (measured: $2.92 over three tries in the acceptance run; runs have ranged from about $1 to $5). It depends on your default Claude model and on retries, which can go up to the per-step caps.
- Once a day, the first run after new postings were archived updates those families' competencies files (`update-competencies`), one more capped step.
- The ceiling for one role in one run is 11 capped steps: 3 writer runs, 6 fact-check runs (each of 3 tries can need one rerun) and 2 trims. Lower `claude.maxUsdPerStep` for a tighter ceiling.
- On a Claude Pro or Max plan this counts against plan usage; with an API key it is billed.
