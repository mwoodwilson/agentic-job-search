---
name: craft-stories
description: Turn the raw notes in profile/stories.md and the answers in profile/interview-practice.md into polished, interview-ready stories tagged with competencies, saved in profile/crafted-stories.md. Use when the user wants to write, build, polish or fix interview stories, or see which competencies still lack a story.
---

# Craft stories

The user starts this when they want to turn raw material into stories.

## Files (paths are from the project folder)
- `profile/stories.md`: the user's raw, stream-of-consciousness notes. It is a living document they keep adding to.
- `profile/interview-practice.md`: their answers from mock interviews, plus debriefs (what was weak, what was missing).
- `archives/competencies-<family-slug>.md`: one per role family (`search.families` in `config/preferences.json`; the slug is the family name in lowercase with dashes). Each file may start with a researched **role guide**, between `<!-- ROLE GUIDE START -->` and `<!-- ROLE GUIDE END -->`: what a successful person in that role looks like (core competencies, what each level must show, the interview loop and how each round is scored). Below it is the running analysis of the real postings in the matching archive. Each story gets a line naming the 2–3 competencies it proves, using the exact competency names from the role guides' "Core competencies" sections (or the "Top competencies" in the files that have no role guide), so interview-prep can find the right story for a question that tests that competency.
- `profile/crafted-stories.md`: finished stories (output).

## Rules
- **Never invent anything.** Use only what's in profile/stories.md, profile/interview-practice.md, or what the user tells you. If a detail is missing, ask; don't fill it in.
- **Don't change the sources.** Only read profile/stories.md and profile/interview-practice.md; only write to profile/crafted-stories.md.
- **Recency:** when two notes show the same competency, prefer the more recent work.

## Steps
1. Read profile/stories.md, profile/interview-practice.md, the competencies files and profile/crafted-stories.md.
2. Suggest 3–5 stories to craft: material that isn't crafted yet, with enough substance, ideally covering competencies with no story yet. Use the debriefs in profile/interview-practice.md to spot answers worth turning into a stronger story. The user picks, or names their own.
3. For each, ask follow-up questions two or three at a time until you have: the situation and stakes, what *they* did (not the team), a decision or trade-off they made, the result (with a number if one exists), and what they learned.
4. Write it to be about 60–90 seconds spoken (200–250 words):
   ```
   ## <Story title>
   Role: <Company, year> · Competencies: <2–3 names from the competencies files>
   Best for questions like: "<example question>", "<example question>"
   Sources: <profile/stories.md note / profile/interview-practice.md session it came from>
   **Situation:** ...
   **What I did:** ...
   **Decision / trade-off:** ...
   **Result:** ...
   **What I learned:** ...
   ```
5. Show it, revise with the user, then add it to profile/crafted-stories.md (replace the earlier version if it's a rewrite of the same story).
6. Finish by listing which core competencies in the role guides have no crafted story yet, so the user knows which stories to prepare next.
