---
name: tailor-resume
description: Write a resume for one new role in data/jobs.csv (Status "New"), aimed at that job's description and built only from the user's own profile/profile.md and profile/stories.md. It follows profile/resume-rules.md, covers at least 70% of the job's emphasized keywords using only true material, and is saved as a new section in outputs/tailored-resumes.md. Runs automatically after each job pull. Use when asked to tailor a resume for a role.
---

# Tailor resume

Runs automatically after each job pull, **one role per run**: the script names the role's link in the prompt. There is no rating step: every new role gets a resume. Can also be run by hand for one named role.

After you save, the script checks your resume in code (the six hard rules, format, counts, banned wording, keyword coverage) and a separate fact-checker (the check-resume skill) checks every claim against the user's files. If either finds problems, you are run again in **revision mode** with the list: fix only those lines in the existing section, keep everything else, and update the Keywords line, coverage count and Sources line to match. Never add a second section for the same link.

**Draft file.** In the automatic runs the prompt names the role's draft file (`data/drafts/<id>.md`). Save the resume there as the file's only section, and revise it there; never edit `outputs/tailored-resumes.md`. The script files the resume in `outputs/tailored-resumes.md` after the checks (up to 3 roles are written at once, each in its own draft).

**Files in the prompt.** When the prompt includes a file's contents between `<file path="…">` tags, use them as given and don't open that file again. Read any other file you need as usual.

## Files (paths are from the project folder)
- `data/jobs.csv`: the running list of roles. Status is the second cell and Link the last. Roles waiting for a resume have Status "New".
- `archives/jobs-<family-slug>.md`: the job description archives, one per role family (`search.families` in `config/preferences.json`; the slug is the family name in lowercase with dashes, so "Product Manager" is `archives/jobs-product-manager.md`). Each role is a section starting `## <Title> | <Company>`, with a `**Link:**` line matching the Link column in data/jobs.csv. Find a role by grepping its link across `archives/jobs-*.md`, then read from its `##` heading to the next `---`. Never read a whole archive.
- `archives/competencies-<family-slug>.md`: use the one matching the archive the role is in. It may start with a researched **role guide**, between `<!-- ROLE GUIDE START -->` and `<!-- ROLE GUIDE END -->`: what a successful person in that role looks like (core competencies, what each level must show, how resumes are screened, the interview loop). Below it is the running analysis of the real postings in the archive. If the file or the guide isn't there, work from the job description alone.
- `profile/resume-rules.md`: **read this first, every time.** The "Hard rules" block (between `<!-- HARD RULES START -->` and `<!-- HARD RULES END -->`) is never broken and overrides everything else in this skill. "My rules" below it are the user's own: follow every one that applies to this role. If one ever clashes with a hard rule, the hard rule wins.
- `config/preferences.json`: the `resume` section. `roles` is the fixed list of the user's jobs (title, company line, minimum bullets), in resume order. `note` is the experience note. `banned` is wording to keep out. `maxBullets` is the most bullets under one role. `candidate.name` is the name on the resume.
- `profile/profile.md`: **the main source of content and the one place for facts.** It is a living document the user keeps adding to. At the top, the user's "Professional narratives" and total years of experience. Then every job, most recent first, each ending with "Confirmed facts" (exact numbers and details to use as written). Then "Skills" and "Education", each with an "On resumes:" line.
- `profile/stories.md`: the user's raw notes, also a living document. Extra detail, context and achievements to draw on.
- `outputs/tailored-resumes.md`: where each new tailored resume is saved. Sections with a `Final:` line are resumes the user finalized themselves: true, and their wording may be reused or reframed.

