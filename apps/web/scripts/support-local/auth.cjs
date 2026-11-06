// Who may do what in a support session, against the LOCAL Supabase copy and the site on
// port 3002 (built with the local copy's keys). No media: the database's rules, the relay
// endpoints and the audit log. Prints PASS/FAIL per step.
// Usage, from apps/web: npx supabase start; apply the migration; npm run chat:local:seed;
// serve the site on 3002 (KIASA_LIMITS=on for the rate-limit step); node scripts/support-local/auth.cjs
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

function localEnv() {
  const raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const get = name => (raw.match(new RegExp(`^${name}="?([^"\\n]*)"?`, "m")) || [])[1] || "";
  const env = { url: get("API_URL"), publishable: get("PUBLISHABLE_KEY") || get("ANON_KEY"), secret: get("SECRET_KEY") || get("SERVICE_ROLE_KEY") };
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.url)) throw new Error("Refusing: this is only for the local Supabase copy");
  return env;
}
const env = localEnv();
const BASE = "http://127.0.0.1:3002";
const people = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "kiasa-chat-people.json"), "utf8"));
const results = [];
async function step(name, fn) {
  try { const note = await fn(); results.push(`PASS  ${name}${note ? ` (${note})` : ""}`); }
  catch (error) { results.push(`FAIL  ${name}: ${String(error.message).split("\n")[0]}`); }
}
const expectError = async (promise, pattern) => {
  const { error } = await promise;
  if (!error) throw new Error("it was allowed");
  if (pattern && !pattern.test(error.message)) throw new Error(`wrong refusal: ${error.message}`);
  return error.message;
};
async function as(email, password = people[email]?.password) {
  const client = createClient(env.url, env.publishable, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await client.realtime.setAuth();
  return { client, id: data.user.id, token: data.session.access_token };
}
const joinStatus = (client, topic) => new Promise(resolve => {
  const channel = client.channel(topic, { config: { private: true } });
  const timer = setTimeout(() => resolve("no answer"), 10000);
  channel.subscribe((state, error) => { if (state !== "CLOSED") { clearTimeout(timer); resolve(`${state}${error ? `: ${error.message}` : ""}`); void client.removeChannel(channel); } });
});
const ice = (token, session) => fetch(`${BASE}/say/support/ice${session ? `?session=${session}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
const consent = { screen: "display", system_audio: true, mic: false };

(async () => {
  const site = createClient(env.url, env.secret, { auth: { persistSession: false } });
  const ids = Object.fromEntries(Object.entries(people).map(([email, p]) => [email.split("@")[0], p.id]));
  // A clean start: no sessions; Ben leads the team "Support test" with Ana in it; Cara in no team.
  await site.from("support_sessions").delete().neq("member_id", "00000000-0000-0000-0000-000000000000");
  await site.from("top_managers").delete().in("user_id", [ids.ben, ids.cara]);
  await site.from("team_members").delete().in("user_id", [ids.ana, ids.ben, ids.cara]);
  await site.from("teams").delete().eq("name", "Support test");
  const { data: team, error: teamError } = await site.from("teams").insert({ name: "Support test", color: "#3366aa" }).select().single();
  if (teamError) throw teamError;
  await site.from("team_members").insert([{ user_id: ids.ana, team_id: team.id }, { user_id: ids.ben, team_id: team.id }]);
  await site.from("top_managers").insert({ user_id: ids.ben });
  // An account that signed up but was never approved.
  const pendingEmail = "pending-support@example.com", pendingPassword = "Pending-Support-1!";
  const { data: listed } = await site.auth.admin.listUsers({ perPage: 1000 });
  const old = listed.users.find(user => user.email === pendingEmail);
  if (old) await site.auth.admin.deleteUser(old.id);
  const { data: made } = await site.auth.admin.createUser({ email: pendingEmail, password: pendingPassword, email_confirm: true });
  await site.from("profiles").upsert({ id: made.user.id, email: pendingEmail, name: "Pending Person", reason: "Something else", status: "waiting" });

  const ana = await as("ana@example.com"), ben = await as("ben@example.com"), cara = await as("cara@example.com"), admin = await as("chrislim@kiasa.tech");
  const pending = await as(pendingEmail, pendingPassword);
  let session;

  await step("a member sees only their own managers (Ben, the admin) to ask", async () => {
    const { data, error } = await ana.client.rpc("support_managers");
    if (error) throw error;
    const names = data.map(row => row.name).sort();
    if (!data.some(row => row.id === ids.ben) || !data.some(row => row.id === ids.chrislim)) throw new Error(names.join(", "));
    const { data: caras } = await cara.client.rpc("support_managers");
    if (caras.some(row => row.id === ids.ben)) throw new Error("Cara may ask Ben, who does not lead her");
    return names.join(", ");
  });
  await step("a manager outside the member's team cannot invite them (Cara is no manager)", () => expectError(cara.client.rpc("support_invite", { member: ids.ana }), /not allowed/));
  await step("a member cannot ask a manager who does not lead them", () => expectError(cara.client.rpc("support_request", { manager: ids.ben, consent }), /not allowed/));
  await step("the team's manager invites; nothing is live yet", async () => {
    const { data, error } = await ben.client.rpc("support_invite", { member: ids.ana });
    if (error) throw error;
    session = data;
    if (data.status !== "invited") throw new Error(data.status);
  });
  await step("only the member can give consent: the manager, and another member, cannot accept", async () => {
    await expectError(ben.client.rpc("support_accept", { session: session.id, consent }), /not allowed/);
    await expectError(cara.client.rpc("support_accept", { session: session.id, consent }), /not allowed/);
  });
  await step("no one can join the live channel before consent", async () => {
    const status = await joinStatus(ben.client, `support:${session.id}`);
    if (status === "SUBSCRIBED") throw new Error(status);
    return status.slice(0, 60);
  });
  await step("no relay before consent", async () => {
    const answer = await ice(ben.token, session.id);
    if (answer.status !== 403) throw new Error(`status ${answer.status}`);
  });
  await step("consent with a malformed choice is refused", () => expectError(ana.client.rpc("support_accept", { session: session.id, consent: { screen: 5 } }), /bad consent/));
  await step("the member accepts: live, consent written", async () => {
    const { data, error } = await ana.client.rpc("support_accept", { session: session.id, consent });
    if (error) throw error;
    if (data.status !== "live") throw new Error(data.status);
  });
  await step("the assigned manager opens it and gets a seat; opening again gives a new seat", async () => {
    const first = await ben.client.rpc("support_join", { session: session.id });
    const second = await ben.client.rpc("support_join", { session: session.id });
    if (first.error || second.error) throw first.error || second.error;
    if (!first.data.seat || first.data.seat === second.data.seat) throw new Error("seat not renewed");
  });
  await step("someone else cannot open it, nor learn its seat", async () => {
    await expectError(cara.client.rpc("support_join", { session: session.id }), /not allowed/);
    await expectError(admin.client.rpc("support_join", { session: session.id }), /not allowed/);
    const { data } = await cara.client.from("support_sessions").select("id").eq("id", session.id);
    if (data?.length) throw new Error("Cara can read the session");
    return "an admin who is not the assigned manager is refused too";
  });
  await step("the member and the manager may join the live channel; another member may not", async () => {
    const [m, g, c] = await Promise.all([joinStatus(ana.client, `support:${session.id}`), joinStatus(ben.client, `support:${session.id}`), joinStatus(cara.client, `support:${session.id}`)]);
    if (m !== "SUBSCRIBED" || g !== "SUBSCRIBED") throw new Error(`member ${m}, manager ${g}`);
    if (c === "SUBSCRIBED") throw new Error("Cara joined");
    return `Cara: ${c.slice(0, 50)}`;
  });
  await step("the relay: member and manager yes; another member, an unapproved sign-up, and no token no", async () => {
    const [m, g, c, p, none] = await Promise.all([ice(ana.token, session.id), ice(ben.token, session.id), ice(cara.token, session.id), ice(pending.token, session.id), fetch(`${BASE}/say/support/ice?session=${session.id}`)]);
    const codes = [m.status, g.status, c.status, p.status, none.status];
    if (codes.join() !== "200,200,403,403,401") throw new Error(codes.join());
    const body = await m.json();
    return `ttl ${body.ttl}s, ${body.ice.length} servers`;
  });
  await step("KIASA-012: /say/ice refuses an unapproved sign-up (403) and serves an approved member", async () => {
    const [p, m] = await Promise.all([fetch(`${BASE}/say/ice`, { headers: { authorization: `Bearer ${pending.token}` } }), fetch(`${BASE}/say/ice`, { headers: { authorization: `Bearer ${ana.token}` } })]);
    if (p.status !== 403 || m.status !== 200) throw new Error(`${p.status}, ${m.status}`);
  });
  await step("the relay is counted: the 61st request in an hour gets 429", async () => {
    let last = 0, n = 0;
    for (; n < 70; n++) { last = (await ice(cara.token)).status; if (last === 429) break; }
    // Cara is refused (403) before counting; count with the manager instead.
    for (n = 0; n < 70; n++) { last = (await ice(ben.token, session.id)).status; if (last === 429) break; }
    if (last !== 429) throw new Error(`still ${last} after ${n} requests (KIASA_LIMITS=on?)`);
    return `429 after ${n + 2} requests this hour`;
  });
  await step("events can be noted only by those in the session, and only known kinds", async () => {
    await expectError(cara.client.rpc("support_note", { session: session.id, what: "paused", detail: {} }), /not allowed/);
    await expectError(ana.client.rpc("support_note", { session: session.id, what: "screenshot_taken", detail: {} }), /unknown event/);
    const { error } = await ana.client.rpc("support_note", { session: session.id, what: "paused", detail: { what: "screen" } });
    if (error) throw error;
  });
  await step("the history is append-only: no one, the admin included, can change or delete it", async () => {
    const before = (await site.from("support_events").select("id").eq("session_id", session.id)).data.length;
    await ana.client.from("support_events").delete().eq("session_id", session.id);
    await admin.client.from("support_events").delete().eq("session_id", session.id);
    await admin.client.from("support_events").update({ kind: "nothing" }).eq("session_id", session.id);
    const insert = await ana.client.from("support_events").insert({ session_id: session.id, kind: "consent", detail: {} });
    const after = (await site.from("support_events").select("id, kind").eq("session_id", session.id)).data;
    if (after.length !== before || after.some(row => row.kind === "nothing") || !insert.error) throw new Error(`${before} → ${after.length}, insert ${insert.error ? "refused" : "allowed"}`);
    return `${after.length} events: ${after.map(row => row.kind).join(", ")}`;
  });
  await step("the member reads their own session's history", async () => {
    const { data } = await ana.client.from("support_events").select("kind").eq("session_id", session.id);
    if (!data?.some(row => row.kind === "consent")) throw new Error("no consent event visible");
  });
  await step("a second open session for the same member is refused", () => expectError(ana.client.rpc("support_request", { manager: ids.chrislim, consent }), /already open/));
  await step("revocation: Ben stops being a manager, the next beat ends the session as revoked", async () => {
    await site.from("top_managers").delete().eq("user_id", ids.ben);
    const { data, error } = await ana.client.rpc("support_beat", { session: session.id });
    if (error) throw error;
    if (data.status !== "ended" || data.end_reason !== "revoked") throw new Error(`${data.status} ${data.end_reason}`);
    const status = await joinStatus(ben.client, `support:${session.id}`);
    if (status === "SUBSCRIBED") throw new Error("Ben can still join the channel");
    const relay = await ice(ana.token, session.id);
    if (relay.status !== 403) throw new Error(`relay still ${relay.status}`);
  });
  await step("ended is final: it cannot be accepted, joined or beaten back to life; ending again is harmless", async () => {
    await expectError(ana.client.rpc("support_accept", { session: session.id, consent }), /not open|not allowed/);
    await site.from("top_managers").insert({ user_id: ids.ben });
    await expectError(ben.client.rpc("support_join", { session: session.id }), /not live/);
    const again = await ana.client.rpc("support_end", { session: session.id, reason: "member_stopped" });
    if (again.error || again.data.status !== "ended" || again.data.end_reason !== "revoked") throw new Error("end changed the record");
  });
  await step("a session whose app stopped beating ends by itself after 2 minutes (lapsed)", async () => {
    const { data, error } = await ana.client.rpc("support_request", { manager: ids.chrislim, consent });
    if (error) throw error;
    await site.from("support_sessions").update({ member_seen_at: new Date(Date.now() - 3 * 60_000).toISOString() }).eq("id", data.id);
    const { data: mine } = await ana.client.rpc("support_mine");
    const { data: row } = await site.from("support_sessions").select("status, end_reason").eq("id", data.id).single();
    if (mine.length || row.status !== "ended" || row.end_reason !== "lapsed") throw new Error(`${row.status} ${row.end_reason}`);
  });
  await step("an unanswered invitation expires", async () => {
    const { data } = await admin.client.rpc("support_invite", { member: ids.ana });
    await site.from("support_sessions").update({ invite_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", data.id);
    await expectError(ana.client.rpc("support_accept", { session: data.id, consent }), /not open/);
  });

  console.log(results.join("\n"));
  const failed = results.filter(line => line.startsWith("FAIL")).length;
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  await site.auth.admin.deleteUser(made.user.id);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
