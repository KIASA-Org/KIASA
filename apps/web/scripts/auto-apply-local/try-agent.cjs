// Gets the LOCAL Supabase copy ready for trying the agent: real Greenhouse job postings for
// made-up Ana, a made-up résumé for each, and the local model server's key. The agent only
// fills these forms: nothing is sent. Her saved details are kept if she has any.
// Usage, from apps/web: node scripts/auto-apply-local/try-agent.cjs [how many jobs | a file of links]
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
if (!/API_URL="?http:\/\/(127\.0\.0\.1|localhost):/.test(raw)) throw new Error("Refusing: this is only for the local Supabase copy");
const sql = statement => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA", { input: statement, encoding: "utf8" }).trim();
const q = text => `'${String(text).replace(/'/g, "''")}'`;

const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const ana = people["ana@example.com"];
const asked = process.argv[2] ?? "";
const HOW_MANY = Number(asked) || 4;
const LINKS = asked && !Number(asked) ? fs.readFileSync(asked, "utf8").match(/https?:\/\/[^\s"<>]+/g) ?? [] : [];
const BOARDS = ["stripe", "reddit", "coinbase", "robinhood", "gitlab", "discord"];

const resume = {
  info: { name: "Ana Silva", title: "Senior Backend Engineer", location: "Boston, MA", email: "ana@example.com", phone: "+1 415 555 0100", linkedin: "https://www.linkedin.com/in/anasilva-example" },
  summary: "Backend engineer with eight years building payment and billing systems in Go and Python.",
  skills: [{ category: "Languages", skills: ["Go", "Python", "SQL"] }, { category: "Infrastructure", skills: ["AWS", "Kubernetes", "PostgreSQL", "Kafka"] }],
  experience: [
    { title: "Senior Backend Engineer", company: "Northwind Payments", startDate: "May 2021", endDate: "Present", location: "Boston, MA", descriptionLines: ["Led the move of the invoicing service from a monolith to Go services on Kubernetes.", "Reduced failed payment retries by 30% by redesigning the retry queue on Kafka.", "Mentored three engineers and ran the on-call rotation for billing."] },
    { title: "Software Engineer", company: "Contoso Retail", startDate: "June 2019", endDate: "April 2021", location: "Boston, MA", descriptionLines: ["Built checkout APIs in Python serving the web and mobile apps.", "Added PostgreSQL read replicas to keep reporting from slowing down checkout."] },
    { title: "Junior Developer", company: "Fabrikam Software", startDate: "July 2017", endDate: "May 2019", location: "Boston, MA", descriptionLines: ["Maintained internal billing tools in Python."] },
  ],
  certifications: [],
  education: [
    { degree: "Bachelor of Science", major: "Computer Science", school: "Boston University", startDate: "2013", endDate: "2017" },
    { degree: "Master of Science", major: "Computer Science", school: "Northeastern University", startDate: "2018", endDate: "2020" },
  ],
};

const plainText = html => (html || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/<\/(p|div|li|h\d|ul)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 30000);

async function main() {
  // Nothing from an earlier try gets in the way.
  sql(`delete from public.apply_results where user_id = ${q(ana.id)};
       delete from public.tailored_resumes where user_id = ${q(ana.id)};
       delete from public.applications where user_id = ${q(ana.id)} and applied_at >= now() - interval '2 days';
       delete from public.jobs where url like 'https://job-boards.greenhouse.io/acme/%';
       update public.jobs set posted_at = now() - interval '30 days' where posted_at > now() - interval '7 days';
       insert into public.apply_control (user_id, mode) values (${q(ana.id)}, 'off') on conflict (user_id) do update set mode = 'off';
       insert into public.resume_profiles (user_id, profile, status) values (${q(ana.id)}, ${q(JSON.stringify(resume))}::jsonb, 'typed') on conflict (user_id) do update set profile = excluded.profile;`);

  let added = 0;
  for (const link of [...new Set(LINKS)]) {
    const at = new URL(link);
    const board = at.searchParams.get("for") ?? at.pathname.split("/").filter(Boolean)[0] ?? "";
    const token = at.searchParams.get("token") ?? at.pathname.match(/\/jobs\/(\d+)/)?.[1];
    const full = token ? await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${token}`).then(res => res.ok ? res.json() : null).catch(() => null) : null;
    const company = board ? board[0].toUpperCase() + board.slice(1) : "A company";
    const title = full?.title?.slice(0, 200) ?? (token ? "A job" : "A closed job");
    const job = sql(`insert into public.jobs (url, title, company, description, posted_at) values (${q(link)}, ${q(title)}, ${q(company.slice(0, 120))}, ${q(plainText(full?.content))}, now() - interval '${added} minutes')
      on conflict (url) do update set posted_at = excluded.posted_at, title = excluded.title, description = excluded.description returning id`).split("\n")[0];
    const made = { ...resume, summary: `${resume.summary} Tailored for ${title.slice(0, 80)}.` };
    sql(`insert into public.tailored_resumes (job_id, user_id, profile) values (${q(job)}, ${q(ana.id)}, ${q(JSON.stringify(made))}::jsonb);`);
    added++;
  }
  if (LINKS.length) console.log(`${added} jobs from the file.`);
  for (const board of LINKS.length ? [] : BOARDS) {
    if (added >= HOW_MANY) break;
    const list = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`).then(res => res.json()).catch(() => null);
    const first = list?.jobs?.[0];
    if (!first) { console.log(`${board}: its list could not be read, so it is left out`); continue; }
    const full = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${first.id}`).then(res => res.json()).catch(() => null);
    const url = `https://job-boards.greenhouse.io/${board}/jobs/${first.id}`;
    const company = board[0].toUpperCase() + board.slice(1);
    const job = sql(`insert into public.jobs (url, title, company, description, posted_at) values (${q(url)}, ${q(first.title.slice(0, 200))}, ${q(company)}, ${q(plainText(full?.content))}, now() - interval '${added} minutes')
      on conflict (url) do update set posted_at = excluded.posted_at, description = excluded.description returning id`).split("\n")[0];
    const made = { ...resume, summary: `${resume.summary} Tailored for ${first.title.slice(0, 80)}.` };
    sql(`insert into public.tailored_resumes (job_id, user_id, profile) values (${q(job)}, ${q(ana.id)}, ${q(JSON.stringify(made))}::jsonb);`);
    console.log(`added: ${company}, ${first.title}`);
    added++;
  }

  // The local model server says where it is with the same key file as the real one, because only
  // its hash is kept in the database.
  const keyFile = path.join(process.env.LOCALAPPDATA, "KIASA", "model-server-key.txt");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(keyFile, "utf8").trim()).digest("hex");
  sql(`insert into public.model_server_keys (key_hash) values (decode('${hash}', 'hex')) on conflict (key_hash) do nothing;`);
  console.log(`${added} jobs ready for ana@example.com.`);
}
main().catch(error => { console.error("Could not get ready:", error.message.split("\n").slice(0, 4).join(" ")); process.exit(1); });