## Rules
- **Synthesize, never copy the notes.** profile.md and stories.md are the user's own notes. They are a source of facts, not of wording. For each achievement, work out the problem, what the user did, the skill it proves to this hiring manager, and the outcome. Then write it fresh in clear, concise, professional, high-impact language. No phrase from the notes goes into the resume as written. Casual words, filler, hedges and internal code names never appear.
- **Write for this job.** Choose and phrase every bullet for what this job description asks for. Lead each role with the achievements most relevant to it. Use the job's own vocabulary where it truthfully describes the user's work. Don't copy sentences from the job description, and no keyword dumps: each keyword appears naturally, once or twice.
- **Target only what this job cites.** This job's description is the only source of the keywords and competencies to target. Every keyword, skill and competency the resume emphasizes must be cited in this job's description. The competencies file is used only for (1) the role guide's level expectations and screening signals, and (2) clearer phrasing of a competency this job already cites. Never use it to add a theme, skill or keyword this job doesn't ask for, even if most other postings do.
- **Never lie or stretch.** Every claim must trace to profile.md, stories.md or one of the user's finalized resumes, and every summary sentence and bullet needs a quote from one of those files to back it (hard rule 5): if you can't point to the line, don't write it. Numbers are used exactly as written there. No invented tools, titles, scope or results, and no upgrading "contributed" to "led". Test for each bullet: could the user explain it in detail in an interview, using their own notes as proof? If not, drop it.
- **Keep achievements in the right job.** Work from one role only goes under that role.
- **Titles, dates, companies, locations, role order and the experience note are fixed.** When `resume.roles` is set in config/preferences.json, use those roles exactly as written, in that order, and put `resume.note` (when it isn't empty) as the first line under "### Professional Experience", word for word and in italics (`*note*`, as in the layout in step 7). When `resume.roles` is empty, take every role from profile.md, most recent first, with its title, company, location and dates as written there.
- **Depth over keyword count.** Each bullet carries the context or challenge, what the user did, and the result with one or two numbers (hard rule 3). Keywords are woven into that story, never listed. Avoid any wording that matches `resume.banned`.
- **Time-bound results (hard rule 4).** Each of the user's two most recent roles needs at least 2 time-bound results, bullets that say when or over what period a result happened ("+40% YoY", "since Q2 2026", "within 3 months", "in 2025", "per week"); aim for 3. Use the timeframe the facts give and never invent one. If a recent role's facts give too few timeframes, write what is true: the check will hold the role for review, and the user can add the timeframes to profile.md.
- **You are the hiring manager drafting the best possible resume for this role.** Every line must read the way a sharp hiring manager would write it.
- **Write to the level.** Use the role guide's "Level expectations" for the job's level when there is a guide, otherwise the level the title and scope show: the bullets must show the scope, ambiguity and cross-team influence that level requires. Use "How resumes are screened" when there is a guide: lead with the signals that get a resume advanced and avoid the red flags it lists.
- **Bullet counts:** follow each role's `minBullets` in `resume.roles` and `resume.maxBullets` when they are set; the code checks them. Otherwise give the most recent role 4–5 bullets and older roles 2–3. The most recent roles get the strongest bullets.
- **One page, 200 characters per bullet at most (hard rule 2).** Keep the whole resume to one page with fewer bullets, never longer ones. If a resume still runs long, the script asks you to drop the least relevant bullet.

## Get it right on the first draft
Every revision is another paid round of writing and checking. These are the problems that most often send drafts back:
- **Aim for 180 characters or fewer per bullet.** 200 is the hard limit, and bullets that fail it usually land just over (201–206): write with room to spare.
- **Every summary sentence says what the user did or does.** Never stack the job's keywords in one sentence ("qualitative insights, quantitative analysis, ambiguity, tradeoffs…"). The fact-checker rejects a sentence that reads as a keyword list.
- **Avoid the fact-checker's common stretches.** The prompt includes them (from `.claude/skills/check-resume/SKILL.md`); a line that matches one is always sent back.
- **Use every number with exactly the scope its source gives:** what it counts, which work, which period. A total across several launches is never the result of one launch, and a count of two groups combined is never the count of one.
- **Claim only teams, places and results the files name.** Don't add partners, surfaces or audiences that the source doesn't state.
- **Fill in the coverage count by counting the ✓ marks** in the Keywords line.

## Steps
Pick the role: the one named in the prompt (by link) or by the user. If profile/profile.md has no experience yet, say "profile/profile.md has no experience yet, so no resumes were tailored." and stop. Then:

1. **Read the job.** Read its full section in the archives and the matching competencies file. If there is a role guide, read "Level expectations" and "How resumes are screened". Note the job's level (Senior, Staff, Principal, Manager, and so on) from its title and scope. Write one bulk list of the clearly emphasized keywords: skills, tools, methods, domains and responsibilities in the title, in the requirements/qualifications, or mentioned 2+ times. Skip boilerplate (benefits, legal/EEO text, mission statements) and empty words ("passionate," "fast-paced"). Usually 15–30 keywords. Note the 3–4 competencies the job stresses most, each with the phrase from the job description that cites it. A competency with no citing phrase is not targeted.
   Then **write the job's arc** in one or two sentences: who the hiring team is hiring and why (the problem this person solves, the kind of person they picture, and the competencies and keywords that matter most). The resume has to fit it.
2. **Pick the user's narratives.** Read "Professional narratives" at the top of profile.md. All of them are true; pick the one or two closest to the job's arc. They don't need to match perfectly. If even the closest narrative leaves most of the job uncovered, the 70% score in step 6 will say so honestly.
3. **Gather material.** For each role, in the fixed order, list every achievement in profile.md (including that role's "Confirmed facts") and stories.md that shows one of the keywords or competencies. A story usually proves several skills at once (cross-functional work can also show prioritization), so note every competency each story can honestly show.
4. **Write the resume.** Each bullet keeps the true core story of its achievement and is angled toward the competencies this job weighs most, so the whole resume reads as the chosen narrative fitting the job's arc. Fit the job's keywords naturally into the bullets first, by telling the true story in the job's language; use the summary for the rest. Keywords count anywhere, but never as a list.
   - **Summary:** about three sentences, 300–350 characters in total counting spaces (hard rule 1): the current title and total years of experience (from the narratives in profile.md); the chosen narrative, angled to the job's arc; one recent proof point with one headline number. It can carry several keywords, but it must read as natural sentences, never a string of keywords.
   - **Each role**, in the fixed order, with its fixed title, company, location and dates: the most relevant achievements, written fresh for this job.
   - **Skills:** 8–12 items from profile.md's skills that this job asks for, in `a | b | c` format.
   - **Education:** the "On resumes" line in profile.md's Education section.
5. **Polish pass (required before scoring).** First check every line against the six hard rules and fix any line that breaks one. Then read it against "My rules" in profile/resume-rules.md and apply the ones that fit this role. Then check that every skill, keyword and competency the resume emphasizes traces to this job's description; cut or rephrase any that only the competencies file suggested. Then read every line as the hiring manager for this role would. Rewrite any line that echoes the notes' wording, reads casual or vague, or doesn't make the impact obvious in one read. Each bullet must lead with a strong verb, state the scope or challenge, and land the result.
6. **Score.** Coverage = keywords that appear in the new resume ÷ total keywords (count the ✓ marks for the coverage line). A keyword counts if the job's wording, or a standard variant ("A/B test" / "A/B testing"), appears.
   - **70% or more:** save it (step 7).
   - **Under 70%:** respond `Could not tailor resume without lying.` with the coverage reached and the missing keywords. Save no resume.
7. **Save.** When the prompt names a draft file, save the section below as that file's only content (the script files it in outputs/tailored-resumes.md). Otherwise (a run by hand), add a new section to outputs/tailored-resumes.md directly below the file's intro text (newest first). Never overwrite an earlier resume, and change nothing outside this role's section:
   ```
   ---

   ## <Title> | <Company> (<YYYY-MM-DD>)
   Link: <job link> · Keyword coverage: <x>/<y> (<z>%)
   Arc: <the job's arc in one sentence> · Narrative: <the one or two narratives from profile.md that fit it>
   Keywords: ✓ keyword, ✓ keyword, ✗ keyword, ...
   Sources: <each bullet's short label → where it came from, e.g. "One-page checkout → profile/profile.md, Senior Product Manager">

   ### Professional Summary
   <summary paragraph>

   ### Professional Experience
   *<resume.note, only when it is set>*

   **<Title>** · <Company> (<Location>) · <Start> – <End>
   - <bullet>
   - **<Bold lead:>** <rest of bullet>   ← only for a labeled item such as "Side project:"

   (repeat for each role, in the fixed order)

   ### Education & Certifications
   - <School> | <Degree> | <Year>

   ### Skills
   <skill> | <skill> | ...
   ```
   Use exactly this layout. The coverage count must equal the number of ✓ marks and the total must equal the number of keywords listed: the code recomputes both. The lines above "### Professional Summary" (Link, Arc, Keywords, Sources) are working notes for the user and the checks: they never appear on the resume, its Word/PDF files or the email. The script turns the rest into a Word file and a PDF with the user's template formatting (`templates/resume-template.docx` unless `resume.template` says otherwise), so anything outside this layout is lost.
8. **Never edit `data/jobs.csv`.** The script sets each role's Status after checking your resume.

## Learning from the user's edits
Only when this skill is run by hand. When the user saves their own edited version of a resume (a `.pages` file next to the generated one in `outputs/resumes/<family>/`), it is the final version: the script never rebuilds or overwrites it. As soon as the user says they saved their own version, do all of this automatically, without asking: export its text and a PDF of it (replacing the generated .pdf; delete the generated .docx), compare it line by line with the generated section in outputs/tailored-resumes.md, and replace that section's resume text with theirs. Add this line right after the section's `Link:` line: `Final: <Name> reviewed and finalized this resume on <YYYY-MM-DD>. The Word file and its PDF are the final version; the text below matches it.` Their edits show their taste for that role, not rules: a line they cut can still be right for another role. Add a rule under "## My rules" in profile/resume-rules.md only when they say "never" or "always", and never change the hard rules block. New true facts they add go into profile.md, under that role's "Confirmed facts".

## Output
One line per role: saved (with coverage % and the narratives used) or "Could not tailor resume without lying." (with missing keywords).

When the prompt asks for it, end with exactly one line: `RESULT: saved` or `RESULT: could not tailor`.

Don't try to run scripts or shell commands (for example to count characters): they're blocked, and the code measures every bullet after you save.

## Optional: short version (ONLY when the user explicitly asks for it)

Never make a short version on your own. The automatic runs and the steps above always produce the normal, full resume, and nothing in this section changes them. Only when the user asks for a short version of a role's resume:

1. **Keep the full resume as it is.** The short version is an extra, separate resume for the same role. Never edit or replace the full one.
2. **Write it to these limits:**
   - Professional summary of 300–350 characters (hard rule 1, same as every resume).
   - Every bullet under 180 characters.
   - Every bullet has numbers.
   - Every bullet has a time frame: YoY, per week, since 2024, in 2026, annual, and so on.
   - At least 70% of the job's major keywords, listed and scored as in steps 1 and 6.
3. **Keep every named detail from the full version:** cut filler words, never the named product, tool or specific. All other rules still apply.
4. **Save it as its own section** in outputs/tailored-resumes.md, directly below the intro text, with the same heading as the full version and one extra line right after the `Link:` line:
   ```
   Version: short
   ```
   That line is what makes the Word/PDF step name the files with **[brackets]** instead of (parentheses):
   - full resume: `<Name> Resume (<Company> - <Title>).pdf`
   - short version: `<Name> Resume [<Company> - <Title>].pdf`

   Never put "short", "shortened" or similar in any file name or heading; the brackets are the only marker.
5. Never edit `data/jobs.csv`.
