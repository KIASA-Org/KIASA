"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/accounts/browser";
import { teamLedBy } from "@/lib/teams/rules";
import { useRanks } from "../site/ranks";
import type { BoardRow, Job, JobSettings, JobsMe, JobsStart, JobStatus, Plan, Resume } from "@/lib/jobs/types";
import { Leaderboard } from "./jobs-board";
import { CalendarView } from "./jobs-calendar";
import { dayIn, instantIn } from "./jobs-format";
import { LiveView } from "./jobs-live";
import { ConfirmView, Earnings } from "./jobs-money";
import { PlansView } from "./jobs-plans";
import { PostJobs } from "./jobs-post";
import { Resumes } from "./jobs-resumes";
import type { JobActions } from "./jobs-row";
import { MyJobs, TodayView } from "./jobs-today";

type Tab = "team" | "today" | "mine" | "calendar" | "board" | "money" | "resumes" | "live" | "post" | "plans" | "confirm";
const MEMBER: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" }, { id: "mine", label: "My jobs" }, { id: "calendar", label: "Calendar" },
  { id: "board", label: "Leaderboard" }, { id: "money", label: "Earnings" }, { id: "resumes", label: "Résumés" },
];
const ADMIN: { id: Tab; label: string }[] = [
  { id: "live", label: "Live" }, { id: "post", label: "Jobs" }, { id: "calendar", label: "Calendars" },
  { id: "plans", label: "Plans" }, { id: "confirm", label: "Confirm" }, { id: "board", label: "Leaderboard" },
];
const TRY_AGAIN = "That did not save. Please try again.";

// The time, for "5 min ago" and today's date: none on the server, every 30 seconds in the browser.
const everyHalfMinute = (tick: () => void) => { const timer = window.setInterval(tick, 30_000); return () => window.clearInterval(timer); };
const useNow = () => useSyncExternalStore(everyHalfMinute, () => Math.floor(Date.now() / 30_000) * 30_000, () => 0);

type Versions = { applications: number; live: number; interviews: number; money: number };
type Refresh = "jobs" | "board" | "plans" | "resumes" | "pending" | "live";

/** KIASA Jobs. Members work through the day's job links (each with their own
 * status, and the résumé used), keep their interviews on a calendar, report
 * the jobs they win and the pay they receive, and see the team's leaderboard.
 * Admins post the links, watch the team's day as it happens, plan each
 * member's day, week and month, and confirm what members report.
 *
 * Everything is live: changes to what this person may read arrive from the
 * database, and a word on the team's private channel says when the
 * leaderboard's totals have moved. Each kind of refresh waits a moment, so a
 * burst of changes is asked for once. */
