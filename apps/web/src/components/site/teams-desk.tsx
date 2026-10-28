"use client";

import { useState, useTransition } from "react";
import type { Account } from "@/content/accounts";
import { initialsOf, type Team } from "@/lib/accounts/viewer";
import { createTeam, deleteTeam, setTeam, updateTeam } from "@/lib/teams/actions";
import { TEAM_COLORS } from "@/lib/teams/colors";
import { Avatar } from "./avatar";
import { Close, Plus, Search } from "./icons";
import { TeamShield } from "./ranks";

/** What the right side shows: a team (by id), a new team being made, or the people in none. */
type Chosen = string | "new" | "unplaced";

/** The admin's teams at a glance: every team in one list at the left, its size
 * drawn beside it, and how all of KIASA is split between them in one bar; the
 * chosen team at the right, with its manager and its members, found by name.
 * Every change is saved at once, and every badge on every open page follows. */
export function TeamsDesk({ teams, people }: { teams: Team[]; people: Account[] }) {
  const [working, start] = useTransition();
  const [notice, setNotice] = useState<{ text: string; failed?: boolean } | null>(null);
  const [chosen, setChosen] = useState<Chosen>(teams[0]?.id ?? "new");
  // A team just made: chosen once the page knows its id.
  const [made, setMade] = useState<string | null>(null);
  const approved = people.filter(person => person.status === "approved").sort((a, b) => a.name.localeCompare(b.name));
  const inTeam = (team: Team) => approved.filter(person => person.team === team.id);
  const unplaced = approved.filter(person => !person.team || !teams.some(team => team.id === person.team));
  const sized = teams.map(team => ({ team, members: inTeam(team) }));
  const biggest = Math.max(1, ...sized.map(entry => entry.members.length), unplaced.length);
  const fresh = made ? teams.find(team => team.name === made) : undefined;
  const current = fresh ?? teams.find(team => team.id === chosen) ?? (chosen === "new" || chosen === "unplaced" ? null : teams[0] ?? null);
  const showing: Chosen = current ? current.id : chosen === "unplaced" ? "unplaced" : "new";
  const choose = (next: Chosen) => { setMade(null); setChosen(next); };

  const run = (work: () => Promise<{ error?: string }>, done: string, then?: () => void) => start(async () => {
    const result = await work();
    setNotice(result.error ? { text: result.error, failed: true } : { text: done });
    if (!result.error) then?.();
  });
  const move = (person: Account, team: Team | null) =>
    run(() => setTeam(person.id, team?.id ?? null), team ? `${person.name} is in ${team.name} now, and wears its badge.` : `${person.name} is in no team now.`);

  return <>
    <section className="block admin-top" aria-labelledby="teams-title">
      <div className="wrap wrap-wide">
        <p className="eyebrow block-eyebrow">Admin</p>
        <h1 id="teams-title" className="account-title">Teams</h1>
        <p className="account-lead">Each team wears its own shield. Give a team to a top manager to lead it, and put its members in it: the badge follows them everywhere in KIASA.</p>
        <dl className="b-stats admin-stats" data-count="3">
          <div className="b-stat"><dt className="b-stat-value">{teams.length}</dt><dd className="b-stat-label">Teams</dd></div>
          <div className="b-stat"><dt className="b-stat-value">{approved.length - unplaced.length}</dt><dd className="b-stat-label">People in a team</dd></div>
          <div className="b-stat"><dt className="b-stat-value">{unplaced.length}</dt><dd className="b-stat-label">Not in a team yet</dd></div>
        </dl>
        {approved.length > 0 && <div className="teams-split" role="img" aria-label={`How everyone approved is split: ${sized.map(({ team, members }) => `${team.name} ${members.length}`).join(", ")}, no team ${unplaced.length}`}>
          {sized.map(({ team, members }) => members.length > 0 && <span key={team.id} style={{ flexGrow: members.length, background: team.color }} title={`${team.name}: ${members.length}`} />)}
          {unplaced.length > 0 && <span className="teams-split-none" style={{ flexGrow: unplaced.length }} title={`No team: ${unplaced.length}`} />}
        </div>}
      </div>
    </section>

    <section className="block teams-block" aria-label="The teams">
      <div className="wrap wrap-wide">
        <div role="status">
          {notice && <p className="admin-notice" data-failed={notice.failed ? "" : undefined}>{notice.text}</p>}
        </div>
        <div className="teams-board">
          <nav className="teams-list" aria-label="Teams">
            <ul>
              {sized.map(({ team, members }) => {
                const lead = members.find(person => person.top);
                return <li key={team.id}>
                  <button type="button" className="teams-row" aria-current={showing === team.id || undefined} style={{ "--team": team.color } as React.CSSProperties} onClick={() => choose(team.id)}>
                    <TeamShield name={team.name} color={team.color} lead={!!lead} className="teams-row-shield" />
                    <span className="teams-row-text">
                      <span className="teams-row-name">{team.name}</span>
                      <span className="teams-row-lead">{lead ? `Led by ${lead.name}` : "No manager yet"}</span>
                      <span className="teams-row-bar" aria-hidden="true"><i style={{ width: `${(members.length / biggest) * 100}%` }} /></span>
                    </span>
                    <span className="teams-row-count" aria-label={`${members.length} ${members.length === 1 ? "person" : "people"}`}>{members.length}</span>
                  </button>
                </li>;
              })}
              <li>
                <button type="button" className="teams-row teams-row-quiet" aria-current={showing === "unplaced" || undefined} onClick={() => choose("unplaced")}>
                  <span className="teams-row-icon" aria-hidden="true">?</span>
                  <span className="teams-row-text"><span className="teams-row-name">Not in a team</span><span className="teams-row-lead">Wear no team badge yet</span></span>
                  <span className="teams-row-count">{unplaced.length}</span>
                </button>
              </li>
            </ul>
            <button type="button" className="teams-new-button" aria-current={showing === "new" || undefined} onClick={() => choose("new")}><Plus />New team</button>
          </nav>

          <div className="teams-detail" key={showing}>
            {current
              ? <TeamDetail team={current} members={inTeam(current)} everyone={approved} teams={teams} working={working}
                onMove={move} onSave={(name, color) => run(() => updateTeam(current.id, name, color), `${name} is saved.`)}
                onDelete={() => run(() => deleteTeam(current.id), `${current.name} is deleted; its people are in no team now.`, () => choose(teams.find(team => team.id !== current.id)?.id ?? "new"))} />
              : showing === "unplaced"
                ? <Unplaced people={unplaced} teams={teams} working={working} onMove={move} />
                : <NewTeam taken={teams.map(team => team.color)} working={working}
                  onCreate={(name, color) => run(() => createTeam(name, color), `${name} is made. Give it to a top manager to lead it.`, () => setMade(name.replace(/\s+/g, " ").trim()))} />}
          </div>
        </div>
      </div>
    </section>
  </>;
}

