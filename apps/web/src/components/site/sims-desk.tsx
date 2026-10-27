"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { Team } from "@/lib/accounts/viewer";
import { initialsOf } from "@/lib/accounts/viewer";
import { addSims, decideSims, deleteSims, placeSims, planSims, renameSim, setSimPhoto, setSims, setTester, setTesters, workNow } from "@/lib/sims/actions";
import { atWork, DAY_NAMES, daysInWords } from "@/lib/sims/hours";
import type { SimMember, TesterChoice } from "@/lib/sims/server";
import { Avatar } from "./avatar";
import { Close } from "./icons";
import { PhotoFrame } from "./your-photo";

/** The minute it is now, in the browser (0 while drawn on the server). */
const minuteNow = {
  subscribe: (changed: () => void) => { const timer = window.setInterval(changed, 30_000); return () => window.clearInterval(timer); },
  read: () => Math.floor(Date.now() / 60_000),
};
const STATUS = { waiting: "Waiting", approved: "Approved", declined: "Declined" } as const;
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The admin's simulated members: accounts made to fill KIASA while it is built
 * and tested. New ones ask for an account as anyone does; here the admin
 * approves them, puts them in teams, renames them and changes their photos,
 * and sets the hours they work and their pace, one by one or many at once.
 * Only admins, and the testers named at the foot, see them anywhere. */
