"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/accounts/browser";
import { clockIn, dayIn, dayName, partsIn, shortDay } from "../jobs/jobs-format";

type Mode = "off" | "fill" | "apply";
type Server = { on: boolean; seen_at: string | null; waiting: number };
type Outcome = "working" | "filled" | "applied" | "failed" | "skipped" | "waiting";
type JobRow = {
  id: string; url: string; title: string | null; company: string | null; location: string | null; posted_at: string;
  applications: { status: string }[];
  apply_results: { outcome: Outcome; reason: string | null }[];
  tailored_resumes: { updated_at: string }[];
};
type Filter = "ready" | "all";

const PAGE = 100;
/** The most ready jobs read at once: far above what a member keeps ready. */
const MOST_READY = 1000;
const RELOAD_AFTER_MS = 400;
const COLUMNS = "id, url, title, company, location, posted_at, applications(status), apply_results(outcome, reason)";
const OUTCOMES: Record<Outcome, string> = {
  working: "Working on it", filled: "Filled, not sent", applied: "Applied", failed: "Did not finish", skipped: "Skipped", waiting: "Needs your answer",
};

/** Only an address that is really a web page is linked: job links come from elsewhere. */
const safeLink = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;

/** The agent works on Greenhouse for now, as the database's own rule says. */
const onGreenhouse = (url: string) => /^https?:\/\/([^/]+\.)?greenhouse\.io(\/|$)|[?&]gh_jid=/i.test(url);

/** Ready means it has a résumé made for it, and nothing more is to come of it by itself. */
const isReady = (job: JobRow) => job.tailored_resumes.length > 0 && !job.applications.length && job.apply_results[0]?.outcome !== "skipped";

function statusOf(job: JobRow): { key: string; text: string } {
  const application = job.applications[0];
  if (application) return application.status === "skipped" ? { key: "skipped", text: "Skipped on the Job desk" } : { key: "applied", text: "Applied" };
  const result = job.apply_results[0];
  if (result) return { key: result.outcome, text: `${OUTCOMES[result.outcome]}${result.reason ? `: ${result.reason}` : ""}` };
  if (!job.tailored_resumes.length) return { key: "none", text: "No résumé yet" };
  if (!onGreenhouse(job.url)) return { key: "ready", text: "Résumé ready. The agent works on Greenhouse for now." };
  return { key: "ready", text: "Ready to apply" };
}

/** What the agent is set to do, whether the model server is on, and every job the admins have
 * saved, by the day they were saved, with what has become of each. Jobs turn ready here the
 * moment their résumé is made. Only short notes: no page and no answer is ever kept. */
