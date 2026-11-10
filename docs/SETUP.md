# Setup, by hand

This is the same eight steps as the `/setup` skill in Claude Code, in the same order, for doing it yourself. Run everything from the project folder. You can come back to any step later.

Prefer to have Claude guide you? Start Claude Code in the project folder with `claude`, then type `/setup` or paste: *Help me set up this project. Use its setup skill and walk me through it one question at a time.* New to the terminal or Claude Code? See "New to Claude Code or the terminal?" in the [README](../README.md#new-to-claude-code-or-the-terminal).

Your own files (`config/preferences.json`, `profile/profile.md`, `profile/stories.md` and `profile/resume-rules.md`) are ignored by git, so your details stay on your Mac and are never committed or pushed.

## Step 1: Check the computer

1. Install [Node](https://nodejs.org) 20 or newer, and Claude Code, and sign in to Claude Code: run `claude` and use `/login`. The login is kept in your Mac's keychain, where the hourly job can use it. An `ANTHROPIC_API_KEY` set only in your shell (for example in `~/.zshrc`) isn't seen by the hourly job, so sign in with `/login` instead (a Console account pays by API usage).
2. Make your settings file from the example. Never do this over a file you have already filled in.

   ```
   cp config/preferences.example.json config/preferences.json
   ```

3. Run the check:

   ```
   node scripts/check-setup.mjs
   ```

   It also makes any missing profile file from its blank template (`profile/profile.md`, `profile/stories.md` and `profile/resume-rules.md`).
4. For now, only two kinds of line matter: one about Node or Claude Code (fix it before going on), and a warning about Pages. Pages is optional: without it, resumes are made as Word files only. It is free in the Mac App Store. Lines about blank settings or a blank profile are expected; the next steps fill them in.

## Step 2: The profile

Open `profile/profile.md` and write your experience in it. [examples/profile/profile.md](../examples/profile/profile.md) is a finished one to copy the shape from.

- **Professional narratives:** two to four, each "Name: one or two sentences", plus your total years of experience as a plain sentence. The writer picks the one or two that fit each job.
- **One block per job**, most recent first: title, company, dates, location, what you did, then "Confirmed facts": exact numbers, where they started and the timeframe.
- **Skills** and **Education**, each with an "On resumes:" line the resume uses as written.

Write only what is true and what you could explain in an interview. Every resume line has to be backed by these files, so a fact that isn't written down can't appear on a resume. Your two most recent roles each need at least two results with a timeframe ("+40% YoY", "in 2025", "within 3 months"), so give the timeframe wherever you know it.

profile.md is one of two living documents: keep adding to it after every launch, number and lesson.

## Step 3: The stories

`profile/stories.md` holds prompts: a launch you're proud of, a hard trade-off, a time you changed someone's mind, a metric you moved, a failure and what you learned. Answer one or two in your own words. Rough and casual is fine; the writer rewrites it. Reword a heading if it doesn't fit your field.

profile.md and stories.md are living documents. The more true detail they hold, the better every resume gets. The fact-checker uses both, so write only what is true. You can skip this step now and come back any time.

## Step 4: The settings and the companies

Open `config/preferences.json`. Each section has a note (a line starting with `_`) explaining it; [CUSTOMIZING.md](CUSTOMIZING.md) explains every setting. Fill in:

1. `candidate.name` and `candidate.contact`: printed at the top of every resume, so write them as you want them to read (email, phone, city).
2. `resume.roles`: your jobs from `profile/profile.md`, most recent first, each as `{ "title", "companyLine", "minBullets" }`. The company line is written like `Company (City, ST) · Month Year – Month Year`. Give recent jobs more bullets (for example 4, 3, 2).
3. `search.titleKeywords`: words a job title must contain, in lowercase, such as `"product manager"`. `search.titleExclude` lists words that rule a title out, such as `"intern"`. If you want more than one kind of role, make one entry in `search.families` per kind, each with its own words; otherwise keep one family named after the role.
4. `search.locationKeywords`: cities, states or `"remote"`; `[]` means anywhere. `search.usOnly` keeps only US jobs.
5. `search.pay`: `{ "minTop": 0, "minBaseTop": 0 }` for no floor. With a floor, `minTop` is the lowest top of a posted pay range you'd consider, and `minBaseTop` is the lowest top of a base-salary range you'd still look at when a posting also offers bonus or equity.
6. `search.companies`: the companies to watch. For each one, open a job on its careers page and copy that job's address. Then run:

   ```
   node scripts/find-board.mjs 'https://job-boards.greenhouse.io/acme/jobs/1234567' 'Acme'
   ```

   Keep the single quotes. It prints the kind of job board, the board's name, how many roles are open, and a line like this to paste into `search.companies`:

   ```
   { "name": "Acme", "ats": "greenhouse", "slug": "acme" }
   ```

   The address has to be on the job board itself: greenhouse.io, lever.co, ashbyhq.com, gem.com or myworkdayjobs.com. A company's own careers site can't be read. A board with no open roles right now can still be added. You need at least one company with a working board.

## Step 5: Resume rules

Every resume follows six fixed hard rules, written at the top of `profile/resume-rules.md` between `<!-- HARD RULES START -->` and `<!-- HARD RULES END -->`. Code checks them on every resume, and an edited block is put back at the next run. You can add rules of your own under `## My rules` in the same file; they can add to the hard rules but never loosen them. Three ways to do that:

- **Write them yourself**, one bullet each.
- **Research them.** In Claude Code, run `/research-resume-rules`. It researches resume practice for your field and level, proposes rules in `profile/resume-rules.proposed.md` and walks through them one at a time so you keep, edit or delete each. It can take several minutes.
- **Start with the hard rules only** and add rules later.

## Step 6: Notifications

All notifications are off. Turn each on separately in `config/preferences.json`:

- `notifications.imessage`: set `enabled` to `true` and `to` to your phone number. It texts through the Messages app on this Mac when a run has new roles or resumes. Set `everyRun` to `true` as well if you also want a text after every run that found nothing (about 24 a day with the hourly schedule).
- `notifications.email`: set `enabled` to `true` and `to` to your email address. It sends through the Mail app.
- `notifications.numbers`: set `enabled` to `true` for a Numbers spreadsheet of every role. It needs no address.

An address with `enabled` still `false` is ignored, and `enabled: true` with no address is refused by the check. Turning text or email on later doesn't send the resumes made before it; only new ones go out. The first time one of these runs, macOS asks whether it may control the app. Choose Allow.

## Step 7: The first pull

1. Run `node scripts/check-setup.mjs` again, and fix what it names until it says "Setup is complete."
2. Run the first pull:

   ```
   node scripts/job-pull.mjs --no-ai --backlog
   ```

   It can take a few minutes. It checks every board once, without Claude, and puts the roles that fit your rules in `data/jobs.csv`.
3. These roles have the Status "Backlog". They were already open, so no resumes are written for them. To get a resume for one, change its Status to `New` in the Status column of `data/jobs.csv`. Open it in a text editor, not in Numbers: Numbers saves a separate `.numbers` copy, and the pipeline never sees the change. Only roles found from now on get resumes automatically. A company you add later is handled the same way by itself: the roles already open on its board when it is first read are listed as Backlog.
4. If no roles landed, the boards had nothing that matched today, which is normal. Widen the titles or places in step 4 if you like.

## Step 8: The schedule

To have it run by itself every hour while this Mac is on, set `schedule.hourly` to `true`, then run:

```
node scripts/install-schedule.mjs
```

It turns the hourly job on or off to match the setting, and prints what it did. The hourly job signs in to Claude with the login from Step 1, not with an API key set only in your shell. To change it later, edit `schedule.hourly` and run it again. Run it again too if the project folder moves, or if you reinstall Node or Claude Code: with the job on, it refreshes the job's saved paths.

The weekly scout is separate and off by default: `schedule.scout.enabled` set to `true`, with a `day` (such as `"Monday"`) and an `hour` (0 to 23). It looks for companies worth watching and writes you a proposal to approve. It costs about $5 a run. It runs as part of a normal run, so it needs the hourly schedule or a run you start yourself.

Each Claude step has a spending cap: `claude.maxUsdPerStep` and `claude.maxUsdScout` in `config/preferences.json`.

## Finish

New roles get resumes automatically when the schedule is on, or whenever you run `node scripts/job-pull.mjs`. Finished resumes are in `outputs/resumes/`. To get a resume for a Backlog role, set it to `New`. Keep adding true detail to `profile/profile.md` and `profile/stories.md` as you remember it. What each setting does, and how to change the Word template, add companies and write your own rules, is in [CUSTOMIZING.md](CUSTOMIZING.md).