export function SimsDesk({ sims, people, teams, zone, links }: { sims: SimMember[]; people: TesterChoice[]; teams: Team[]; zone: string; links: number | null }) {
  const [working, start] = useTransition();
  const [notice, setNotice] = useState<{ text: string; failed?: boolean } | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [photoFor, setPhotoFor] = useState<SimMember | null>(null);
  // Testers ticked here, shown at once, before the page is drawn again.
  const [named, setNamed] = useState<Record<string, boolean>>({});
  const minute = useSyncExternalStore(minuteNow.subscribe, minuteNow.read, () => 0);
  const picked = chosen.filter(id => sims.some(sim => sim.id === id));
  const all = sims.length > 0 && picked.length === sims.length;
  const teamName = (id: string | null) => teams.find(team => team.id === id)?.name;

  const run = (work: () => Promise<{ error?: string; done?: string }>) => start(async () => {
    const result = await work();
    setNotice(result.error ? { text: result.error, failed: true } : result.done ? { text: result.done } : null);
  });

  const stats = [
    { value: sims.length, label: "Simulated members" },
    { value: sims.filter(sim => sim.status === "waiting").length, label: "Waiting for approval" },
    { value: sims.filter(sim => sim.team).length, label: "In a team" },
    { value: minute ? sims.filter(sim => sim.status === "approved" && atWork(sim.hours, minute * 60_000)).length : "–", label: "At work now" },
    { value: sims.reduce((sum, sim) => sum + (sim.today?.done ?? 0), 0), label: "Applications today" },
  ];

  return <>
    <section className="block admin-top" aria-labelledby="sims-title">
      <div className="wrap wrap-wide">
        <p className="eyebrow block-eyebrow">Admin</p>
        <h1 id="sims-title" className="account-title">Simulated members</h1>
        <p className="account-lead">Accounts to fill KIASA while it is built and tested. Each asks for an account as anyone does; approve it, put it in a team, and set its hours and pace. Only you, and the testers you name below, see them: to everyone else they do not exist.</p>
        <dl className="b-stats admin-stats" data-count="5">
          {stats.map(stat => <div key={stat.label} className="b-stat"><dt className="b-stat-value">{stat.value}</dt><dd className="b-stat-label">{stat.label}</dd></div>)}
        </dl>
      </div>
    </section>

    <section className="block" aria-label="Simulated members">
      <div className="wrap wrap-wide sims">
        <form className="sims-add" onSubmit={event => { event.preventDefault(); run(() => addSims(count)); }}>
          <label className="chat-field sims-count"><span>How many to add</span>
            <input type="number" min={1} max={100} value={count} onChange={event => setCount(Number(event.target.value))} />
          </label>
          <button type="submit" className="admin-approve" disabled={working}>{working ? "Working…" : "Add them"}</button>
          <p className="sims-hint">Each gets a name you can change, and asks for an account: its request reaches your Account requests chat too. Hours follow the team&apos;s time zone ({zone}).</p>
        </form>

        <div className="sims-work">
          <p>Every five minutes, each one at work goes through its daily plan, at its pace, on today&apos;s real job links{links === null ? "" : ` (${links} posted today)`}. With no links, nothing is counted; interviews and offers are never made up.</p>
          <button type="button" className="account-button" disabled={working} onClick={() => run(workNow)}>Work a round now</button>
        </div>

        <div role="status">{notice && <p className="admin-notice" data-failed={notice.failed ? "" : undefined}>{notice.text}</p>}</div>

        <Bulk ids={picked} teams={teams} working={working} run={run} onDone={() => setChosen([])} />

        {sims.length ? <div className="account-scroll">
          <table className="account-table sims-table">
            <thead>
              <tr>
                <th scope="col"><input type="checkbox" aria-label="Choose everyone" checked={all} onChange={event => setChosen(event.target.checked ? sims.map(sim => sim.id) : [])} /></th>
                <th scope="col">Person</th><th scope="col">Status</th><th scope="col">Team</th><th scope="col">Hours</th><th scope="col">Pace</th><th scope="col">Today</th><th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              {sims.map(sim => {
                const now = sim.hours.paused ? "Paused" : !minute ? "–" : sim.status === "approved" && atWork(sim.hours, minute * 60_000) ? "At work" : "Off";
                return <tr key={sim.id} data-chosen={picked.includes(sim.id) || undefined}>
                  <td><input type="checkbox" aria-label={`Choose ${sim.name}`} checked={picked.includes(sim.id)}
                    onChange={event => setChosen(current => event.target.checked ? [...current, sim.id] : current.filter(id => id !== sim.id))} /></td>
                  <th scope="row">
                    <span className="sims-person">
                      <button type="button" className="sims-photo-button" aria-label={`Photo of ${sim.name}`} title="Change the photo" onClick={() => setPhotoFor(sim)}>
                        <Avatar initials={initialsOf(sim.name)} photo={sim.photo} className="chat-avatar sims-avatar" who={sim.id} />
                      </button>
                      <Name key={`${sim.id}:${sim.name}`} sim={sim} onSave={name => run(() => renameSim(sim.id, name))} />
                    </span>
                  </th>
                  <td>
                    {sim.status === "waiting"
                      ? <button type="button" className="admin-approve sims-approve" disabled={working} onClick={() => run(() => decideSims([sim.id], "approved"))}>Approve</button>
                      : <span className="admin-status" data-status={sim.status}>{STATUS[sim.status]}</span>}
                  </td>
                  <td>
                    {sim.status === "approved"
                      ? <select className="admin-role" aria-label={`Team of ${sim.name}`} value={sim.team ?? ""} disabled={working || !teams.length}
                        onChange={event => run(() => placeSims([sim.id], event.target.value || null))}>
                        <option value="">{teams.length ? "No team" : "No teams yet"}</option>
                        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                      : <span className="admin-when">{teamName(sim.team) ?? "None yet"}</span>}
                  </td>
                  <td>{sim.hours.from}–{sim.hours.to}<span className="admin-when">{daysInWords(sim.hours.days)}</span></td>
                  <td>{percent(sim.paceMin)}–{percent(sim.paceMax)}</td>
                  <td>{sim.today && sim.status === "approved" ? <>{sim.today.done} of {sim.today.target}<span className="admin-when">applications</span></> : <span className="admin-when">–</span>}</td>
                  <td>
                    <span className="sims-now" data-now={now}>{now}</span>
                    <button type="button" className="teams-link" disabled={working} onClick={() => run(() => setSims([sim.id], { paused: !sim.hours.paused }))}>
                      {sim.hours.paused ? "Resume" : "Pause"}
                    </button>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div> : <p className="b-jobs-empty">No simulated members yet. Add some above.</p>}
      </div>
    </section>

    <section className="block" aria-labelledby="sims-testers">
      <div className="wrap wrap-wide">
        <header className="block-head">
          <div className="block-head-text">
            <h2 id="sims-testers" className="block-title">Testers</h2>
            <p className="block-lead">Testers see the simulated members everywhere, as you do: to try KIASA as a manager or member would. No one else sees them.</p>
          </div>
        </header>
        {people.length > 0 && <div className="sims-testers-all">
          <button type="button" className="account-button" disabled={working} onClick={() => {
            setNamed(Object.fromEntries(people.map(person => [person.id, true])));
            run(() => setTesters(people.map(person => person.id), true));
          }}>Tick everyone</button>
          <button type="button" className="account-button" disabled={working} onClick={() => {
            setNamed(Object.fromEntries(people.map(person => [person.id, false])));
            run(() => setTesters(people.map(person => person.id), false));
          }}>Untick everyone</button>
        </div>}
        {people.length ? <ul className="sims-testers">
          {people.map(person => <li key={person.id}>
            <label className="sims-tester">
              <input type="checkbox" checked={named[person.id] ?? person.tester} onChange={event => {
                const on = event.target.checked;
                setNamed(current => ({ ...current, [person.id]: on }));
                run(() => setTester(person.id, on));
              }} />
              <Avatar initials={initialsOf(person.name)} className="chat-avatar sims-avatar" who={person.id} />
              <span>{person.name}</span>
            </label>
          </li>)}
        </ul> : <p className="b-jobs-empty">No approved people yet.</p>}
      </div>
    </section>

    {photoFor && <PhotoDialog sim={photoFor} onClose={() => setPhotoFor(null)} onSaved={text => setNotice({ text })} />}
  </>;
}

/** A name, changed in place: saved when the field is left (or on Enter). */
function Name({ sim, onSave }: { sim: SimMember; onSave: (name: string) => void }) {
  const [name, setName] = useState(sim.name);
  const save = () => { if (name.trim() && name.trim() !== sim.name) onSave(name.trim()); else setName(sim.name); };
  return <span className="sims-name">
    <input value={name} maxLength={80} aria-label={`Name of ${sim.name}`} onChange={event => setName(event.target.value)} onBlur={save}
      onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setName(sim.name); event.currentTarget.blur(); } }} />
    <span className="admin-when">{sim.email}</span>
  </span>;
}

