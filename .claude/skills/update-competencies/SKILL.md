---
name: update-competencies
description: Rebuild the competencies files (archives/competencies-<family-slug>.md, one per role family) from the matching job description archives, pulling out the themes, competencies, skills and keywords those postings ask for, and how the user's profile covers them. Runs automatically after a job pull adds postings to an archive. Use when the user asks to update or refresh competencies, signals, themes or keywords.
---

# Update competencies

Runs automatically after each `node scripts/job-pull.mjs` that adds postings to an archive, on just those archives: the prompt names each archive and its competencies file. The user can also run it by hand.

## Files (paths are from the project folder)
Each role family (`search.families` in `config/preferences.json`) has one archive and one competencies file. The slug is the family name in lowercase with dashes ("Product Manager" is `product-manager`). Each archive feeds exactly one competencies file:

| Archive (read) | Competencies file (write) |
|---|---|
| `archives/jobs-<family-slug>.md` | `archives/competencies-<family-slug>.md` |

- Archives are append-only: never edit one. Each run's postings sit under a `# Run YYYY-MM-DD HH:MM: N new` heading, one `## <Title> | <Company>` section per posting.
- `profile/profile.md`: the user's roles, skills and Confirmed facts, for the coverage check.

## Rules
- **Never change the role guide.** If the competencies file has one, the block between `<!-- ROLE GUIDE START -->` and `<!-- ROLE GUIDE END -->` is researched reference material. Never edit, move or delete it. Rewrite only what comes after `<!-- ROLE GUIDE END -->` (or everything after the title line, when there is no role guide). The script also restores the block if it changes.
- **Only what the postings say.** Every competency, skill and keyword must come from the archive. Counts are counts of postings, not of mentions.
- **Never mix families.** A posting in one archive only counts toward that archive's competencies file.
- **Skip boilerplate:** benefits, legal/EEO text, company mission statements, and empty words ("passionate", "fast-paced").
- **Incremental:** the file's "through run" line says which runs are already counted. Only read runs after that date and merge them into the existing counts. Rebuild from scratch only if the user asks.
- Archives can be large. Read them a run at a time, never all at once.
- **Use only the file tools** (Read, Grep, Glob, Edit, Write). Don't run scripts or shell commands, not even to count: there is no shell when this runs automatically.

## Steps
For each archive the prompt names (or only the one the user names):
1. Read the competencies file's "Based on" line. If the file doesn't exist yet, create it with the title line and read every run in the archive. If the archive has no runs after "through run", say so and skip it.
2. Read the new runs. For each posting, note the competencies it asks for, the skills and tools, the recurring keywords, and the company.
3. Merge into the existing counts and rewrite the part of the competencies file below the role guide (keep the title line and the whole role guide block, if there is one, as they are) in this format:
   ```
   # <Family> competencies

   <the role guide block, exactly as it is, when the file has one>

   Based on: <N> postings · through run: <YYYY-MM-DD HH:MM> · updated: <YYYY-MM-DD>

   ## Top competencies
   ### <Competency>
   - Asked for by: <x> of <N> postings
   - What they mean: <one line, in the postings' own words>
   - Typical phrasing: "<phrase>", "<phrase>"
   - How interviews test it: <one line>
   (8–12 competencies, most-asked first)

   ## Skills and tools
   <skill> (<count>) · <skill> (<count>) · ... most common first

   ## Keywords to have on your resume
   <keyword> (<count>) · ... top 30, most common first

   ## Themes by company
   - <Company>: <one line on what they emphasize>

   ## How your profile covers this
   - Covered: <top keywords that appear in profile/profile.md>
   - Missing: <top keywords that appear nowhere in it; gaps to fill only with true experience, never to claim>

   ## How these postings differ from the role guide
   - <1–5 bullets: where the postings ask for more, less, or something different than the role guide describes; leave this section out when there is no role guide>
   ```
4. Finish with one line per file: postings added, and the biggest change (a new top competency, or a keyword that jumped).
