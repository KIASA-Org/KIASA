"use client";

import { useState, useTransition } from "react";
import type { Account } from "@/content/accounts";
import { initialsOf, type Team } from "@/lib/accounts/viewer";
import { createTeam, deleteTeam, setTeam, updateTeam } from "@/lib/teams/actions";
import { TEAM_COLORS } from "@/lib/teams/colors";
import { Avatar } from "./avatar";
import { Close } from "./icons";
import { TeamShield } from "./ranks";

/** The admin's teams: each team's shield, the top manager who leads it, and its
 * members; a new team; and the people in no team yet. Every change is saved at
 * once, and every badge on every open page follows. */
export function TeamsDesk({ teams, people }: { teams: Team[]; people: Account[] }) {
  const [working, start] = useTransition();
  const [notice, setNotice] = useState<{ text: string; failed?: boolean } | null>(null);
  const approved = people.filter(person => person.status === "approved").sort((a, b) => a.name.localeCompare(b.name));
  const inTeam = (team: Team) => approved.filter(person => person.team === team.id);
  const unplaced = approved.filter(person => !person.team || !teams.some(team => team.id === person.team));

  const run = (work: () => Promise<{ error?: string }>, done: string) => start(async () => {
    const result = await work();
    setNotice(result.error ? { text: result.error, failed: true } : { text: done });
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
      </div>
    </section>

    <section className="block" aria-label="The teams">
      <div className="wrap wrap-wide">
        <div role="status">
          {notice && <p className="admin-notice" data-failed={notice.failed ? "" : undefined}>{notice.text}</p>}
        </div>
        <div className="teams-grid">
          {teams.map(team => <TeamCard key={team.id} team={team} members={inTeam(team)} everyone={approved} teams={teams} working={working}
            onMove={move} onSave={(name, color) => run(() => updateTeam(team.id, name, color), `${name} is saved.`)}
            onDelete={() => run(() => deleteTeam(team.id), `${team.name} is deleted; its people are in no team now.`)} />)}
          <NewTeam taken={teams.map(team => team.color)} working={working} onCreate={(name, color) => run(() => createTeam(name, color), `${name} is made. Give it to a top manager to lead it.`)} />
        </div>
      </div>
    </section>

    <section className="block" aria-labelledby="teams-unplaced">
      <div className="wrap wrap-wide">
        <header className="block-head">
          <div className="block-head-text">
            <h2 id="teams-unplaced" className="block-title">Not in a team yet</h2>
            <p className="block-lead">Approved people wear no team badge until they are put in a team.</p>
          </div>
        </header>
        {unplaced.length ? <ul className="teams-unplaced">
          {unplaced.map(person => <li key={person.id} className="teams-person">
            <Avatar initials={initialsOf(person.name)} className="chat-avatar teams-person-photo" who={person.id} />
            <span className="teams-person-text"><span className="teams-person-name">{person.name}</span><span className="teams-person-role">{person.top ? "Top manager" : person.organization ?? person.email}</span></span>
            <TeamPicker person={person} teams={teams} working={working} onMove={move} />
          </li>)}
        </ul> : <p className="b-jobs-empty">Everyone approved is in a team.</p>}
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

function TeamCard({ team, members, everyone, teams, working, onMove, onSave, onDelete }: {
  team: Team; members: Account[]; everyone: Account[]; teams: Team[]; working: boolean;
  onMove: (person: Account, team: Team | null) => void; onSave: (name: string, color: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [color, setColor] = useState(team.color);
  const [deleting, setDeleting] = useState(false);
  const managers = members.filter(person => person.top);
  const others = members.filter(person => !person.top);
  // Top managers not leading another team can be given this one.
  const free = everyone.filter(person => person.top && !teams.some(entry => entry.id === person.team));
  const outside = everyone.filter(person => !person.top && person.team !== team.id);

  return <article className="teams-card" style={{ "--team": team.color } as React.CSSProperties} aria-label={team.name}>
    <header className="teams-card-head">
      <TeamShield name={editing ? name || "?" : team.name} color={editing ? color : team.color} lead={managers.length > 0} className="teams-card-shield" />
      {editing
        ? <div className="teams-edit">
          <label className="chat-field"><span>Name</span><input value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label>
          <ColorChoice value={color} taken={teams.filter(entry => entry.id !== team.id).map(entry => entry.color)} onChange={setColor} />
          <div className="teams-actions">
            <button type="button" className="admin-approve" disabled={working || !name.trim()} onClick={() => { onSave(name, color); setEditing(false); }}>Save</button>
            <button type="button" className="account-button" onClick={() => { setName(team.name); setColor(team.color); setEditing(false); }}>Cancel</button>
          </div>
        </div>
        : <div className="teams-card-title">
          <h2 className="teams-name">{team.name}</h2>
          <p className="teams-count">{members.length} {members.length === 1 ? "person" : "people"}</p>
          <div className="teams-actions">
            <button type="button" className="teams-link" onClick={() => setEditing(true)}>Rename or recolour</button>
            {deleting
              ? <span className="admin-confirm"><span>Delete {team.name}?</span>
                <button type="button" className="account-button account-danger" disabled={working} onClick={onDelete}>Delete</button>
                <button type="button" className="account-button" onClick={() => setDeleting(false)}>Keep</button></span>
              : <button type="button" className="teams-link teams-danger" onClick={() => setDeleting(true)}>Delete</button>}
          </div>
        </div>}
    </header>

    <p className="teams-label">Led by</p>
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

    <p className="teams-label">Members</p>
    {others.length
      ? <ul className="teams-people">{others.map(person => <Member key={person.id} person={person} working={working} onRemove={() => onMove(person, null)} />)}</ul>
      : <p className="teams-none">No members yet.</p>}
    <select className="admin-role teams-add" aria-label={`Add someone to ${team.name}`} value="" disabled={working || !outside.length}
      onChange={event => { const person = outside.find(entry => entry.id === event.target.value); if (person) onMove(person, team); }}>
      <option value="">{outside.length ? "Add someone…" : "Everyone is placed"}</option>
      {outside.map(person => <option key={person.id} value={person.id}>{person.name}{person.team ? " (moves from their team)" : ""}</option>)}
    </select>
  </article>;
}

function Member({ person, working, onRemove }: { person: Account; working: boolean; onRemove: () => void }) {
  return <li className="teams-person">
    <Avatar initials={initialsOf(person.name)} className="chat-avatar teams-person-photo" who={person.id} />
    <span className="teams-person-text"><span className="teams-person-name">{person.name}</span><span className="teams-person-role">{person.top ? "Manager" : person.organization ?? person.email}</span></span>
    <button type="button" className="chat-icon" aria-label={`Take ${person.name} out of the team`} title="Take out of the team" disabled={working} onClick={onRemove}><Close /></button>
  </li>;
}

function NewTeam({ taken, working, onCreate }: { taken: string[]; working: boolean; onCreate: (name: string, color: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TEAM_COLORS.find(entry => !taken.includes(entry.color))?.color ?? TEAM_COLORS[0].color);
  return <article className="teams-card teams-new" aria-label="New team">
    <header className="teams-card-head">
      <TeamShield name={name || "?"} color={color} className="teams-card-shield" />
      <div className="teams-card-title"><h2 className="teams-name">New team</h2><p className="teams-count">Its name and colour make its shield.</p></div>
    </header>
    <label className="chat-field"><span>Name</span><input value={name} maxLength={40} placeholder="e.g. Sales" onChange={event => setName(event.target.value)} /></label>
    <ColorChoice value={color} taken={taken} onChange={setColor} />
    <button type="button" className="admin-approve" disabled={working || !name.trim()} onClick={() => { onCreate(name, color); setName(""); }}>Make the team</button>
  </article>;
}
