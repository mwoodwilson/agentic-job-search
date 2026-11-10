# Optional inbox: jobs from you or another agent

The pipeline watches the job boards of the companies you picked. For a job it can't see, such as one a recruiter sent you, a job on a site it doesn't read or a company you haven't added, drop it in `inbox.md`. You can paste it yourself, or let another agent do it for you: OpenClaw, or any agent that can edit a file on your Mac.

## How it works

1. The first run creates `inbox.md` in the project folder from the template below. It is git-ignored, like your other files.
2. You or your agent add one entry per job below the `<!-- ENTRIES BELOW -->` line.
3. The next run reads each entry (the `import-jobs` skill, which only reads the entries into a file), and code adds them to `data/jobs.csv` and the job archives, with the pay check recorded in the Pay check column. Then each new role gets a resume like any other, written and fact-checked.
4. The imported entries are cleared from `inbox.md`. Everything above the `<!-- ENTRIES BELOW -->` line is never touched.

Nothing in the inbox is filtered by title, place or pay: whoever put it there already chose it. A job whose link is already in your list, or whose company and title match one that is, is skipped. An entry with no link stays in the inbox. To import and write now without waiting for the hourly run or checking the job boards, run `node scripts/job-pull.mjs --resume-only`.

## The template

This is the text `inbox.md` is made from. The two marker lines and everything between them are read by the job pull, so keep them and the text between them exactly as they are.

````text
<!-- INBOX TEMPLATE START -->
# Inbox

Add jobs you find anywhere (or have another agent add them) below the ENTRIES BELOW line, one entry per job. Each entry starts with a `---` line and needs a link; the other lines help. The next run adds them to your job list and clears them from this file. Don't change anything above that line.

```
---
Link: https://example.com/jobs/123
Title: Senior Product Manager
Company: Acme
Location: Remote (US)
Pay: $150,000 – $190,000 base
Posted: 2026-11-01
Description: The full job description, pasted as is.
```

<!-- ENTRIES BELOW -->
<!-- INBOX TEMPLATE END -->
````

## Entry format

Each entry starts with a line of three dashes and has one field per line. Only the link is needed; the rest helps.

| Field | What to put |
|---|---|
| `Link:` | The job posting's own address. Required. |
| `Title:` | The job title. |
| `Company:` | The company name. |
| `Location:` | Where the job is, such as `Remote (US)` or `Chicago, IL`. |
| `Pay:` | The pay as the posting states it, such as `$150,000 – $190,000 base`. |
| `Posted:` | The posting date as `YYYY-MM-DD`, if known. |
| `Description:` | The whole job description, pasted as it is, on this line and the lines after it. The resume is tailored from this, so don't shorten it. |

Entries don't have to be exact. Each one is read as free text, and a field that isn't there is left blank, never guessed.

## Example prompt for OpenClaw or any agent

Give your agent something like this, with your own search in place of the brackets:

```text
You help with my job search. When you find a job that fits what I'm looking for
([the kinds of role, places and pay you want]), add it to the file inbox.md in
my agentic-job-search folder ([the folder's path]).

How to add a job:
- Add it at the very end of the file, below the line <!-- ENTRIES BELOW -->.
  Never change anything above that line.
- Start each job with a line containing only ---, then these lines:
  Link:, Title:, Company:, Location:, Pay:, Posted: (as YYYY-MM-DD) and
  Description:
- Link is the posting's own web address. Skip any job that has no link.
- Paste the whole job description under Description: exactly as it appears.
  Don't summarize or reword it.
- If a field isn't in the posting, leave it blank. Don't guess.
- If the link is already in inbox.md, don't add it again.

Don't edit any other file, and don't run anything else.
```

The step that reads the inbox can read files only inside the project folder, writes only two (`inbox.md` and `data/inbox-import.json`), and can't run shell commands or open web pages, so an entry can't make it run anything, read your other files or send anything out.
