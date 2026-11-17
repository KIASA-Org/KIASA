"use client";

import { useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";

type Usage = {
  at: string; database: number; files: number; file_count: number; freeable: number;
  tables: { name: string; bytes: number; rows: number }[];
  buckets: { name: string; bytes: number; files: number }[];
};

/** Supabase's Free plan: what the database and its files may hold. On a paid
 * plan, change these (Supabase → Organization → Usage shows the plan's). */
const DATABASE_LIMIT = 500 * 1024 * 1024;
const FILES_LIMIT = 1024 * 1024 * 1024;
/** Asked again this often while the page is open (and the moment it is seen again). */
const POLL_MS = 15_000;

const MB = 1024 * 1024;
function size(bytes: number) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}
const BUCKETS: Record<string, string> = { avatars: "Profile photos", "chat-files": "Chat files", resumes: "Résumés" };

/** How full one store is: a bar, used of the limit, and what is left. Past 80%
 * it says so; past 95%, louder (at 500 MB the database stops taking writes). */
function Meter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const share = Math.min(1, used / limit);
  const state = share >= 0.95 ? "bad" : share >= 0.8 ? "warn" : "good";
  return <div className="storage-meter" data-state={state}>
    <div className="storage-meter-head">
      <p className="model-name">{label}</p>
      <p className="storage-meter-pct">{(share * 100).toFixed(1)}% used</p>
    </div>
    <div className="storage-bar" role="meter" aria-label={`${label}: ${size(used)} of ${size(limit)}`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <span style={{ width: `${Math.max(share * 100, used > 0 ? 0.6 : 0)}%` }} />
    </div>
    <dl className="model-facts storage-facts">
      <div><dt>Used</dt><dd>{size(used)}</dd></div>
      <div><dt>Limit</dt><dd>{size(limit)}</dd></div>
      <div><dt>Available</dt><dd>{size(Math.max(0, limit - used))}</dd></div>
    </dl>
    {note && <p className="model-note">{note}</p>}
  </div>;
}

/** The admins' Storage page: how much the database and its files hold, against
 * the plan's limits, live (asked every 15 seconds while open). For admins only:
 * the database refuses it to anyone else. Only sizes and counts are read. */
export function StorageDesk({ realtime }: { realtime: { url: string; key: string } }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const { data, error } = await supabase.rpc("admin_storage_usage");
      if (stopped) return;
      setFailed(!!error);
      if (!error && data) setUsage(data as Usage);
    };
    void load();
    const tick = setInterval(() => void load(), POLL_MS);
    const back = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", back);
    return () => { stopped = true; clearInterval(tick); document.removeEventListener("visibilitychange", back); };
  }, [supabase]);

  const at = usage ? new Date(usage.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  return <div className="wrap wrap-wide model-desk">
    <h1 className="model-title">Storage</h1>
    {failed && <p className="admin-notice" data-failed="" role="alert">This could not be read. It may be that the database script for it (20261117140000_admin_storage.sql) has not been run yet.</p>}
    {!usage ? <p className="model-note" role="status">{failed ? "Not available." : "Loading…"}</p> : <>
      <p className="model-note" role="status"><span className="storage-live" aria-hidden="true" />Live: updated {at}, again every 15 seconds. Supabase Free plan.</p>

      <section className="model-card storage-card" aria-label="Space used">
        <Meter label="Database" used={usage.database} limit={DATABASE_LIMIT}
          note={`Every table, index and record. At ${size(DATABASE_LIMIT)} the database stops taking new data.${usage.freeable > 0 ? ` ${size(usage.freeable)} of it is left by deleted or changed rows, and is taken back by itself as the database cleans up.` : ""}`} />
        <Meter label="Files" used={usage.files} limit={FILES_LIMIT}
          note={`${usage.file_count.toLocaleString("en-US")} ${usage.file_count === 1 ? "file" : "files"}: photos, chat files and résumés.`} />
      </section>

      <section className="model-card" aria-labelledby="storage-tables-title">
        <h2 id="storage-tables-title" className="model-card-title">Biggest tables</h2>
        <table className="storage-table">
          <thead><tr><th scope="col">Table</th><th scope="col">Size</th><th scope="col">Rows (about)</th></tr></thead>
          <tbody>{usage.tables.map(table => <tr key={table.name}>
            <td>{table.name.replace(/^public\./, "")}</td><td>{size(table.bytes)}</td><td>{table.rows.toLocaleString("en-US")}</td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="model-card" aria-labelledby="storage-files-title">
        <h2 id="storage-files-title" className="model-card-title">Files by kind</h2>
        {usage.buckets.length === 0 ? <p className="model-note">No files yet.</p> : <table className="storage-table">
          <thead><tr><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Files</th></tr></thead>
          <tbody>{usage.buckets.map(bucket => <tr key={bucket.name}>
            <td>{BUCKETS[bucket.name] ?? bucket.name}</td><td>{size(bucket.bytes)}</td><td>{bucket.files.toLocaleString("en-US")}</td>
          </tr>)}</tbody>
        </table>}
      </section>
      <p className="model-note">The website&apos;s hosting (Vercel) counts its own usage apart from this: see vercel.com → Usage.</p>
    </>}
  </div>;
}
