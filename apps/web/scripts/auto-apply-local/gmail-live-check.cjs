#!/usr/bin/env node
// Checks the LIVE KIASA database to confirm the Gmail migration (20261104190000_apply_gmail.sql)
// was applied: the apply_gmail table and its three RPCs. Read-only — it changes nothing.
//
// Run from apps/web:   node scripts/auto-apply-local/gmail-live-check.cjs
// It reads SUPABASE_URL and SUPABASE_SECRET_KEY from apps/web/.env.local.

const fs = require("fs");
const path = require("path");

function env() {
  const file = path.join(__dirname, "..", "..", ".env.local");
  const text = fs.readFileSync(file, "utf8");
  const read = name => {
    const m = text.match(new RegExp("^" + name + "=(.*)$", "m"));
    if (!m) throw new Error("missing " + name + " in .env.local");
    return m[1].trim().replace(/^"|"$/g, "");
  };
  return { url: read("SUPABASE_URL"), key: read("SUPABASE_SECRET_KEY") };
}

async function main() {
  const { url, key } = env();
  const head = { apikey: key, Authorization: "Bearer " + key };
  let ok = true;
  const say = (good, label, detail) => {
    if (!good) ok = false;
    console.log((good ? "  OK   " : " MISS  ") + label + (detail ? "  — " + detail : ""));
  };

  // 1) The table exists (service key bypasses RLS; 200 with an array means it is there).
  {
    const r = await fetch(url + "/rest/v1/apply_gmail?select=user_id&limit=1", { headers: head });
    say(r.status === 200, "table public.apply_gmail", r.status === 200 ? "" : "HTTP " + r.status);
  }

  // 2) The RPCs exist. Calling with a key that owns nothing is harmless: a missing function
  //    answers 404 "Could not find the function", an existing one answers 200 (null/empty).
  const rpcs = [
    ["browser_agent_gmail", { agent_key: "kapp_does_not_exist" }],
    ["browser_agent_gmail_report", { agent_key: "kapp_does_not_exist", email: "x@example.com", connected: false }],
    ["apply_gmail_request", { connect: false }],
  ];
  for (const [name, body] of rpcs) {
    const r = await fetch(url + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { ...head, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const exists = r.status !== 404;
    say(exists, "rpc public." + name, exists ? "" : "not found (404)");
  }

  console.log(ok ? "\nGmail migration is applied on the live database." : "\nSome pieces are missing — run the migration in Supabase, then re-check.");
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error("check failed:", err.message);
  process.exit(2);
});