function TeamPicker({ person, teams, working, onMove }: { person: Account; teams: Team[]; working: boolean; onMove: (person: Account, team: Team | null) => void }) {
  return <select className="admin-role" aria-label={`Team of ${person.name}`} value={person.team ?? ""} disabled={working || !teams.length}
    onChange={event => onMove(person, teams.find(team => team.id === event.target.value) ?? null)}>
    <option value="">No team</option>
    {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
  </select>;
}

function ColorChoice({ value, taken, onChange }: { value: string; taken: string[]; onChange: (color: string) => void }) {
  return <div className="teams-colors" role="radiogroup" aria-label="Colour">
    {TEAM_COLORS.map(entry => <button key={entry.color} type="button" role="radio" aria-checked={value === entry.color} aria-label={`${entry.name}${taken.includes(entry.color) && value !== entry.color ? " (another team has it)" : ""}`}
      title={entry.name} className="teams-color" data-taken={taken.includes(entry.color) && value !== entry.color ? "" : undefined} style={{ background: entry.color }} onClick={() => onChange(entry.color)} />)}
  </div>;
}

/** Someone found by name or email. */
const finds = (person: Account, query: string) => !query || `${person.name} ${person.email}`.toLowerCase().includes(query.toLowerCase());

function TeamDetail({ team, members, everyone, teams, working, onMove, onSave, onDelete }: {
  team: Team; members: Account[]; everyone: Account[]; teams: Team[]; working: boolean;
  onMove: (person: Account, team: Team | null) => void; onSave: (name: string, color: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [color, setColor] = useState(team.color);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const managers = members.filter(person => person.top);
  const others = members.filter(person => !person.top);
  const shown = others.filter(person => finds(person, query.trim()));
  // Top managers not leading another team can be given this one.
  const free = everyone.filter(person => person.top && !teams.some(entry => entry.id === person.team));
  const outside = everyone.filter(person => !person.top && person.team !== team.id);

  return <article className="teams-panel" style={{ "--team": team.color } as React.CSSProperties} aria-label={team.name}>
    <header className="teams-panel-head">
      <TeamShield name={editing ? name || "?" : team.name} color={editing ? color : team.color} lead={managers.length > 0} className="teams-panel-shield" />
      {editing
        ? <div className="teams-edit">
          <label className="chat-field"><span>Name</span><input value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label>
          <ColorChoice value={color} taken={teams.filter(entry => entry.id !== team.id).map(entry => entry.color)} onChange={setColor} />
          <div className="teams-actions">
            <button type="button" className="admin-approve" disabled={working || !name.trim()} onClick={() => { onSave(name, color); setEditing(false); }}>Save</button>
            <button type="button" className="account-button" onClick={() => { setName(team.name); setColor(team.color); setEditing(false); }}>Cancel</button>
          </div>
        </div>
        : <div className="teams-panel-title">
          <h2 className="teams-name">{team.name}</h2>
          <p className="teams-count">{members.length} {members.length === 1 ? "person" : "people"}{managers.length ? ` · led by ${managers.map(person => person.name).join(" and ")}` : " · no manager yet"}</p>
        </div>}
      {!editing && <div className="teams-panel-actions">
        <button type="button" className="account-button" onClick={() => setEditing(true)}>Rename or recolour</button>
        {deleting
          ? <span className="admin-confirm"><span>Delete {team.name}?</span>
            <button type="button" className="account-button account-danger" disabled={working} onClick={onDelete}>Delete</button>
            <button type="button" className="account-button" onClick={() => setDeleting(false)}>Keep</button></span>
          : <button type="button" className="account-button teams-danger" onClick={() => setDeleting(true)}>Delete</button>}
      </div>}
    </header>

    <div className="teams-section">
      <h3 className="teams-label">Led by</h3>
      {managers.length
        ? <ul className="teams-people">{managers.map(person => <Member key={person.id} person={person} working={working} onRemove={() => onMove(person, null)} />)}</ul>
        : <div className="teams-give">
          <p className="teams-none">No manager yet.</p>
          <select className="admin-role" aria-label={`Give ${team.name} to a top manager`} value="" disabled={working || !free.length}
            onChange={event => { const person = free.find(entry => entry.id === event.target.value); if (person) onMove(person, team); }}>
            <option value="">{free.length ? "Give it to a top manager…" : "No top manager is free"}</option>
            {free.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </div>}
    </div>

    <div className="teams-section">
      <div className="teams-section-head">
        <h3 className="teams-label">Members <span>{others.length}</span></h3>
        <div className="teams-tools">
          {others.length > 6 && <label className="teams-search">
            <Search aria-hidden="true" />
            <input type="search" value={query} placeholder="Find a member" aria-label={`Find a member of ${team.name}`} onChange={event => setQuery(event.target.value)} />
          </label>}
          <select className="admin-role teams-add" aria-label={`Add someone to ${team.name}`} value="" disabled={working || !outside.length}
            onChange={event => { const person = outside.find(entry => entry.id === event.target.value); if (person) onMove(person, team); }}>
            <option value="">{outside.length ? "Add someone…" : "Everyone is placed"}</option>
            {outside.map(person => <option key={person.id} value={person.id}>{person.name}{person.team ? " (moves from their team)" : ""}</option>)}
          </select>
        </div>
      </div>
      {others.length
        ? shown.length
          ? <ul className="teams-people teams-people-grid">{shown.map(person => <Member key={person.id} person={person} working={working} onRemove={() => onMove(person, null)} />)}</ul>
          : <p className="teams-none">No member matches “{query.trim()}”.</p>
        : <p className="teams-none">No members yet. Add someone from the list above.</p>}
    </div>
  </article>;
}

function Member({ person, working, onRemove }: { person: Account; working: boolean; onRemove: () => void }) {
  return <li className="teams-person">
    <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar teams-person-photo" who={person.id} />
    <span className="teams-person-text"><span className="teams-person-name">{person.name}</span><span className="teams-person-role">{person.top ? "Top manager" : person.organization ?? person.email}</span></span>
    <button type="button" className="chat-icon teams-remove" aria-label={`Take ${person.name} out of the team`} title="Take out of the team" disabled={working} onClick={onRemove}><Close /></button>
  </li>;
}

function Unplaced({ people, teams, working, onMove }: { people: Account[]; teams: Team[]; working: boolean; onMove: (person: Account, team: Team | null) => void }) {
  const [query, setQuery] = useState("");
  const shown = people.filter(person => finds(person, query.trim()));
  return <article className="teams-panel" aria-label="Not in a team">
    <header className="teams-panel-head">
      <span className="teams-row-icon teams-panel-icon" aria-hidden="true">?</span>
      <div className="teams-panel-title">
        <h2 className="teams-name">Not in a team</h2>
        <p className="teams-count">Approved people wear no team badge until they are put in a team.</p>
      </div>
    </header>
    <div className="teams-section">
      <div className="teams-section-head">
        <h3 className="teams-label">People <span>{people.length}</span></h3>
        {people.length > 6 && <div className="teams-tools"><label className="teams-search">
          <Search aria-hidden="true" />
          <input type="search" value={query} placeholder="Find someone" aria-label="Find someone not in a team" onChange={event => setQuery(event.target.value)} />
        </label></div>}
      </div>
      {people.length
        ? <ul className="teams-people teams-people-grid">
          {shown.map(person => <li key={person.id} className="teams-person">
            <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar teams-person-photo" who={person.id} />
            <span className="teams-person-text"><span className="teams-person-name">{person.name}</span><span className="teams-person-role">{person.top ? "Top manager" : person.organization ?? person.email}</span></span>
            <TeamPicker person={person} teams={teams} working={working} onMove={onMove} />
          </li>)}
        </ul>
        : <p className="teams-none">Everyone approved is in a team.</p>}
    </div>
  </article>;
}

function NewTeam({ taken, working, onCreate }: { taken: string[]; working: boolean; onCreate: (name: string, color: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TEAM_COLORS.find(entry => !taken.includes(entry.color))?.color ?? TEAM_COLORS[0].color);
  return <article className="teams-panel teams-new" aria-label="New team">
    <header className="teams-panel-head">
      <TeamShield name={name || "?"} color={color} className="teams-panel-shield" />
      <div className="teams-panel-title"><h2 className="teams-name">New team</h2><p className="teams-count">Its name and colour make its shield. A new top manager is given a team of their own.</p></div>
    </header>
    <div className="teams-section teams-new-form">
      <label className="chat-field"><span>Name</span><input value={name} maxLength={40} placeholder="e.g. Sales" onChange={event => setName(event.target.value)} /></label>
      <ColorChoice value={color} taken={taken} onChange={setColor} />
      <button type="button" className="admin-approve" disabled={working || !name.trim()} onClick={() => { onCreate(name, color); setName(""); }}>Make the team</button>
    </div>
  </article>;
}
