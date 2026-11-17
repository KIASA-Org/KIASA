// Checks KIASA's résumé match score and its fix rounds (src/lib/resume/score.ts,
// rounds.ts) without the site: how a job's description is read, what a
// résumé scores, and how answers under the pass mark go to a fix round and,
// after the last, are rejected. Run: npm run resume:score:check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// The site's own imports name no extension ("./text"): found as .ts here.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { descriptionKeywords, descriptionSections, scoreResume, PASS_SCORE, FIX_ROUNDS } = await import("../../src/lib/resume/score.ts");
const { tailorRounds, answersOf } = await import("../../src/lib/resume/rounds.ts");

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`);
};
const terms = (jd, company) => Object.fromEntries(descriptionKeywords(jd, company).map(term => [term.term, term]));

// --- Reading a description ---------------------------------------------------
const JD = `Acme builds payment software for banks.

About Acme
Acme was founded in 2012 and is a Fortune 500 favourite using Salesforce and Excel.

What you'll do:
• Build Go services on Kubernetes and AWS, with Terraform.
• Own CI/CD pipelines and on-call for distributed systems.
• Write Python data pipelines; go above and beyond for customers.
• Work with Kafka and PostgreSQL every day; Kafka is everywhere here, Kafka at scale.

Requirements:
- 5+ years with Go or Java
- Experience with HorizonDB, our in-house store (HorizonDB powers everything)
- GraphQL experience is a plus

Nice to have:
- React, TypeScript
- Datadog

Benefits:
- 401(k), dental, Docker stickers, unlimited PTO
- Salary: $180,000 - $220,000