export function ApplyWork({ realtime, me, admin }: { realtime: { url: string; key: string }; me: string; admin: boolean }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [server, setServer] = useState<Server | null>(null);
  const [zone, setZone] = useState("UTC");
  const [today, setToday] = useState("");
  const [ready, setReady] = useState<JobRow[] | null>(null);
  const [all, setAll] = useState<JobRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>("ready");
  const [limit, setLimit] = useState(PAGE);
  const [problem, setProblem] = useState<string | null>(null);
  const limitNow = useRef(PAGE);

  useEffect(() => { limitNow.current = limit; }, [limit]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadMode = async () => {
      const { data } = await supabase.from("apply_control").select("mode").eq("user_id", me).maybeSingle();
      if (!stopped) setMode((data?.mode as Mode | undefined) ?? "off");
    };
    const loadServer = async () => {
      const { data } = await supabase.rpc("model_server_status");
      if (!stopped && data) setServer(data as Server);
    };
    const loadJobs = async () => {
      const [readyJobs, allJobs] = await Promise.all([
        supabase.from("jobs").select(`${COLUMNS}, tailored_resumes!inner(updated_at)`)
          .eq("applications.user_id", me).eq("apply_results.user_id", me).eq("tailored_resumes.user_id", me)
          .order("posted_at", { ascending: false }).limit(MOST_READY),
        supabase.from("jobs").select(`${COLUMNS}, tailored_resumes(updated_at)`, { count: "exact" })
          .eq("applications.user_id", me).eq("apply_results.user_id", me).eq("tailored_resumes.user_id", me)
          .order("posted_at", { ascending: false }).range(0, limitNow.current - 1),
      ]);
      if (stopped) return;
      setReady((readyJobs.data ?? []) as unknown as JobRow[]);
      setAll((allJobs.data ?? []) as unknown as JobRow[]);
      setTotal(allJobs.count ?? 0);
    };
    // A burst of changes, as when many résumés are made at once, reads the list once.
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void loadJobs(), RELOAD_AFTER_MS);
    };
    const channel = supabase.channel(`apply-work:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "tailored_resumes", filter: `user_id=eq.${me}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: `user_id=eq.${me}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "apply_results", filter: `user_id=eq.${me}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "apply_control", filter: `user_id=eq.${me}` }, () => void loadMode())
      // On joining, and on joining again after a drop: what happened meanwhile.
      .subscribe(status => { if (status === "SUBSCRIBED") { void loadMode(); void loadJobs(); } });
    void supabase.from("job_settings").select("timezone").eq("id", 1).maybeSingle().then(({ data }) => {
      if (stopped) return;
      const found = (data?.timezone as string | null) ?? "UTC";
      setZone(found);
      setToday(dayIn(found));
    });
    void loadServer();
    const tick = setInterval(() => void loadServer(), 20_000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(tick); void supabase.removeChannel(channel); };
  }, [supabase, me]);

  /** More of the older jobs: the whole list can run to thousands. */
  const showMore = async () => {
    const next = limit + PAGE;
    setLimit(next);
    limitNow.current = next;
    if (filter !== "all") return;
    const { data, count } = await supabase.from("jobs").select(`${COLUMNS}, tailored_resumes(updated_at)`, { count: "exact" })
      .eq("applications.user_id", me).eq("apply_results.user_id", me).eq("tailored_resumes.user_id", me)
      .order("posted_at", { ascending: false }).range(0, next - 1);
    if (data) {
      setAll(data as unknown as JobRow[]);
      setTotal(count ?? 0);
    }
  };

  const choose = async (next: Mode) => {
    setProblem(null);
    const before = mode;
    setMode(next);
    const { error } = await supabase.from("apply_control").upsert({ user_id: me, mode: next }, { onConflict: "user_id" });
    if (error) {
      setMode(before);
      setProblem("That did not work. Please try again.");
    }
  };

  const readyJobs = useMemo(() => ready?.filter(isReady) ?? null, [ready]);
  const list = filter === "ready" ? readyJobs : all;
  const shown = filter === "ready" ? readyJobs?.slice(0, limit) ?? null : all;
  const more = filter === "ready" ? (readyJobs?.length ?? 0) > limit : (all?.length ?? 0) < total;

  /** Jobs by the day they were saved, newest first, as the query gives them. */
  const days = useMemo(() => {
    const groups: { day: string; jobs: JobRow[] }[] = [];
    for (const job of shown ?? []) {
      const { day } = partsIn(zone, job.posted_at);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.jobs.push(job);
      else groups.push({ day, jobs: [job] });
    }
    return groups;
  }, [shown, zone]);

  const dayTitle = (day: string) => {
    const name = dayName(day, today);
    return name === "Today" || name === "Yesterday" ? `${name}, ${shortDay(day)}` : name;
  };

  const serverText = !server ? "Model server: checking…"
    : server.on ? `Model server: on${admin && server.waiting ? `, ${server.waiting} waiting` : ""}`
    : "Model server is off. The agent waits until it is back.";

  return <section className="jobs-card apply-work" aria-labelledby="apply-work-title">
    <header className="jobs-card-head">
      <div>
        <h2 id="apply-work-title" className="jobs-card-title">The agent</h2>
        <p className="jobs-card-sub" role="status">{mode === null ? "Loading…" : mode === "off" ? "Stopped" : mode === "fill" ? "Filling forms. Nothing is sent." : "Applying"}</p>
      </div>
    </header>

    <div className="apply-switch" role="group" aria-label="What the agent does">
      <button type="button" className="jobs-filter" aria-pressed={mode === "off"} disabled={mode === null} onClick={() => void choose("off")}>Stop</button>
      <button type="button" className="jobs-filter" aria-pressed={mode === "fill"} disabled={mode === null} onClick={() => void choose("fill")}>Fill forms, don&apos;t send</button>
    </div>
    <p className="jobs-form-hint">The agent works while your browser is on. It opens each job&apos;s form in its own tab and fills it in, so you can check it. It does not press submit.</p>
    {problem && <p className="jobs-form-hint" role="alert">{problem}</p>}

    <p className="apply-server" data-on={server?.on || undefined}><span className="apply-dot" aria-hidden="true" />{serverText}</p>

    <h3 className="apply-section-title">Jobs</h3>
    <div className="jobs-filters apply-job-filters" role="group" aria-label="Show">
      <button type="button" className="jobs-filter" aria-pressed={filter === "ready"} onClick={() => { setFilter("ready"); setLimit(PAGE); limitNow.current = PAGE; }}>Ready <span>{readyJobs?.length ?? "…"}</span></button>
      <button type="button" className="jobs-filter" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setLimit(PAGE); limitNow.current = PAGE; }}>All jobs <span>{all ? total : "…"}</span></button>
    </div>
    <p className="jobs-form-hint">{filter === "ready" ? "Jobs with a résumé made for you, which the agent works from. New ones appear here as soon as their résumé is made." : "Every job the admins have saved, by the day it was saved."}</p>

    {list === null ? <p className="jobs-form-hint">Loading…</p>
      : list.length === 0 ? <p className="jobs-form-hint">{filter === "ready" ? "No jobs are ready yet. Make a résumé for a job on the Job desk, and it appears here." : "No jobs have been saved yet."}</p>
      : days.map(group => <div key={group.day} className="apply-day">
          <h4 className="apply-day-title">{dayTitle(group.day)} <span>{group.jobs.length}</span></h4>
          <ul className="apply-list">{group.jobs.map(job => {
            const name = [job.company, job.title].filter(Boolean).join(", ") || "A job";
            const link = safeLink(job.url);
            const status = statusOf(job);
            return <li key={job.id} className="apply-row" data-outcome={status.key}>
              <span className="apply-dot" aria-hidden="true" />
              <div className="apply-main">
                <p className="apply-name">{link ? <a className="apply-result-link" href={link} target="_blank" rel="noreferrer">{name}</a> : name}</p>
                <p className="apply-detail">{status.text}</p>
                <p className="apply-meta">{[`Saved ${clockIn(zone, job.posted_at)}`, job.location].filter(Boolean).join(" · ")}</p>
              </div>
            </li>;
          })}</ul>
        </div>)}
    {more && <button type="button" className="chat-pill apply-more" onClick={() => void showMore()}>Show more</button>}
  </section>;
}
