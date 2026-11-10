---
name: import-jobs
description: Read the job descriptions and links dropped in inbox.md into data/inbox-import.json, then clear them from the inbox. job-pull.mjs adds them to data/jobs.csv and the archives, so tailor-resume writes a resume for each. Runs automatically at the start of each job-pull.mjs run when the inbox has entries. Use when asked to import jobs or process the inbox.
---

# Import jobs

Runs automatically at the start of every `node scripts/job-pull.mjs` run when the inbox has entries. Your only job is to read the entries carefully. The script does everything else: duplicate checks, the pay check, adding rows to data/jobs.csv, and appending to the archives.

## Files (paths are from the project folder)
- `inbox.md`: where the user, or another agent working for them, drops jobs. Entries are below the `<!-- ENTRIES BELOW -->` marker, any number of them. Each starts with a `---` line and has a link; usually also Title, Company, Location, Pay, Posted and a Description. Entries may not follow the format exactly, so read each one as free text.
- `data/inbox-import.json`: what you write (create it, or replace it if it exists).

## Rules
- **Only what the entry says.** Never invent a title, company, pay or date. Use "" when the entry doesn't say, except title and company, which you may take from the description text.
- **Full description.** Copy the description exactly as given, all of it.
- **Use the file tools** (Read, Write) for every change. Shell commands aren't allowed when this runs automatically.

## Steps
1. Read inbox.md and find every entry below the marker.
2. For each entry, pull out: `url`, `title`, `company`, `location`, `team`, `pay` (as written), `posted` (YYYY-MM-DD, or ""), `description`.
3. Write all of them to data/inbox-import.json as one JSON array, in inbox order:
   ```json
   [
     {"url": "https://...", "title": "...", "company": "...", "location": "...", "team": "",
      "pay": "$150,000 – $190,000 base", "posted": "2026-11-01", "description": "full text..."}
   ]
   ```
   It must be valid JSON. Escape quotes and line breaks inside the description.
4. Clear the inbox: read inbox.md again (entries may have been added meanwhile), then rewrite it with everything up to and including the `<!-- ENTRIES BELOW -->` line, followed by any entries that are **not** in your JSON. Never change anything above the marker.

## Output
One line per entry: title, company and link read. Flag any entry with no link (leave it in the inbox).