/** What to do with everyone chosen at once. */
function Bulk({ ids, teams, working, run, onDone }: {
  ids: string[]; teams: Team[]; working: boolean; run: (work: () => Promise<{ error?: string; done?: string }>) => void; onDone: () => void;
}) {
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [low, setLow] = useState(120);
  const [high, setHigh] = useState(150);
  const [plan, setPlan] = useState(20);
  const [deleting, setDeleting] = useState(false);
  const none = !ids.length || working;
  return <div className="sims-bulk" role="group" aria-label="Everyone chosen">
    <p className="sims-bulk-count">{ids.length ? `${ids.length} chosen` : "Choose people below to change many at once"}</p>
    <div className="sims-bulk-row">
      <button type="button" className="admin-approve" disabled={none} onClick={() => run(() => decideSims(ids, "approved"))}>Approve</button>
      <select className="admin-role" aria-label="Put everyone chosen in a team" value="" disabled={none}
        onChange={event => run(() => placeSims(ids, event.target.value === "none" ? null : event.target.value))}>
        <option value="">Put in a team…</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        <option value="none">No team</option>
      </select>
      <button type="button" className="account-button" disabled={none} onClick={() => run(() => setSims(ids, { paused: true }))}>Pause</button>
      <button type="button" className="account-button" disabled={none} onClick={() => run(() => setSims(ids, { paused: false }))}>Resume</button>
      {deleting
        ? <span className="admin-confirm"><span>Delete {ids.length} for good?</span>
          <button type="button" className="account-button account-danger" disabled={none} onClick={() => { setDeleting(false); run(() => deleteSims(ids)); onDone(); }}>Delete</button>
          <button type="button" className="account-button" onClick={() => setDeleting(false)}>Keep</button></span>
        : <button type="button" className="admin-delete" disabled={none} onClick={() => setDeleting(true)}>Delete</button>}
    </div>
    <div className="sims-bulk-row">
      <span className="sims-bulk-label">Hours</span>
      <input type="time" aria-label="From" value={from} onChange={event => setFrom(event.target.value)} />
      <span>to</span>
      <input type="time" aria-label="To" value={to} onChange={event => setTo(event.target.value)} />
      <span className="sims-days" role="group" aria-label="Days">
        {DAY_NAMES.map((name, index) => <label key={name}><input type="checkbox" checked={days.includes(index + 1)}
          onChange={event => setDays(current => event.target.checked ? [...current, index + 1] : current.filter(day => day !== index + 1))} />{name}</label>)}
      </span>
      <button type="button" className="account-button" disabled={none} onClick={() => run(() => setSims(ids, { from, to, days }))}>Set hours</button>
    </div>
    <div className="sims-bulk-row">
      <span className="sims-bulk-label">Pace</span>
      <input type="number" min={100} max={200} step={5} aria-label="Lowest pace, %" value={low} onChange={event => setLow(Number(event.target.value))} />
      <span>% to</span>
      <input type="number" min={100} max={200} step={5} aria-label="Highest pace, %" value={high} onChange={event => setHigh(Number(event.target.value))} />
      <span>% of the plan</span>
      <button type="button" className="account-button" disabled={none} onClick={() => run(() => setSims(ids, { paceMin: low / 100, paceMax: high / 100 }))}>Set pace</button>
    </div>
    <div className="sims-bulk-row">
      <span className="sims-bulk-label">Plan</span>
      <input type="number" min={0} max={1000} aria-label="Applications a day" value={plan} onChange={event => setPlan(Number(event.target.value))} />
      <span>applications a day, from today</span>
      <button type="button" className="account-button" disabled={none} onClick={() => run(() => planSims(ids, plan))}>Set plan</button>
    </div>
  </div>;
}