export function JobsApp({ me, start, realtime, tab: asked }: { me: JobsMe; start: JobsStart; realtime: { url: string; key: string }; tab: string | null }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  // A team's manager sees their team's day first, as the admin sees everyone's.
  const ranks = useRanks();
  const lead = me.admin ? null : teamLedBy(me.id, ranks);
  // (A manager keeps no résumés: they do not apply for jobs.)
  const tabs = me.admin ? ADMIN : lead ? [{ id: "team" as Tab, label: "My team" }, ...MEMBER.filter(entry => entry.id !== "resumes")] : MEMBER;
  const [tab, setTab] = useState<Tab>(() => tabs.find(entry => entry.id === asked)?.id ?? tabs[0].id);
  const [settings, setSettings] = useState<JobSettings>(start.settings);
  const zone = settings.timezone ?? "UTC";
  const now = useNow();
  const today = now ? dayIn(zone, new Date(now)) : start.today;
  // The day of the list: today, unless an earlier one is chosen.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && picked < today ? picked : today;
  const [list, setList] = useState<{ day: string; jobs: Job[] }>({ day: start.today, jobs: start.jobs });
  const [board, setBoard] = useState<BoardRow[]>(start.board);
  const [resumes, setResumes] = useState<Resume[]>(start.resumes);
  const [plans, setPlans] = useState<Plan[]>(start.plans);
  const [pending, setPending] = useState(start.pending);
  const [versions, setVersions] = useState<Versions>({ applications: 0, live: 0, interviews: 0, money: 0 });
  const [notice, setNotice] = useState("");
  const bump = useCallback((key: keyof Versions) => setVersions(current => ({ ...current, [key]: current[key] + 1 })), []);

  const loadBoard = useCallback(async () => {
    const { data, error } = await supabase.rpc("team_board");
    if (!error) setBoard((data ?? []) as BoardRow[]);
  }, [supabase]);
  const loadPlans = useCallback(async () => {
    const { data, error } = await supabase.from("plans").select("*").limit(5000);
    if (!error) setPlans((data ?? []) as Plan[]);
  }, [supabase]);
  const loadResumes = useCallback(async () => {
    if (!me.member) return;
    const { data, error } = await supabase.from("resumes").select("*").eq("user_id", me.id).order("created_at");
    if (!error) setResumes((data ?? []) as Resume[]);
  }, [supabase, me.id, me.member]);
  const loadPending = useCallback(async () => {
    if (!me.admin) return;
    const [jobs, pay] = await Promise.all([
      supabase.from("positions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    setPending((jobs.count ?? 0) + (pay.count ?? 0));
  }, [supabase, me.admin]);

  // The day shown, asked for when it changes (the first came with the page).
  useEffect(() => {
    if (list.day === day) return;
    let stopped = false;
    void supabase.rpc("jobs_on", { on_day: day }).then(({ data, error }) => { if (!stopped && !error) setList({ day, jobs: (data ?? []) as Job[] }); });
    return () => { stopped = true; };
  }, [supabase, day, list.day]);

  const refresh = useEffectEvent((what: Refresh) => {
    if (what === "jobs") void supabase.rpc("jobs_on", { on_day: day }).then(({ data, error }) => { if (!error) setList({ day, jobs: (data ?? []) as Job[] }); });
    else if (what === "board") void loadBoard();
    else if (what === "plans") void loadPlans();
    else if (what === "resumes") void loadResumes();
    else if (what === "pending") void loadPending();
    else bump("live");
  });

  useEffect(() => {
    let stopped = false;
    const timers = new Map<Refresh, number>();
    const soon = (what: Refresh, wait: number) => {
      if (timers.has(what)) return;
      timers.set(what, window.setTimeout(() => { timers.delete(what); if (!stopped) refresh(what); }, wait));
    };
    const leading = !!lead;
    // A member hears their own rows; an admin, everyone's.
    const mine = me.admin ? {} : { filter: `user_id=eq.${me.id}` };
    const changes = supabase.channel(`jobs-db:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => soon("jobs", 400))
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", ...mine }, () => {
        soon("jobs", 400);
        bump("applications");
        if (me.admin) { soon("board", 600); soon("live", 700); }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "interviews", ...mine }, () => { bump("interviews"); if (me.admin) soon("board", 800); })
      .on("postgres_changes", { event: "*", schema: "public", table: "plans", ...mine }, () => soon("plans", 400))
      .on("postgres_changes", { event: "*", schema: "public", table: "positions", ...mine }, () => { bump("money"); soon("pending", 400); soon("board", 800); })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", ...mine }, () => { bump("money"); soon("pending", 400); soon("board", 800); })
      .on("postgres_changes", { event: "*", schema: "public", table: "resumes", ...mine }, () => soon("resumes", 400))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "job_settings" }, payload => {
        const row = payload.new as Partial<JobSettings>;
        setSettings(current => ({ timezone: row.timezone ?? current.timezone, currency: row.currency ?? current.currency }));
        soon("board", 200);
      })
      .subscribe();
    let team: RealtimeChannel | null = null;
    void supabase.realtime.setAuth().then(() => {
      if (stopped) return;
      team = supabase.channel("jobs:team", { config: { private: true } })
        .on("broadcast", { event: "activity" }, () => { soon("board", 1000); soon("jobs", 700); if (leading) soon("live", 1100); })
        .subscribe();
    });
    return () => {
      stopped = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      void supabase.removeChannel(changes);
      if (team) void supabase.removeChannel(team);
    };
  }, [supabase, me.id, me.admin, bump, lead]);

  // The team's days follow one time zone: on an admin's first visit, theirs.
  useEffect(() => {
    if (!me.admin || settings.timezone) return;
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browser) return;
    void supabase.from("job_settings").update({ timezone: browser }).eq("id", 1).select("timezone, currency").single().then(({ data }) => {
      if (!data) return;
      setSettings(data as JobSettings);
      void loadBoard();
    });
  }, [supabase, me.admin, settings.timezone, loadBoard]);

  // A short word at the foot of the page, after something did not work.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchJob = useCallback((id: string, change: Partial<Job>) =>
    setList(current => ({ ...current, jobs: current.jobs.map(job => job.id === id ? { ...job, ...change } : job) })), []);

  /** What a member does with a job: shown at once, then saved; put back, with a word, if saving fails. */
  const act: JobActions = useMemo(() => {
    const write = (job: string, row: { status?: JobStatus; resume_id?: string | null }) =>
      supabase.from("applications").upsert({ job_id: job, user_id: me.id, ...row }, { onConflict: "job_id,user_id" });
    const counted = (status: JobStatus | null) => !!status && status !== "skipped";
    return {
      apply: async (job, resume) => {
        patchJob(job.id, { status: "applied", applied_at: job.applied_at ?? new Date().toISOString(), resume_id: resume, applied: job.applied + (counted(job.status) ? 0 : 1) });
        const { error } = await write(job.id, { status: "applied", resume_id: resume });
        if (error) { patchJob(job.id, job); setNotice(TRY_AGAIN); }
      },
      status: async (job, status) => {
        patchJob(job.id, {
          status, applied_at: counted(status) ? job.applied_at ?? new Date().toISOString() : null,
          applied: job.applied + (counted(status) === counted(job.status) ? 0 : counted(status) ? 1 : -1),
        });
        const { error } = await write(job.id, { status });
        if (error) { patchJob(job.id, job); setNotice(TRY_AGAIN); }
      },
      undo: async job => {
        patchJob(job.id, { status: null, applied_at: null, resume_id: null, my_note: null, applied: job.applied - (counted(job.status) ? 1 : 0) });
        const { error } = await supabase.from("applications").delete().eq("job_id", job.id).eq("user_id", me.id);
        if (error) { patchJob(job.id, job); setNotice("That did not work. Please try again."); }
      },
      note: async (job, note) => {
        const { error } = await supabase.from("applications").update({ note: note || null }).eq("job_id", job.id).eq("user_id", me.id);
        if (error) return TRY_AGAIN;
        patchJob(job.id, { my_note: note || null });
        return null;
      },
      resume: async (job, resume) => {
        const { error } = await supabase.from("applications").update({ resume_id: resume }).eq("job_id", job.id).eq("user_id", me.id);
        if (error) return TRY_AGAIN;
        patchJob(job.id, { resume_id: resume });
        return null;
      },
      interview: async (job, form) => {
        const id = form.job ?? job?.id ?? null;
        if (id) {
          // An interview goes with an application at "Interview" (never moved back from an offer).
          const known = job?.id === id && job.status !== undefined ? job.status
            : ((await supabase.from("applications").select("status").eq("job_id", id).eq("user_id", me.id).maybeSingle()).data?.status as JobStatus | undefined) ?? null;
          if (!known || known === "applied" || known === "skipped" || known === "rejected") {
            const { error } = await write(id, { status: "interview" });
            if (error) return "The interview could not be saved. Please try again.";
            patchJob(id, { status: "interview" });
          }
        }
        const { error } = await supabase.from("interviews").insert({
          user_id: me.id, job_id: id, company: id ? null : form.company || null, title: id ? null : form.title || null,
          starts_at: instantIn(zone, form.day, form.time), minutes: form.minutes, kind: form.kind,
          stage: form.stage || null, place: form.place || null, note: form.note || null,
        });
        if (error) return "The interview could not be saved. Please try again.";
        bump("interviews");
        return null;
      },
      hired: async (job, form) => {
        const { error: failed } = await write(job.id, { status: "hired" });
        if (failed) return TRY_AGAIN;
        patchJob(job.id, { status: "hired" });
        const { error } = await supabase.from("positions").insert({
          user_id: me.id, job_id: job.id, company: form.company, title: form.title, monthly_salary: form.salary, started_on: form.started,
        });
        if (error) return "The job could not be saved. Please try again.";
        bump("money");
        setNotice("Well done. It counts on the leaderboard once an admin confirms it.");
        return null;
      },
    };
  }, [supabase, me.id, zone, patchJob, bump]);

  const choose = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === tabs[0].id ? "/jobs" : `/jobs?tab=${next}`);
  };
  const mine = board.find(row => row.user_id === me.id) ?? null;
  const loading = list.day !== day;
  const team = start.team;
  const mates = lead ? team.filter(person => person.id !== me.id && ranks.placed?.[person.id] === lead).map(person => person.id) : [];
  const views: Record<Tab, () => ReactNode> = {
    team: () => <LiveView supabase={supabase} team={team} board={board} plans={plans} zone={zone} today={today} now={now} version={versions.live}
      only={mates} teamName={ranks.teams?.find(entry => entry.id === lead)?.name} />,
    today: () => <TodayView me={me} zone={zone} today={today} day={day} jobs={list.jobs} loading={loading} resumes={resumes} plans={plans} mine={mine}
      currency={settings.currency} act={act} onDay={setPicked} onResumes={lead ? undefined : () => choose("resumes")} />,
    mine: () => <MyJobs me={me} supabase={supabase} zone={zone} today={today} resumes={resumes} currency={settings.currency} act={act} version={versions.applications} />,
    calendar: () => <CalendarView me={me} supabase={supabase} zone={zone} today={today} team={team} version={versions.interviews} onInterview={act.interview} />,
    board: () => <Leaderboard me={me} board={board} team={team} currency={settings.currency} zone={zone} today={today} now={now} />,
    money: () => <Earnings me={me} supabase={supabase} currency={settings.currency} today={today} mine={mine} version={versions.money} />,
    resumes: () => <Resumes me={me} supabase={supabase} resumes={resumes} zone={zone} version={versions.applications} onChanged={() => void loadResumes()} />,
    live: () => <LiveView supabase={supabase} team={team} board={board} plans={plans} zone={zone} today={today} now={now} version={versions.live}
      pending={pending} onConfirm={() => choose("confirm")} />,
    post: () => <PostJobs supabase={supabase} zone={zone} today={today} day={day} jobs={list.jobs} loading={loading} team={team} onDay={setPicked} version={versions.live} />,
    plans: () => <PlansView supabase={supabase} team={team} plans={plans} board={board} today={today} settings={settings}
      onSettings={next => { setSettings(next); void loadBoard(); }} onSaved={() => void loadPlans()} />,
    confirm: () => <ConfirmView supabase={supabase} team={team} currency={settings.currency} today={today} version={versions.money}
      onDecided={() => { void loadPending(); void loadBoard(); }} />,
  };

  return <div className="jobs-app">
    <nav className="jobs-tabs" aria-label="KIASA Jobs">
      <div className="jobs-tabs-inner">
        {tabs.map(entry => <button key={entry.id} type="button" className="jobs-tab" aria-current={tab === entry.id ? "page" : undefined} onClick={() => choose(entry.id)}>
          {entry.label}
          {entry.id === "confirm" && pending > 0 && <span className="jobs-tab-count" aria-label={`, ${pending} waiting`}>{pending}</span>}
        </button>)}
      </div>
    </nav>
    <div className="jobs-body">{views[tab]()}</div>
    {notice && <p className="jobs-notice" role="status">{notice}</p>}
  </div>;
}
