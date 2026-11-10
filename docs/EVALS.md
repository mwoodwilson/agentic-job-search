# Evals: testing the fact-checker

An AI writer asked to match a job posting will bend facts to fit it. It rounds a number up, turns "worked with" into "led", moves a win to a more impressive job, or swaps your words for the posting's. Every line can still sound true. This project doesn't trust the writer to police itself. A second, separate Claude step fact-checks each resume line by line, and code checks the fact-checker's work.

The evals answer the next question: **how do you know the fact-checker works?**

## The setup

Two steps, kept apart on purpose:

- **The writer** drafts a resume from your profile and stories, aimed at one job.
- **The fact-checker** reads that resume and your files, and for every summary sentence and bullet gives a verdict (supported, stretched or unsupported) plus the exact line from your files that backs it.

Code then confirms each quoted line really exists in your files, and that it doesn't come from the resume itself. A made-up quote fails. A resume with a stretched or unsupported line goes back to the writer, up to three tries, and is held for your review if it still fails.

That design only works if the fact-checker catches stretches. So it gets its own tests.

## How the evals work

Each eval is a resume where the right answer is already known. All of them use a made-up person, Jordan Reyes, never a real user's data.

1. **One true resume.** Every line is backed by Jordan's files. The fact-checker must approve all of it. A single flag fails this case, so a checker that rejects everything can't pass.
2. **Four copies with one planted error each.** Every other line stays true. The fact-checker must flag the exact planted line.

| Case | The planted error | What the fact-checker said (latest run) |
|---|---|---|
| `jordan-final` | None | Approved every line |
| `changed-number` | A no-show rate that fell from 18% is written as 28% | "Number changed: the source says the no-show rate fell from 18% to 11%, not from 28%." |
| `inflated-ownership` | "Partnered with payments engineering" becomes "Led payments engineering" | "Ownership inflated: the profile says Jordan 'worked with' payments engineering … it never says Jordan led payments engineering." |
| `wrong-role` | A launch from the later job moved into the earlier one | "Work moved to the wrong role: the digital wallets launch … all happened at Larkfield Commerce (April 2024), not Wrenfield Health." |
| `keyword-list-summary` | A summary sentence rewritten as a string of true skills | "Reads as a keyword list: a string of nouns with no subject or verb rather than a natural sentence." |

The last case matters because facts alone can't catch it: every word is true, but the sentence says nothing the person did.

## Why the results can be trusted

- **Scored by the same code as real runs.** The evals use the same quote check the hourly run uses, so a pass means the real pipeline would have caught it too.
- **A pass can't be faked.** A planted line counts as caught only when the fact-checker flags that exact line, or backs it with a quote that isn't in Jordan's files. A skipped line doesn't count. The true resume must come back with zero flags.
- **One change per copy.** Free tests confirm each planted resume differs from the true one by exactly one line and still passes every code check, so only the fact-checker's judgment is being tested.
- **Sealed off from real data.** Eval runs can't read your profile, outputs or job data. They work in a temporary folder and leave nothing behind.

## Results

| Run | Result | Cost |
|---|---|---|
| First full run | 5 of 5 | $1.31 |
| After the final review's fixes | 5 of 5 | $1.26 |
| After the speed changes (drafts, files in the prompt) | 5 of 5 | $1.26 |

A full run costs about $1.30 in Claude usage. One case costs about $0.25.

## Growing the evals

The rule is simple: when something new goes wrong, add a case before fixing it. In daily use, the fact-checker has held back a resume that described a fact in the job posting's words instead of the way the person's own files did. That pattern is the next case to add.

To add one, copy the true resume, change one line to reproduce the problem, list that line as the one to flag, and confirm the case fails before fixing anything. Never change an expected result to make a case pass. The steps are in [evals/README.md](../evals/README.md).

## Run them yourself

```
node evals/run-checker.mjs                  # all 5 cases, about $1.30
node evals/run-checker.mjs changed-number   # one case, about $0.25
node --test                                 # the free tests, including the eval files themselves
```

Run the evals after changing the fact-checker skill, the code checks or the Claude model.
