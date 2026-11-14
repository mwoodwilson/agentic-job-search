# Setup, by hand

This is the same eight steps as the `/setup` skill in Claude Code, in the same order, for doing it yourself. Run everything from the project folder. You can come back to any step later.

Prefer to have Claude guide you? Start Claude Code in the project folder with `claude`, then type `/setup` or paste: *Help me set up this project. Use its setup skill and walk me through it one question at a time.* New to the terminal or Claude Code? See "New to Claude Code or the terminal?" in the [README](../README.md#new-to-claude-code-or-the-terminal).

Your own files (`config/preferences.json`, `profile/profile.md`, `profile/stories.md` and `profile/resume-rules.md`) are ignored by git, so your details stay on your Mac and are never committed or pushed.

## Step 1: Cost and the computer

1. **What it costs.** The code is free. Each resume uses about $2–4 of Claude usage (the writer, the fact-checker and any retries), and an hour with no new roles costs nothing. Once a day, one more step updates what the postings ask for. Every Claude step stops at $3 (`claude.maxUsdPerStep`). On a Claude Pro or Max plan this counts against your plan; with an API key it's billed to you. [What it costs](../README.md#what-it-costs) has the details.
2. Install [Node](https://nodejs.org) 20 or newer, and Claude Code, and sign in to Claude Code: run `claude` and use `/login`. The login is kept in your Mac's keychain, where the hourly job can use it. An `ANTHROPIC_API_KEY` set only in your shell (for example in `~/.zshrc`) isn't seen by the hourly job, so sign in with `/login` instead (a Console account pays by API usage).
3. Make your settings file from the example. Never do this over a file you have already filled in.

   ```
   cp config/preferences.example.json config/preferences.json
   ```

4. Run the check:

   ```
   node scripts/check-setup.mjs
   ```

   It also makes any missing profile file from its blank template (`profile/profile.md`, `profile/stories.md` and `profile/resume-rules.md`). For now, only two kinds of line matter: one about Node or Claude Code (fix it before going on), and a warning about Pages. Pages is optional: without it, resumes are made as Word files only. It is free in the Mac App Store. Lines about blank settings or a blank profile are expected; the next steps fill them in.

## Step 2: Your experience

You don't need a resume. Write your experience in your own words first, then shape it.

1. **Raw notes:** `profile/stories.md`. For each job, most recent first, write what you did and what changed because of it, the way you'd tell a friend. Numbers help: where something started, where it ended, how long it took. The file's prompts (a launch you're proud of, a hard trade-off, a metric you moved and so on) are there to jog your memory. Rough is fine; the writer rewrites it.
2. **The profile:** `profile/profile.md`, built from those notes or from your resume. [examples/profile/profile.md](../examples/profile/profile.md) is a finished one to copy the shape from.
   - **Professional narratives:** two to four, each "Name: one or two sentences", plus your total years of experience as a plain sentence. The writer picks the one or two that fit each job.
   - **One block per job**, most recent first: title, company, dates, location, what you did, then "Confirmed facts": exact numbers, where they started and the timeframe.
   - **Skills** and **Education**, each with an "On resumes:" line the resume uses as written.
3. In `config/preferences.json`, fill `candidate.name` and `candidate.contact` (printed at the top of every resume: email, phone, city), and `resume.roles`: your jobs from the profile, most recent first, each as `{ "title", "companyLine", "minBullets" }`. The company line is written like `Company (City, ST) · Month Year – Month Year`. Give recent jobs more bullets (for example 4, 3, 2).

Write only what is true and what you could explain in an interview. The writer builds every resume only from these two files, and the fact-checker must back every resume line with a quote from them, so a fact that isn't written down can't appear on a resume. Your two most recent jobs each need at least two results with a timeframe ("+40% YoY", "in 2025", "within 3 months").

profile.md and stories.md are living documents: keep adding to them. The more true detail they hold, the better every resume gets.

## Step 3: The roles you want

In `config/preferences.json`, set `search.titleKeywords` to the words a job title must contain, in lowercase, such as `"product manager"`. Make one entry in `search.families` per kind of role you want, each with its own title words, such as `{ "name": "Product Manager", "titleKeywords": ["product manager"] }`. Each kind gets its own folder of resumes in `outputs/resumes/`. With one kind, keep one family named after it.

## Step 4: Where and pay

1. `search.locationKeywords`: cities, states or `"remote"`; `[]` means anywhere. `search.usOnly` (on by default) keeps only US jobs.
2. `search.pay`: `{ "minTop": 0, "minBaseTop": 0 }` for no floor. With a floor, set both to the lowest top of a posted pay range you'd consider. ([The pay rule](CUSTOMIZING.md#the-pay-rule) explains `minBaseTop`, if you want a lower floor for base-salary ranges that also offer bonus or equity.)

## Step 5: Companies to watch

`search.companies`: the companies to watch. For each one, open a job on its careers page and copy that job's address. Then run:

```
node scripts/find-board.mjs 'https://job-boards.greenhouse.io/acme/jobs/1234567' 'Acme'
```

Keep the single quotes. It prints the kind of job board, the board's name, how many roles are open, and a line like this to paste into `search.companies`:

```
{ "name": "Acme", "ats": "greenhouse", "slug": "acme" }
```

The address has to be on the job board itself: greenhouse.io, lever.co, ashbyhq.com, gem.com or myworkdayjobs.com. A company's own careers site can't be read. A board with no open roles right now can still be added. You need at least one company with a working board.

## Step 6: Notifications

All notifications are off. Turn each on separately in `config/preferences.json`:

- `notifications.imessage`: set `enabled` to `true` and `to` to your phone number. Each resume is texted through the Messages app the moment it's ready, with its job link, and after each run one line sums up the new jobs ("3 new jobs added: 1 resume created, 2 could not tailor.").
- `notifications.email`: set `enabled` to `true` and `to` to your email address. The same, through the Mail app.
- `notifications.numbers`: set `enabled` to `true` for a Numbers spreadsheet of every role. It needs no address.

An address with `enabled` still `false` is ignored, and `enabled: true` with no address is refused by the check. The first time one of these runs, macOS asks whether it may control the app. Choose Allow.

## Step 7: Scout and schedule

1. **The weekly scout** (off by default, about $5 a run): `schedule.scout.enabled` set to `true`, with a `day` (such as `"Monday"`) and an `hour` (0 to 23). Once a week it looks for companies worth watching and writes you a short list to approve. It runs as part of a normal run, so it needs the hourly schedule or a run you start yourself.
2. **The hourly schedule:** set `schedule.hourly` to `true` to have it run by itself every hour while this Mac is on. Each run checks your companies and writes a resume for every new role, about $2–4 each.
3. Run `node scripts/check-setup.mjs` again and fix what it names until it says "Setup is complete." Then run:

   ```
   node scripts/install-schedule.mjs
   ```

   It turns the hourly job on or off to match the setting, and prints what it did. Run it again after changing `schedule.hourly`, moving the project folder, or reinstalling Node or Claude Code.

## Step 8: Your first resumes

1. Run the first pull (free: no Claude calls). It can take a few minutes:

   ```
   node scripts/job-pull.mjs --no-ai --backlog
   ```

   It checks every board once and puts the roles that fit your rules in `data/jobs.csv`.
2. These roles have the Status "Backlog". They were already open, so no resumes are written for them automatically. Only roles found from now on get resumes automatically.
3. Pick up to 3 to get resumes now (about $2–4 each). For each one:

   ```
   node scripts/set-status.mjs 'https://job-boards.greenhouse.io/acme/jobs/1234567' New
   ```

   using the role's address from the Link column. Then write them, up to 3 at once:

   ```
   node scripts/job-pull.mjs --resume-only
   ```

   Finished resumes are in `outputs/resumes/<role type>/`. You can also change a Status in `data/jobs.csv` in a text editor, not in Numbers: Numbers saves a separate `.numbers` copy, and the pipeline never sees the change.
4. If no roles landed, the boards had nothing that matched today, which is normal. Widen the roles or places in steps 3 and 4 if you like.

## Finish

New roles get resumes automatically when the schedule is on, or whenever you run `node scripts/job-pull.mjs`. To practice for an interview, run `/interview-prep` in Claude Code: it plays the hiring manager for a role, using its job description and your resume, and saves your answers. It's a normal Claude Code chat, so it uses about as much as any conversation that long. `/research-resume-rules` adds resume rules for your field. What each setting does, and how to change the Word template, add companies and write your own rules, is in [CUSTOMIZING.md](CUSTOMIZING.md).
