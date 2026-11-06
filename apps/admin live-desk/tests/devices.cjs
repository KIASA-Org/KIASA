// The rule that an admin's account works only on its approved devices, with the app as a device.
// Local copy only: it turns the device lock on for a few seconds, and puts it back. The test build's
// window comes up, and takes the keyboard while it asks for a sign-in.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Desk, sleep, until, check, ADMIN, ANA, sql, summary } = require("./e2e.cjs");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "desk-data-"));
  const wasOn = sql("select admin_devices from public.security_settings where id = 1");
  const q = text => `'${String(text).replace(/'/g, "''")}'`;
  // A device already approved, so that a new one has to ask.
  sql(`insert into public.admin_devices (user_id, token_hash, name, approved_at)
       values (${q(ADMIN.id)}, encode(sha256(convert_to('desk-test-' || gen_random_uuid()::text, 'UTF8')), 'hex'), 'desk-test approved', now())`);
  sql("update public.security_settings set admin_devices = true where id = 1");
  const liveBefore = sql(`select count(*) from public.live_sessions where user_id = ${q(ANA.id)}`);
  if (liveBefore === "0") sql(`insert into public.live_sessions (user_id) values (${q(ANA.id)})`);
  let desk = new Desk(data);
  try {
    await desk.start();
    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    const asked = await until("asked", async () => { const s = await desk.state(); return /asked to be added/.test(s.said) ? s : null; }, 20000);
    check("a new computer has to ask", !!asked.value && !asked.value.signedIn, await desk.state());
    const row = () => sql("select name || '|' || (approved_at is null) from public.admin_devices where name like 'KIASA Live Desk%'");
    check("it is listed for approval, by the app's name", row() === "KIASA Live Desk on Windows|true", row());

    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    await sleep(2500);
    check("asking twice is one request", row().split("\n").length === 1, row());
    check("still not in, unapproved", (await desk.state()).signedIn === false);

    sql("update public.admin_devices set approved_at = now() where name like 'KIASA Live Desk%'");
    await desk.ask(`signin ${ADMIN.email} ${ADMIN.password}`);
    const inNow = await until("in", async () => (await desk.state()).signedIn, 20000);
    check("once approved, it signs in", !!inNow.value, (await desk.state()).said);
    const sees = await until("list", async () => (await desk.state()).people.some(person => person.Id === ANA.id), 8000);
    check("and has an admin's powers with the lock on", !!sees.value, await desk.state());

    await desk.stop();
    desk = new Desk(data);
    await desk.start();
    const back = await until("back", async () => { const s = await desk.state(); return s.signedIn && s.people.some(person => person.Id === ANA.id); }, 20000);
    check("opened again, it is still signed in with no password", !!back.value, await desk.state());

    sql(`select public.admin_device_forget(id) from public.admin_devices where name like 'KIASA Live Desk%'`);
    await desk.stop();
    desk = new Desk(data);
    await desk.start();
    await sleep(3000);
    check("removed from Your devices, it is signed out", (await desk.state()).signedIn === false, await desk.state());
  } finally {
    await desk.stop().catch(() => {});
    if (liveBefore === "0") sql(`delete from public.live_sessions where user_id = ${q(ANA.id)}`);
    sql(`update public.security_settings set admin_devices = ${wasOn === "t" ? "true" : "false"} where id = 1`);
    sql("delete from public.admin_devices where name like 'KIASA Live Desk%' or name = 'desk-test approved'");
    fs.rmSync(data, { recursive: true, force: true });
  }
  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(2); });
