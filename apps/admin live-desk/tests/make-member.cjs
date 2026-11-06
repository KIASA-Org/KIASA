// A made-up member for these tests alone, on the LOCAL Supabase copy only. Other tests share Ana, Ben,
// Dia and Eli, and two people writing one script mix their words on its channel. Writes
// %TEMP%\kiasa-desk-member.json. Safe to run again.
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const WEB = path.resolve(__dirname, "../../web");
const { createClient } = require(path.join(WEB, "node_modules/@supabase/supabase-js"));
const raw = execSync("npx supabase status -o env", { cwd: WEB, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m")) ?? [])[1];
const url = get("API_URL");
const secret = get("SECRET_KEY") || get("SERVICE_ROLE_KEY");
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url ?? "")) throw new Error("Refusing: this is only for the local Supabase copy");

(async () => {
  const site = createClient(url, secret, { auth: { persistSession: false } });
  const email = "desk-test@example.com";
  const name = "Desk Tester";
  const password = crypto.randomBytes(18).toString("base64url");
  const found = (await site.auth.admin.listUsers({ perPage: 1000 })).data.users.find(user => user.email === email);
  const user = found
    ? (await site.auth.admin.updateUserById(found.id, { password })).data.user
    : (await site.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })).data.user;
  if (!user) throw new Error("could not make the test member");
  const made = await site.from("profiles").upsert({ id: user.id, email, name, organization: "Live Desk tests", reason: "Tests only", status: "approved", decided_at: new Date().toISOString() });
  if (made.error) throw new Error(made.error.message);
  fs.writeFileSync(path.join(os.tmpdir(), "kiasa-desk-member.json"), JSON.stringify({ email, name, id: user.id, password }));
  console.log(`ready: ${email}`);
})().catch(error => { console.error(error); process.exit(1); });
