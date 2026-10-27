// Makes made-up people in the LOCAL Supabase copy for the chat test, and keeps
// their test passwords in a file in the system's temp folder (never shown).
// Usage, from apps/web: npm run chat:local:seed
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
// Reads the LOCAL Supabase copy's address and keys (`npx supabase status`), and
// refuses anything that is not on this computer.
const { execSync } = require("child_process");
const os = require("os");
const path = require("path");
function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { SUPABASE_URL: get("API_URL"), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: get("PUBLISHABLE_KEY") || get("ANON_KEY"), SUPABASE_SECRET_KEY: get("SECRET_KEY") || get("SERVICE_ROLE_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.SUPABASE_URL)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const peopleFile = path.join(os.tmpdir(), "kiasa-chat-people.json");

const env = localEnv();
const site = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const people = [
  { email: "chrislim@kiasa.tech", name: "Chris Lim", admin: true },
  { email: "ana@example.com", name: "Ana Silva", status: "approved", organization: "Halden Mutual" },
  { email: "ben@example.com", name: "Ben Okoro", status: "approved", organization: "Varda Energy" },
  { email: "cara@example.com", name: "Cara Wu", status: "waiting", organization: "Osprey Freight" },
];
(async () => {
  const out = {};
  const { data: existing } = await site.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const person of people) {
    const password = crypto.randomBytes(12).toString("base64url");
    const found = existing.users.find(user => user.email === person.email);
    const user = found
      ? (await site.auth.admin.updateUserById(found.id, { password })).data.user
      : (await site.auth.admin.createUser({ email: person.email, password, email_confirm: true, user_metadata: { name: person.name } })).data.user;
    if (!person.admin) {
      await site.from("profiles").upsert({ id: user.id, email: person.email, name: person.name, organization: person.organization, reason: "I work with KIASA", status: person.status, decided_at: person.status === "approved" ? new Date().toISOString() : null });
    }
    out[person.email] = { id: user.id, name: person.name, password };
  }
  fs.writeFileSync(peopleFile, JSON.stringify(out, null, 2));
  console.log("made in the local copy:", Object.entries(out).map(([email, p]) => `${p.name} <${email}>`).join(", "));
})().catch(error => { console.error("failed:", error.message); process.exit(1); });