Acme is an equal opportunity employer. We use Snowflake for reporting.`;
const found = terms(JD, "Acme");
check("required keywords are found", ["Go", "Kubernetes", "AWS", "Terraform", "CI/CD", "On-call", "Distributed systems", "Python", "Data pipelines", "Kafka", "PostgreSQL", "Java"].every(term => found[term]?.level === "required"),
  JSON.stringify(Object.keys(found)));
check("a preferred section counts as preferred", found.React?.level === "preferred" && found.TypeScript?.level === "preferred" && found.Datadog?.level === "preferred");
check("a line saying 'a plus' counts as preferred", found.GraphQL?.level === "preferred");
check("benefits are left out (Docker named only there)", !found.Docker);
check("'about the company' is left out (Excel named only there)", !found.Excel);
check("a keyword said three times weighs more", found.Kafka?.weight === 4 && found.Terraform?.weight === 3, `Kafka ${found.Kafka?.weight}, Terraform ${found.Terraform?.weight}`);
check("a product named twice is a keyword, weighed as preferred", found.HorizonDB?.weight === 1);
check("'go above and beyond' is not Go (Go found by its name)", found.Go?.mentions === 2, `Go mentions ${found.Go?.mentions}`);
check("the employer's own name is not a keyword", !terms("Requirements:\n- Oracle databases at Oracle, Oracle Cloud\n- Java", "Oracle Corporation").Oracle);
check("page words run together are not products", !terms("Requirements:\n- DegreePreferred and DegreePreferred\n- EducationBachelor EducationBachelor").DegreePreferred);
check("C++ is not C, and 'Series C' is not C", (() => { const t = terms("Requirements:\n- C++ and C++ daily\n- We raised a Series C"); return !!t["C++"] && !t.C; })());
const html = terms("<p><b>Requirements</b></p><ul><li>Rust and Kafka</li><li>Kubernetes</li></ul><p><b>Benefits</b></p><ul><li>Docker</li></ul>");
check("a description kept as HTML is read as text", !!html.Rust && !!html.Kubernetes && !html.Docker, JSON.stringify(Object.keys(html)));
check("sections: what is before any heading counts as preferred", descriptionSections("Intro with Rust.\nRequirements:\n- Go")[0].level === "preferred");

// --- Scoring a résumé ---------------------------------------------------------
const base = {
  info: { name: "Jane Doe", title: "Senior Backend Engineer", location: "Austin, TX", email: "jane@example.com", phone: "555-0100", linkedin: "" },
  summary: "Backend engineer building payment platforms with Go and Python on AWS.",
  skills: [{ category: "Languages", skills: ["Go", "Python", "Java"] }, { category: "Cloud", skills: ["AWS", "Kubernetes"] }],
  experience: [
    { title: "Senior Software Engineer", company: "Payco", startDate: "2021", endDate: "Present", location: "Remote",
      descriptionLines: ["Built Go services on Kubernetes handling card authorizations for twelve banks, cutting decline errors by a third across two quarters of steady growth."] },
    { title: "Software Engineer", company: "Bankly", startDate: "2018", endDate: "2021", location: "Austin, TX",
      descriptionLines: ["Wrote Python services and data pipelines that reconciled ledger entries nightly for regional banks, replacing a manual process run by four analysts."] },
    { title: "Developer", company: "Old Co", startDate: "2015", endDate: "2018", location: "Austin, TX",
      descriptionLines: ["Maintained Java reporting jobs for the finance team, keeping monthly close reports on time for three years running without missed deadlines."] },
  ],
  certifications: [], education: [{ degree: "BS", major: "Computer Science", school: "UT Austin", startDate: "2011", endDate: "2015" }],
};
const job = { company: "Acme", title: "Senior Backend Engineer", jd: JD };
const scored = scoreResume(base, job);
check("a résumé lacking required keywords scores under the pass mark", !scored.pass && scored.score < PASS_SCORE, `score ${scored.score}`);
check("what it lacks is named", ["Terraform", "Kafka", "PostgreSQL", "CI/CD"].every(term => scored.missing.required.includes(term)), scored.missing.required.join(", "));
check("a title the headline has matches", scored.title.missing.length === 0);
check("a title word the headline lacks is named", scoreResume(base, { ...job, title: "Backend Engineer, Payments" }).title.missing.join() === "payments");
check("the same résumé always scores the same", scoreResume(base, job).score === scored.score);
const everything = structuredClone(base);
everything.skills.push({ category: "More", skills: [...scored.missing.required, ...scored.missing.preferred] });
const full = scoreResume(everything, job);
check("a résumé with every keyword scores 100", full.score === 100 && full.pass, `score ${full.score}, missing ${full.missing.required} / ${full.missing.preferred}`);

// --- Fix rounds -----------------------------------------------------------------
const answer = change => "```json\n" + JSON.stringify(change) + "\n```";
const fixPrompt = () => "FIX PROMPT";
const tailored = answer({ skills_add: [{ category: "Cloud", skills: ["Terraform"] }] });
const first = tailorRounds(base, [tailored], job, fixPrompt);
check("under the pass mark, the first answer gets a fix round", !first.profile && !!first.fix && first.report.score?.score < PASS_SCORE);
check("the fix round's text has the fix prompt, what is missing, and no email or phone",
  first.fix?.startsWith("FIX PROMPT") && first.fix.includes('"Kafka"') && !first.fix.includes("jane@example.com") && !first.fix.includes("555-0100"));
const record = JSON.parse(/```json\n([\s\S]*)\n```/.exec(first.fix)[1]);
const missing = [...record.missing.required, ...record.missing.preferred];
const fixAnswer = answer({
  skills_add: [{ category: "Cloud", skills: missing }],
  exp_add: [{ target: { company: "Payco" }, descriptionLines: [`Ran ${record.missing.required.join(", ")} for the payment platform, keeping every release on time and every incident reviewed within one business day for the team.`] }],
});
const second = tailorRounds(base, [tailored, fixAnswer], job, fixPrompt);
check("a fix round that adds what is missing passes, and the résumé is kept", !!second.profile && second.report.score?.pass && !second.fix && second.report.rounds === 2,
  JSON.stringify(second.report.score));
const nothing = answer({ skills_add: [{ category: "Cloud", skills: ["AWS"] }] });
const third = tailorRounds(base, [tailored, nothing, nothing], job, fixPrompt);
check(`still under it after ${FIX_ROUNDS} fix rounds, it is rejected`, !third.profile && !third.fix && /^Rejected: Match score \d+ of 100 \(needs 96\)/.test(third.report.errors[0] ?? ""), third.report.errors[0]);
const frozen = answer({ exp_add: [{ target: { company: "Old Co" }, descriptionLines: ["Added Terraform, Kafka, PostgreSQL and CI/CD to the old reporting jobs, which is not allowed for a role this old in the résumé."] }] });
const touched = tailorRounds(base, [tailored, frozen], job, fixPrompt);
check("a fix round may not change an older role", touched.report.rejected.some(line => line.startsWith("Fix round 1:")) && !!touched.fix);
const junk = tailorRounds(base, [tailored, "no json here"], job, fixPrompt);
check("a fix round's unreadable answer changes nothing, and is said", junk.report.warnings.some(line => /Fix round 1: its answer could not be read/.test(line)) && !!junk.fix);
const noDescription = tailorRounds(base, [tailored], { ...job, jd: "" }, fixPrompt);
check("with no description to score against, the résumé is kept unscored", !!noDescription.profile && !noDescription.report.score);
check("more answers than the rounds allow are refused", answersOf(["a", "b", "c"])?.length === 3 && answersOf(["a", "b", "c", "d"]) === null);

// --- The pinned prompts are untouched ----------------------------------------------
const sums = JSON.parse(readFileSync(new URL("../../src/lib/resume/prompts/CHECKSUMS.json", import.meta.url), "utf8"));
// As committed: a Windows checkout (core.autocrlf) ends its lines with CR LF.
const sha = file => createHash("sha256").update(readFileSync(new URL(`../../src/lib/resume/prompts/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n")).digest("hex");
check("the init and tailoring prompts are as pinned", sha("AUTO_GENERAGE_PROMPT_init.md") === sums.init && sha("AUTO_UPDATE_PROMPT_COMPREHENSIVE.md") === sums.comprehensive);

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
