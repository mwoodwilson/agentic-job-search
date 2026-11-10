# Customizing

Everything you can change, and where. Your settings live in `config/preferences.json`; `node scripts/check-setup.mjs` checks them and names anything wrong, in plain words. Lines that start with `_` are notes and are ignored. `/setup` in Claude Code can change any part of it for you. [examples/preferences.json](../examples/preferences.json) is a filled-in file for a made-up person.

The environment variable `AJS_SETTINGS` points the scripts at a different settings file instead; the evals use it to run on the made-up person.

## Every setting

### Who the resumes are for

| Setting | What it does |
|---|---|
| `candidate.name` | Printed at the top of every resume. Required. |
| `candidate.contact` | The line under the name: email, phone, city. Required. |

### What to look for

| Setting | What it does |
|---|---|
| `search.companies` | The job boards to check, each as `{ "name": "Acme", "ats": "greenhouse", "slug": "acme" }`. `ats` is the kind of board (`greenhouse`, `lever`, `ashby`, `ashby-page`, `gem` or `workday`) and `slug` is the board's name in its web address. [Add one with find-board](#add-a-company). Required: at least one. |
| `search.titleKeywords` | Words a job title must contain, in any case. A title matching any one is kept. Required. |
| `search.titleExclude` | Words that rule a title out, matched as whole words. `[]` excludes nothing. |
| `search.locationKeywords` | Places you'd work, matched against the job's location, such as `"remote"` or `"chicago"`. `[]` means anywhere. Required. |
| `search.usOnly` | `true` (the default) drops roles in other countries, unless the location also names the US. |
| `search.pay` | The pay floor, as `{ "minTop": 0, "minBaseTop": 0 }`. Required; see [the pay rule](#the-pay-rule). |
| `search.families` | Kinds of role, each as `{ "name": "Product Manager", "titleKeywords": ["product manager"] }`. See [families](#role-families). |

### The pay rule

The amounts are the top of the pay range a posting lists. With `minTop` at `0` there is no floor, so no role is dropped for its pay. Otherwise:

- A range whose top is over `minTop` passes.
- A base-salary range under `minTop` passes only if its top is over `minBaseTop` and the posting also mentions bonus, equity or other extra pay. Otherwise it fails.
- A total-pay range under `minTop` fails.
- A role that fails is dropped.
- A posting with no pay, pay that can't be read, pay in another currency, or a range under `minTop` that doesn't say whether it is base or total, is kept and marked `Review` in the Pay check column, so you can judge it.

### How resumes are built

| Setting | What it does |
|---|---|
| `resume.template` | The Word file the resumes are built on. Default `templates/resume-template.docx`. See [swapping the template](#swap-the-word-template). |
| `resume.roles` | Your past jobs, most recent first, each as `{ "title": "Senior PM", "companyLine": "Larkfield (Chicago, IL) · 2020 – 2024", "minBullets": 2 }`. When it is set, every resume must have exactly these roles, in this order, with these titles and company lines, and at least `minBullets` bullets each. When it is `[]`, roles are taken from `profile/profile.md`. |
| `resume.maxBullets` | The most bullets under one role. `null` for no limit. |
| `resume.note` | A line printed in italics first under the experience heading, such as `"Earlier roles on request."`. Write it as plain text; no asterisks needed. Every resume must carry it word for word. `""` for none. |
| `resume.banned` | Wording to keep out, each as `{ "pattern": "\\bleverag(e\|ed\|es\|ing)\\b", "why": "Buzzword. Say what you did." }`. `pattern` is a regular expression, not case sensitive, checked against the summary and every bullet. `why` is what the writer is told when a resume breaks it. |

### Notifications

All off by default. Turn one on and, for the first two, give an address. See [what gets sent](#what-gets-sent).

| Setting | What it does |
|---|---|
| `notifications.imessage.enabled` | Text through the Messages app. |
| `notifications.imessage.to` | The phone number to text. |
| `notifications.imessage.everyRun` | `true` to also get a text after every run that found nothing new ("Run complete: no matching roles were found."). Off by default: with the hourly schedule that is about 24 texts a day. |
| `notifications.email.enabled` | Email through the Mail app. |
| `notifications.email.to` | The address to email. |
| `notifications.numbers.enabled` | Keep a Numbers spreadsheet copy of the job list, in iCloud as "Agentic Job Search.numbers". It needs no address. |

### Schedule

| Setting | What it does |
|---|---|
| `schedule.hourly` | `true` to run by itself at the start of every hour while the Mac is on and you're logged in. Then run `node scripts/install-schedule.mjs`. |
| `schedule.scout.enabled` | `true` to turn on the weekly scout. Off by default; about $5 a run. |
| `schedule.scout.day` | The day of the week it runs, such as `"Monday"`. |
| `schedule.scout.hour` | The hour, 0 to 23. |

Things to know about the scout: it runs as part of a normal run, so it needs the hourly schedule or a run you start. Turning it on makes it run on the next run if it has never run. Changing its day in the middle of a week can mean two scouts that week.

After you move the folder, or reinstall Node or Claude Code, run `node scripts/install-schedule.mjs` again. It refreshes the hourly job's saved paths.

### Spending limits

| Setting | What it does |
|---|---|
| `claude.maxUsdPerStep` | The dollar cap for each Claude step. Default 3. |
| `claude.maxUsdScout` | The dollar cap for the weekly scout. Default 5. |

## Add a company

Open any job on the company's careers page and copy that job's address. Then:

```
node scripts/find-board.mjs 'https://jobs.lever.co/acme-corp/0f1e2d3c' 'Acme Corp'
```

It works out the kind of board and its name, checks that the board answers, says how many roles are open, and prints the line to paste into `search.companies`. Greenhouse, Lever, Ashby, Gem and Workday boards can be read. A company's own careers site can't. A Workday entry can also carry an optional `facets` object: the board's own filters, sent as given with each request for its list.

You don't need a special run for a new company. The first time its board is read, the roles already open there get the Status `Backlog`, so they don't all get resumes at once (a corrected board name counts as a new board too). Roles that appear after that are `New` and get resumes. Set a `Backlog` role's Status to `New` in `data/jobs.csv` to get a resume for it. The weekly scout's proposals end with these same lines, ready to paste.

## Role families

A family is a kind of role with its own job archive (`archives/jobs-<name>.md`), its own competencies file and its own folder of resumes. A role goes into the first family in `search.families` whose `titleKeywords` appear in its title. If none match, it goes into the first family with an empty `titleKeywords` list (the catch-all), and failing that, the first family. A family with `"titleKeywords": []` therefore matches every title that no other family claims.

Use more than one family when you're after different kinds of role, for example `Product Manager` and `Product Marketing`, so each gets its own competencies. A role must still contain one of `search.titleKeywords` to be pulled at all. Renaming a family starts a new archive; a role already in any archive is never added twice.

## Your own rules

The six hard rules are at the top of `profile/resume-rules.md`, between the `<!-- HARD RULES START -->` and `<!-- HARD RULES END -->` markers. Code checks them, and if you edit the block it is put back at the next run. Your own rules go under `## My rules` in the same file, one per bullet, in your own words. Add them by hand, or run `/research-resume-rules` in Claude Code to research rules for your field and keep, edit or delete each one. They can add to the hard rules but never loosen them.

The writer follows every rule that applies to a role. Rules that code can measure belong in settings instead (`resume.banned`, `resume.maxBullets`, `resume.roles`), because code enforces those.

If you edit a finished resume, save your version as a `.pages` file next to the generated one in `outputs/resumes/`. It is then the final version, and the pipeline never rebuilds or overwrites it. Tell Claude you saved it: it records your text as final (a `Final:` line in `outputs/tailored-resumes.md`), and from then on it can back later resumes as a source. Your edits show your taste for that role, not rules, so only a rule you state as "never" or "always" is added under `## My rules`.

## Swap the Word template

Set `resume.template` to your own `.docx`. The builder reuses your template's own paragraphs, so its fonts, spacing and rules carry over, and replaces the text. Your template must keep:

- a name line and a contact line at the top, above the first heading;
- the headings **PROFESSIONAL SUMMARY**, **PROFESSIONAL EXPERIENCE**, **EDUCATION** and **SKILLS**, in capitals.

If one is missing, the build names it in the log and the resume is held as `Needs review`. Without the Pages app you get the Word file only, no PDF.

## Living documents

`profile/profile.md` and `profile/stories.md` are living documents. Keep adding to them: every new job, launch, number and lesson. The writer builds each resume only from these files and from resumes you finalized, and the fact-checker confirms every resume line against them, so a fact that isn't written down can't appear on a resume. Exact numbers, the starting point and the timeframe matter most. The two most recent roles each need at least two results with a timeframe. [examples/profile/](../examples/profile/profile.md) shows finished files.

After adding facts, get a fresh resume for a role that already has one:

```
node scripts/job-pull.mjs --retailor 'https://example.com/jobs/123'
```

The address is the role's Link in `data/jobs.csv`. The old resume stays in `outputs/tailored-resumes.md` as history. Add `--resume-only` to skip checking the job boards and just write.

Three skills use the same files when you want them: `/craft-stories` turns your raw notes into polished interview stories, `/interview-prep` runs a mock interview for a specific job, and `/update-competencies` rebuilds what the archived postings ask for. The hourly run also updates competencies by itself, once a day, after an archive grows.

## What gets sent

Only what you turned on.

- **Text:** right after the pull, when a run added roles, one line: "Job search: 3 new roles added." with the job list attached if the Numbers sheet is on. Then each resume, the moment it passes, in its own text: "Resume ready: <title> | <company>" with the job link on the next line, then its PDF. With `notifications.imessage.everyRun` on, a run with nothing new also texts "Run complete: no matching roles were found."
- **Email:** only when there is news: the same new-roles line (with the job list attached, if the Numbers sheet is on), then one email per finished resume, as it passes, with the job link and its text in the body and its PDF attached.
- **Numbers sheet:** a copy of `data/jobs.csv`, rewritten on every run. Change a role's Status in the CSV, in a text editor, not in Numbers: opening the CSV in Numbers saves a separate `.numbers` copy, so the change never reaches the pipeline. `node scripts/job-pull.mjs --numbers` refreshes it after a manual change.

Each resume goes once per version, so a rerun never repeats it, but a re-tailored resume goes out again. A resume that didn't go out (a send failed, or the run stopped first) is sent with a later run, by text and by email alike. If the Numbers sheet is on but didn't update, the new-roles line waits for a later run's sheet; finished resumes still go out. Turning text or email on later doesn't send the resumes made before: only resumes made from then on go out. Problems, broken boards and proposals are never sent: they're written to `data/workflow-log.md`. Attachments are staged in `~/Pictures/agentic-job-search`.

## The job list

`data/jobs.csv` has one row per role, newest first. Edit it in a text editor, not in Numbers (Numbers saves a separate `.numbers` copy instead of the CSV). The Status column is how you and the pipeline talk: `New` waits for a resume; the code sets `Resume ready`, `Could not tailor` or `Needs review`; `Backlog` is a role that was already open when its company's board was first read, or one found by a `--backlog` run. You set `Applied`, `Recruiter screen`, `Rejected` or `Skip`. Setting a held role back to `New` retries it.