/** Choosing, placing and saving a photo for one of them; or removing it. */
function PhotoDialog({ sim, onClose, onSaved }: { sim: SimMember; onClose: () => void; onSaved: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
  }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  const save = async (blob: Blob | null) => {
    setBusy(true);
    setError("");
    const form = new FormData();
    if (blob) form.set("photo", new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: blob.type }));
    const result = await setSimPhoto(sim.id, form);
    setBusy(false);
    if (result.error) return setError(result.error);
    onSaved(blob ? `${sim.name}'s photo is saved.` : `${sim.name}'s photo is removed.`);
    onClose();
  };
  return <dialog ref={dialog} className="sims-photo" aria-label={`Photo of ${sim.name}`} onClose={onClose}>
    <div className="photo-panel-head">
      <p className="photo-panel-title">{sim.name}</p>
      <button type="button" className="photo-close" aria-label="Close" onClick={onClose} disabled={busy}><Close /></button>
    </div>
    {source
      ? <PhotoFrame source={source} busy={busy} onSave={blob => void save(blob)} onCancel={() => setSource(null)}
        onUnreadable={() => { setSource(null); setError("That picture could not be opened here. Please choose a JPEG, PNG or WebP picture."); }} />
      : <>
        <Avatar initials={initialsOf(sim.name)} photo={sim.photo} className="photo-preview" />
        <div className="photo-actions">
          <label className="account-button photo-choose">
            {sim.photo ? "Choose another" : "Choose a photo"}
            <input type="file" accept="image/*" disabled={busy} onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file?.type.startsWith("image/")) setSource(URL.createObjectURL(file));
            }} />
          </label>
          {sim.photo && <button type="button" className="account-button" disabled={busy} onClick={() => void save(null)}>Remove</button>}
        </div>
      </>}
    {error && <p className="b-form-error" role="alert">{error}</p>}
  </dialog>;
}
