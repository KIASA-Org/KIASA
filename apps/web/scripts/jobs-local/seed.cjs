// Fills the LOCAL Supabase copy with a made-up month of KIASA Jobs, to see the
// pages with something in them: four more made-up members (beside the chat
// test's Ana and Ben), thirty days of job links, applications through each day,
// interviews, jobs won, pay, plans and résumés. Every job table is emptied
// first. Usage, from apps/web, after `npm run chat:local:seed`: npm run jobs:local:seed
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { url: get("API_URL"), secret: get("SECRET_KEY") || get("SERVICE_ROLE_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const sql = statement => execSync("docker exec -i supabase_db_web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q", { input: statement, stdio: ["pipe", "ignore", "inherit"] });

const env = localEnv();
const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const extra = [
  { email: "daniel@example.com", name: "Daniel Brooks", organization: "KIASA team" },
  { email: "mina@example.com", name: "Mina Park", organization: "KIASA team" },
  { email: "leo@example.com", name: "Leo Martins", organization: "KIASA team" },
  { email: "sara@example.com", name: "Sara Haddad", organization: "KIASA team" },
];
const TITLES = ["Senior Frontend Engineer", "Full-stack Developer", "Backend Engineer (Node.js)", "React Native Developer", "Platform Engineer",
  "Data Engineer", "Senior Python Developer", "DevOps Engineer", "Software Engineer II", "Staff Engineer, Web", "Machine Learning Engineer",
  "Product Engineer", "Site Reliability Engineer", "iOS Engineer", "Lead TypeScript Engineer", "Cloud Engineer (AWS)"];
const COMPANIES = ["Northwind Labs", "Halden", "Varda Energy", "Osprey Freight", "Lumen Health", "Brightfield", "Cobalt Pay", "Juniper AI",
  "Meridian Bank", "Tessellate", "Orbital Maps", "Fernhill Games", "Quantra", "Saltmarsh", "Kestrel Robotics", "Bluewater Insurance"];
const PLACES = ["Remote", "Remote (US)", "Remote (Europe)", "Berlin", "London", "Toronto", "Singapore", "Remote (Americas)"];
const ATS = [(co, id) => `https://boards.greenhouse.io/${co}/jobs/${id}`, (co, id) => `https://jobs.lever.co/${co}/${id}`,
  (co, id) => `https://jobs.ashbyhq.com/${co}/${id}`, (co, id) => `https://${co}.wd5.myworkdayjobs.com/en-US/careers/job/${id}`];
const pick = (list, n) => list[n % list.length];
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

(async () => {
  // The team: Ana and Ben from the chat test, and four more.
  const team = [{ id: people["ana@example.com"].id, name: "Ana Silva", pace: 0.82 }, { id: people["ben@example.com"].id, name: "Ben Okoro", pace: 0.64 }];
  const { data: listed } = await site.auth.admin.listUsers({ perPage: 1000 });
  for (const [index, person] of extra.entries()) {
    let id = listed.users.find(user => user.email === person.email)?.id;
    if (!id) {
      const made = await site.auth.admin.createUser({ email: person.email, password: crypto.randomBytes(18).toString("base64url"), email_confirm: true });
      if (made.error) throw made.error;
      id = made.data.user.id;
    }
    await site.from("profiles").upsert({ id, email: person.email, name: person.name, organization: person.organization, reason: "I work with KIASA", status: "approved", decided_at: new Date().toISOString(), decided_by: "chrislim@kiasa.tech" });
    team.push({ id, name: person.name, pace: [0.9, 0.5, 0.72, 0.35][index] });
  }
  // Two of them have photos, as real members do (each must stay in its circle).
  const sharp = require("sharp");
  for (const [n, member] of [team[0], team[2]].entries()) {
    const picture = await sharp({ create: { width: 320, height: 320, channels: 3, background: ["#2f6b45", "#1e4f73"][n] } })
      .composite([{ input: Buffer.from(`<svg width="320" height="320"><circle cx="160" cy="130" r="70" fill="#e6d3bf"/><rect x="60" y="215" width="200" height="120" rx="60" fill="#e6d3bf"/></svg>`) }])
      .webp().toBuffer();
    const where = `${member.id}/${crypto.randomUUID()}.webp`;
    const { error } = await site.storage.from("avatars").upload(where, picture, { contentType: "image/webp" });
    if (error) throw error;
    await site.from("avatars").upsert({ user_id: member.id, path: where });
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  sql(`truncate public.payments, public.positions, public.interviews, public.applications, public.plans, public.resumes, public.jobs;
       update public.job_settings set timezone = '${zone.replace(/'/g, "")}', currency = 'USD' where id = 1;`);

  // Thirty days of links, posted in the morning (today's: forty of them).
  const dayStart = offset => { const at = new Date(); at.setHours(0, 0, 0, 0); at.setDate(at.getDate() - offset); return at; };
  const jobs = [];
  let serial = 4100000;
  for (let offset = 29; offset >= 0; offset--) {
    const count = offset === 0 ? 40 : 18 + ((offset * 7) % 9);
    for (let n = 0; n < count; n++) {
      const company = pick(COMPANIES, serial * 7 + n);
      const posted = new Date(dayStart(offset).getTime() + (8 * 60 + ((n * 13) % 150)) * 60000);
      if (offset === 0 && posted > new Date()) posted.setTime(Date.now() - (count - n) * 60000);
      jobs.push({ id: crypto.randomUUID(), url: pick(ATS, n)(slug(company), serial++), title: pick(TITLES, serial + n * 3), company, location: pick(PLACES, serial + n), posted_at: posted.toISOString() });
    }
  }
  for (let at = 0; at < jobs.length; at += 300) { const { error } = await site.from("jobs").insert(jobs.slice(at, at + 300)); if (error) throw error; }

  // Each member works through most of each day's list, through the working day.
  // (The database stamps applications with now(); its trigger rests while the past is written.)
  const applications = [], interviews = [];
  const now = Date.now();
  for (const [who, member] of team.entries()) {
    for (const [index, job] of jobs.entries()) {
      const posted = new Date(job.posted_at).getTime();
      const roll = ((index * 31 + who * 17) % 100) / 100;
      if (roll > member.pace) continue;
      const at = Math.min(now - 60000 * (1 + ((index + who) % 50)), posted + (20 + ((index * 37 + who * 11) % 420)) * 60000);
      if (at < posted) continue;
      const fate = (index * 13 + who * 29) % 100;
      const status = fate < 6 ? "skipped" : fate < 12 ? "rejected" : fate < 17 ? "interview" : fate < 19 ? "offer" : fate < 20 ? "hired" : "applied";
      applications.push({ job_id: job.id, user_id: member.id, status, applied_at: status === "skipped" ? null : new Date(at).toISOString(),
        offered_at: status === "offer" || status === "hired" ? new Date(at + 6 * 86400000 > now ? now - 3600000 : at + 6 * 86400000).toISOString() : null,
        updated_at: new Date(at).toISOString() });
      if (status === "interview" && interviews.filter(entry => entry.user_id === member.id).length < 4) {
        const when = new Date(dayStart(-1 - (interviews.length % 6)).getTime() + (9 + ((index + who) % 8)) * 3600000 + ((index % 2) * 30) * 60000);
        interviews.push({ user_id: member.id, job_id: job.id, starts_at: when.toISOString(), minutes: [30, 45, 60, 60, 90][index % 5],
          kind: ["video", "phone", "technical", "video", "onsite"][index % 5], stage: ["First call", "Technical round", "Hiring manager", "Final round"][index % 4],
          place: index % 3 ? `https://meet.example.com/${slug(job.company)}-${index}` : null });
      }
    }
  }
  sql("alter table public.applications disable trigger application_written;");
  try {
    for (let at = 0; at < applications.length; at += 500) { const { error } = await site.from("applications").insert(applications.slice(at, at + 500)); if (error) throw error; }
  } finally {
    sql("alter table public.applications enable trigger application_written;");
  }
  { const { error } = await site.from("interviews").insert(interviews); if (error) throw error; }
  // Two interviews today, for the calendar's today.
  const todays = applications.filter(row => row.status === "interview").slice(0, 2);
  await site.from("interviews").insert(todays.map((row, index) => ({ user_id: row.user_id, job_id: row.job_id,
    starts_at: new Date(dayStart(0).getTime() + (11 + index * 3) * 3600000).toISOString(), minutes: 60, kind: "video", stage: "First call" })));

  // Jobs won (most confirmed, some waiting), and pay received.
  const salary = [6200, 5400, 7100, 4800, 6600, 5900];
  const positions = [];
  for (const [who, member] of team.entries()) {
    const held = [2, 1, 3, 0, 2, 1][who];
    for (let n = 0; n < held; n++) positions.push({ user_id: member.id, company: pick(COMPANIES, who * 3 + n), title: pick(TITLES, who + n * 5), monthly_salary: salary[(who + n) % 6] - n * 400,
      started_on: new Date(dayStart(40 + n * 20)).toISOString().slice(0, 10), status: who === 4 && n === 1 ? "pending" : "confirmed" });
  }
  positions.push({ user_id: team[3].id, company: "Cobalt Pay", title: "Backend Engineer (Node.js)", monthly_salary: 5200, started_on: null, status: "pending" });
  const { data: madePositions, error: positionError } = await site.from("positions").insert(positions).select("id, user_id, monthly_salary, status");
  if (positionError) throw positionError;
  const payments = [];
  for (const position of madePositions.filter(row => row.status === "confirmed")) {
    payments.push({ user_id: position.user_id, position_id: position.id, amount: position.monthly_salary, paid_on: new Date(dayStart(28)).toISOString().slice(0, 10), status: "confirmed" });
    if (position.monthly_salary > 5800) payments.push({ user_id: position.user_id, position_id: position.id, amount: position.monthly_salary, paid_on: new Date(dayStart(2)).toISOString().slice(0, 10), status: "confirmed" });
  }
  payments.push({ user_id: team[0].id, position_id: madePositions.find(row => row.user_id === team[0].id)?.id, amount: 3100, paid_on: new Date(dayStart(1)).toISOString().slice(0, 10), status: "pending", note: "Half-month" });
  { const { error } = await site.from("payments").insert(payments); if (error) throw error; }

  // Plans: thirty applications a day, three interviews a week, an offer a month; today's notes.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  const monday = (() => { const at = new Date(`${today}T00:00:00Z`); at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7)); return at.toISOString().slice(0, 10); })();
  const plans = team.flatMap((member, who) => [
    { user_id: member.id, period: "day", starts_on: today, applications: 30, note: who === 0 ? "Focus on React and TypeScript roles today." : who === 2 ? "Finish the Kestrel take-home first." : null },
    { user_id: member.id, period: "week", starts_on: monday, interviews: 3, applications: 150, note: who === 0 ? "Two final rounds this week: prepare system design." : null },
    { user_id: member.id, period: "month", starts_on: `${today.slice(0, 7)}-01`, offers: 1, applications: 600 },
  ]);
  { const { error } = await site.from("plans").insert(plans); if (error) throw error; }

  // Ana's résumés, and which she used.
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const resumes = [];
  for (const [n, title] of ["Frontend", "Full-stack"].entries()) {
    const where = `${team[0].id}/${crypto.randomUUID()}/ana-silva-${slug(title)}.pdf`;
    const { error } = await site.storage.from("resumes").upload(where, pdf, { contentType: "application/pdf" });
    if (error) throw error;
    resumes.push({ id: crypto.randomUUID(), user_id: team[0].id, title, path: where, file_name: `Ana Silva - ${title}.pdf`, mime: "application/pdf", size: 48200 + n * 3100, is_default: n === 0 });
  }
  { const { error } = await site.from("resumes").insert(resumes); if (error) throw error; }
  const anas = applications.filter(row => row.user_id === team[0].id && row.status !== "skipped");
  sql("alter table public.applications disable trigger application_written;");
  try {
    for (const [index, row] of anas.entries()) await site.from("applications").update({ resume_id: resumes[index % 3 === 0 ? 1 : 0].id }).eq("job_id", row.job_id).eq("user_id", row.user_id);
  } finally {
    sql("alter table public.applications enable trigger application_written;");
  }

  console.log(`${team.length} members, ${jobs.length} jobs over 30 days, ${applications.length} applications, ${interviews.length + todays.length} interviews, ${positions.length} jobs won, ${payments.length} payments, time zone ${zone}`);
})().catch(error => { console.error(error); process.exit(1); });
