# Résumé Keyword Fix Prompt

A résumé was tailored for the job below, and KIASA's applicant-tracking keyword scan scored it under the pass mark. You close the gap: after your changes, every keyword listed as missing appears in the résumé, spelled as listed, and reads as real work in the two most recent roles.

## Input

One JSON object in a ```json block after this prompt:

- `company`, `title`, `jd`: the job and its description.
- `score`, `needed`: the résumé's match score now, and the score it must reach (out of 100).
- `missing.required`: keywords the job requires that the résumé lacks. **Each one must be added.**
- `missing.preferred`: keywords the job prefers that the résumé lacks. Add every one that fits the candidate's roles.
- `missing.title`: words of the job's title the résumé's headline lacks (may be empty).
- `profile`: the résumé as it is now.

## How to add a keyword

1. Spell it exactly as listed (`Kubernetes`, `CI/CD`, `REST APIs`), not a variant, an abbreviation or a translation.
2. Put it in `skills_add`, in the existing category it belongs to (a new category only when none fits).
3. For every **required** keyword, also put it in a bullet of `experience[0]` or `experience[1]`: rewrite an existing bullet (`exp`) to include it where it fits that bullet's work, or add a new bullet (`exp_add`) that describes concrete work with it, in the same style, tense and length as the role's other bullets (one sentence, at least 25 words, a result where the role's bullets have results).
4. Group related keywords in one bullet where they belong together; do not write one bullet per keyword, and do not list keywords as a bare list inside a bullet.
5. If `missing.title` is not empty, update the headline title (`info`) to include those words while staying a real job title (for example `Senior Backend Engineer, Maps`).
6. Mention a required keyword in the summary too when it is central to the job.

## What must not change

- Only `experience[0]` and `experience[1]` may get rewritten or new bullets. Older roles stay exactly as they are.
- Never change a role's company, title, dates or location; never change education, certifications, the name or contact details.
- Keep every keyword the résumé already has. Rewrite a bullet only to add keywords, keeping its facts and numbers.
- Every `original` you give is copied character for character from `profile` (the exact current headline title, summary, bullet or skills list). A paraphrased `original` is not found and the change is lost.

## Output

Return ONLY a JSON object inside a ```json code block, with this structure. Omit any section you do not change.

```json
{
  "info": {
    "original": { "title": "<exact current profile.info.title>" },
    "updated": { "title": "<title including missing.title words>" }
  },
  "summary": {
    "original": "<exact current summary>",
    "updated": "<summary with the central required keywords>"
  },
  "exp": [
    {
      "original": { "title": "<exact role title>", "company": "<exact company>", "description": "<EXACT one current bullet>" },
      "updated": { "title": "<same role title>", "company": "<same company>", "description": "<that bullet, with keywords added>" }
    }
  ],
  "skills": {
    "<existing category name>": {
      "original": ["<exact current skills of that category>"],
      "updated": ["<the same skills, plus missing ones that belong here>"]
    }
  },
  "exp_add": [
    {
      "target": { "title": "<exact role title>", "company": "<exact company>" },
      "descriptionLines": ["<new bullet using missing required keywords>"]
    }
  ],
  "skills_add": [
    { "category": "<existing category name>", "skills": ["<missing keyword>"] }
  ]
}
```

Before answering, check: every keyword in `missing.required` appears, spelled as listed, in your `skills_add` (or `skills`) **and** in a bullet; every `original` is copied exactly; no older role is touched.
