"use client";

import type { ChatMe, ChatPerson } from "@/lib/chat/types";
import type { Team } from "@/lib/accounts/viewer";
import { Avatar } from "../site/avatar";
import { Close } from "../site/icons";
import { TeamShield, useRanks } from "../site/ranks";
import { initialsOf } from "./chat-format";

type Section = { key: string; title: string; team?: Team; people: ChatPerson[] };

/** Everyone, beside the conversation, as Discord lists a server's members: by
 * team (KIASA's admins first, then each team with its manager on top, then
 * those in no team yet), each with how many are in it; online people first and
 * bright, the others dimmed. In a group, only the group's members. Choosing
 * someone opens a chat with them (or asks the admin, where that is needed). */
export function MembersPanel({ me, people, ids, title, online, onPerson, onClose }: {
  me: ChatMe; people: ChatPerson[]; ids?: string[]; title: string; online: Set<string>;
  onPerson: (person: string) => void; onClose: () => void;
}) {
  const ranks = useRanks();
  const shown = ids ? people.filter(person => ids.includes(person.id)) : people;
  const placed = ranks.placed ?? {};
  const teams = ranks.teams ?? [];
  const lead = (person: string) => ranks.top.includes(person);
  // Online first; within each, managers on top, then by name.
  const order = (a: ChatPerson, b: ChatPerson) => Number(online.has(b.id)) - Number(online.has(a.id))
    || Number(lead(b.id)) - Number(lead(a.id)) || a.name.localeCompare(b.name);
  const sections: Section[] = [
    { key: "admins", title: "KIASA admins", people: shown.filter(person => ranks.owners.includes(person.id)) },
    ...teams.map(team => ({ key: team.id, title: team.name, team, people: shown.filter(person => placed[person.id] === team.id && !ranks.owners.includes(person.id)) })),
    { key: "none", title: "Not in a team", people: shown.filter(person => !ranks.owners.includes(person.id) && !teams.some(team => team.id === placed[person.id])) },
  ].filter(section => section.people.length);
  const here = shown.filter(person => online.has(person.id)).length;

  return <aside className="chat-members" aria-label={title}>
    <div className="chat-members-head">
      <p className="chat-members-title">{title} <span>— {shown.length}</span></p>
      <p className="chat-members-online"><span aria-hidden="true" />{here} online</p>
      <button type="button" className="chat-icon chat-members-close" aria-label="Hide the members" title="Hide" onClick={onClose}><Close /></button>
    </div>
    <div className="chat-members-body">
      {sections.map(section => <section key={section.key} aria-label={`${section.title}, ${section.people.length}`}>
        <h3 className="chat-members-section">
          {section.team && <TeamShield name={section.team.name} color={section.team.color} className="chat-members-shield" />}
          {section.title} — {section.people.length}
        </h3>
        <ul>
          {[...section.people].sort(order).map(person => {
            const on = online.has(person.id);
            const sub = ranks.owners.includes(person.id) ? "Admin" : lead(person.id) ? (section.team ? "Manager" : "Top manager") : person.username ? `@${person.username}` : "";
            return <li key={person.id}>
              <button type="button" className="chat-member" data-offline={on ? undefined : ""} disabled={person.id === me.id}
                title={person.id === me.id ? "You" : `Message ${person.name}`} onClick={() => onPerson(person.id)}>
                <Avatar initials={initialsOf(person.name)} photo={person.photo} className="chat-avatar" who={person.id}>
                  {on && <span className="chat-online" />}
                </Avatar>
                <span className="chat-member-text">
                  <span className="chat-member-name" data-lead={lead(person.id) || ranks.owners.includes(person.id) || undefined}>{person.name}{person.id === me.id ? " (you)" : ""}</span>
                  {sub && <span className="chat-member-sub">{sub}</span>}
                </span>
              </button>
            </li>;
          })}
        </ul>
      </section>)}
      {!sections.length && <p className="chat-list-empty">No one yet.</p>}
    </div>
  </aside>;
}
