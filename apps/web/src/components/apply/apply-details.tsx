"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { browserClient } from "@/lib/accounts/browser";

type Fact = { question: string; answer: string };
type Ask = { id: string; label: string; why: string; kind?: string; options?: string[] };
type Fields = Record<string, string>;

const CONTACT: { key: string; label: string; type?: string; auto?: string }[][] = [
  [{ key: "first_name", label: "First name", auto: "given-name" }, { key: "last_name", label: "Last name", auto: "family-name" }],
  [{ key: "email", label: "Email", type: "email", auto: "email" }, { key: "phone", label: "Phone", type: "tel", auto: "tel" }],
  [{ key: "country", label: "Country", auto: "country-name" }, { key: "city", label: "City", auto: "address-level2" }],
  [{ key: "address", label: "Street address", auto: "street-address" }],
  [{ key: "state", label: "State", auto: "address-level1" }, { key: "zip", label: "Zip code", auto: "postal-code" }],
  [{ key: "linkedin", label: "LinkedIn address", type: "url" }, { key: "website", label: "Website", type: "url" }],
  [{ key: "github", label: "GitHub address", type: "url" }],
];
const CONTACT_KEYS = CONTACT.flat().map(field => field.key);

/** Only the member can say these. Their names are what the model server looks for: without
 * one saved, a form's question on it waits for the member instead of going to the model. */
const ONLY_YOU: { question: string; hint: string }[] = [
  { question: "Work authorization", hint: "Where you may legally work, and on what basis." },
  { question: "Visa sponsorship", hint: "Whether you need it, now or in the future." },
  { question: "Citizenship", hint: "Your citizenship or residency, as you would state it on an application." },
  { question: "Security clearance", hint: "Any you hold, or that you hold none." },
  { question: "Criminal record", hint: "Only what you would state on an application." },
  { question: "Work restrictions", hint: "Any non-compete or similar agreement that limits where you can work, or that you have none." },
];
const WRITTEN: { question: string; hint: string }[] = [
  { question: "Salary expectations", hint: "The range you want. If you leave this empty, the model may write a figure of its own." },
  { question: "Earliest start date", hint: "When you could start, as in “two weeks after an offer”." },
];
/** Voluntary questions. Saved, they are copied into forms; left empty, the agent takes the
 * form's own way of declining. These never go to the model. Their names are what the model
 * server looks for. */
const VOLUNTARY: { question: string; options: string[] }[] = [
  { question: "Gender", options: ["Female", "Male", "Non-binary"] },
  { question: "Race", options: ["White", "Asian", "Black or African American", "Hispanic or Latino", "Native American or Alaska Native", "Native Hawaiian or Pacific Islander"] },
  { question: "Hispanic or Latino", options: ["No", "Yes"] },
  { question: "Veteran status", options: ["I am not a veteran", "I am a veteran"] },
  { question: "Disability status", options: ["No", "Yes"] },
  { question: "LGBTQ+", options: ["No", "Yes"] },
];
const FIXED = [...ONLY_YOU, ...WRITTEN, ...VOLUNTARY].map(item => item.question);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Résumés keep a school's year only, and forms also ask its month. These names are what the
 * model server looks for. */
const startOf = (school: string) => `Start month at ${school}`;
const endOf = (school: string) => `End month at ${school}`;

const CAREER_LIMIT = 6000;
const ANSWER_LIMIT = 2000;

const same = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/** The fields as saved, or, the first time, what the member's base résumé already says. */
function fromResume(info: Record<string, string> | undefined): Fields {
  if (!info) return {};
  const [first, ...rest] = (info.name ?? "").trim().split(/\s+/);
  const place = (info.location ?? "").split(",").map(part => part.trim());
  return { first_name: first ?? "", last_name: rest.join(" "), email: info.email ?? "", phone: info.phone ?? "", linkedin: info.linkedin ?? "", city: place[0] ?? "" };
}

/** What the member enters for applying: how to reach them, what only they can say, and more
 * about their career than a résumé holds. Theirs alone: admins cannot read it. */
export function ApplyDetails({ realtime, me }: { realtime: { url: string; key: string }; me: string }) {
  const supabase = useMemo(() => browserClient(realtime.url, realtime.key), [realtime.url, realtime.key]);
  const [loaded, setLoaded] = useState(false);
  const [fromBase, setFromBase] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [facts, setFacts] = useState<Fact[]>([]);
  const [schools, setSchools] = useState<string[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    let stopped = false;
    const loadAsks = async () => {
      const { data } = await supabase.from("apply_results").select("asks").eq("user_id", me).eq("outcome", "waiting");
      if (stopped) return;
      const found = new Map<string, Ask>();
      for (const row of data ?? []) for (const ask of (row.asks ?? []) as Ask[]) if (ask?.label) found.set(same(ask.label), ask);
      setAsks([...found.values()]);
    };
    const load = async () => {
      const [saved, base] = await Promise.all([
        supabase.from("apply_details").select("details").eq("user_id", me).maybeSingle(),
        supabase.from("resume_profiles").select("profile").eq("user_id", me).maybeSingle(),
      ]);
      if (stopped) return;
      const details = saved.data?.details as (Fields & { facts?: Fact[] }) | undefined;
      const education = (base.data?.profile as { education?: { school?: string }[] } | undefined)?.education ?? [];
      setSchools([...new Set(education.map(entry => entry.school?.trim() ?? "").filter(Boolean))]);
      if (details) {
        const { facts: kept, ...rest } = details;
        setFields(rest);
        setFacts(kept ?? []);
      } else {
        const start = fromResume((base.data?.profile as { info?: Record<string, string> } | undefined)?.info);
        setFields(start);
        setFromBase(Object.values(start).some(Boolean));
      }
      setLoaded(true);
    };
    void load();
    void loadAsks();
    const channel = supabase.channel(`apply-asks:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "apply_results", filter: `user_id=eq.${me}` }, () => void loadAsks())
      .subscribe();
    return () => { stopped = true; void supabase.removeChannel(channel); };
  }, [supabase, me]);

  const factFor = (question: string) => facts.find(fact => same(fact.question) === same(question))?.answer ?? "";
  const setFact = (question: string, answer: string) => {
    setNote(null);
    setFacts(list => [...list.filter(fact => same(fact.question) !== same(question)), { question, answer }]);
  };
  const setField = (key: string, value: string) => {
    setNote(null);
    setFields(now => ({ ...now, [key]: value }));
  };

  /** Empty answers are not kept: a question with no saved answer goes back to waiting for one. */
  const save = async (list: Fact[]) => {
    setSaving(true);
    setNote(null);
    const kept = list.map(fact => ({ question: fact.question, answer: fact.answer.trim() })).filter(fact => fact.answer);
    const details = { ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()])), facts: kept };
    const { error } = await supabase.from("apply_details").upsert({ user_id: me, details }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      setNote({ text: "That did not save. Please try again.", bad: true });
      return false;
    }
    setFacts(kept);
    setFromBase(false);
    setNote({ text: "Saved.", bad: false });
    return true;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(facts);
  };

  const answerAsk = async (ask: Ask) => {
    const reply = replies[same(ask.label)]?.trim();
    if (!reply) return;
    const list = [...facts.filter(fact => same(fact.question) !== same(ask.label)), { question: ask.label, answer: reply }];
    if (await save(list)) setReplies(now => ({ ...now, [same(ask.label)]: "" }));
  };

  const waiting = asks.filter(ask => !facts.some(fact => same(fact.question) === same(ask.label)));
  const shownElsewhere = [...FIXED, ...schools.flatMap(school => [startOf(school), endOf(school)])];
  const extras = facts.filter(fact => !shownElsewhere.some(question => same(question) === same(fact.question)) && fact.answer);
  const needed = !loaded ? [] : CONTACT_KEYS.slice(0, 4).filter(key => !fields[key]?.trim());

  return <section className="jobs-card apply-details" aria-labelledby="apply-details-title">
    <header className="jobs-card-head">
      <div>
        <h2 id="apply-details-title" className="jobs-card-title">Your details for applying</h2>
        <p className="jobs-card-sub" role="status">{!loaded ? "Loading…" : needed.length ? "The agent cannot apply until the first four are filled in" : "Only you can see these. KIASA admins cannot."}</p>
      </div>
    </header>

    {waiting.length > 0 && <div className="apply-waiting" role="region" aria-label="Questions waiting for your answer">
      <p className="apply-section-title">Waiting for your answer</p>
      <p className="jobs-form-hint">The agent stopped on these jobs because only you can answer. Your answer is kept for this exact question, and those jobs then go ahead.</p>
      {waiting.map(ask => {
        const key = same(ask.label);
        const options = ask.kind === "checkbox" ? ["Yes", "No"] : ask.options ?? [];
        return <div key={key} className="apply-ask">
          <p className="apply-ask-label">{ask.label}</p>
          {ask.why && <p className="jobs-form-hint">{ask.why}</p>}
          <div className="apply-ask-reply">
            {options.length > 0
              ? <select aria-label={`Your answer: ${ask.label}`} value={replies[key] ?? ""} onChange={event => setReplies(now => ({ ...now, [key]: event.target.value }))}>
                  <option value="">Choose…</option>
                  {options.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              : <input aria-label={`Your answer: ${ask.label}`} value={replies[key] ?? ""} maxLength={ANSWER_LIMIT} onChange={event => setReplies(now => ({ ...now, [key]: event.target.value }))} />}
            <button type="button" className="jobs-button" data-primary="" disabled={saving || !replies[key]?.trim()} onClick={() => void answerAsk(ask)}>Save answer</button>
          </div>
        </div>;
      })}
    </div>}

    <form className="jobs-form" onSubmit={submit}>
      {fromBase && <p className="jobs-form-hint">Filled in from your base résumé. Check them, then save.</p>}
      <p className="apply-section-title">How to reach you</p>
      <p className="jobs-form-hint">Copied into each application exactly as you write them.</p>
      {CONTACT.map(row => <div key={row[0].key} className="jobs-form-pair">
        {row.map(field => <label key={field.key} className="chat-field"><span>{field.label}</span>
          <input type={field.type ?? "text"} autoComplete={field.auto ?? "off"} maxLength={300} disabled={!loaded} value={fields[field.key] ?? ""} onChange={event => setField(field.key, event.target.value)} />
        </label>)}
      </div>)}

      <p className="apply-section-title">Only you can answer these</p>
      <p className="jobs-form-hint">Applications ask them often, and they have to be true. If you leave one empty and a form asks it, that job waits for your answer.</p>
      {ONLY_YOU.map(item => <label key={item.question} className="chat-field"><span>{item.question}</span>
        <input maxLength={ANSWER_LIMIT} disabled={!loaded} value={factFor(item.question)} onChange={event => setFact(item.question, event.target.value)} />
        <small className="jobs-form-hint">{item.hint}</small>
      </label>)}

      <p className="apply-section-title">Voluntary questions</p>
      <p className="jobs-form-hint">Forms often ask these. Left as they are, the agent chooses each form&apos;s way of declining to answer.</p>
      <div className="jobs-form-pair">
        {VOLUNTARY.map(item => <label key={item.question} className="chat-field"><span>{item.question}</span>
          <select disabled={!loaded} value={factFor(item.question)} onChange={event => setFact(item.question, event.target.value)}>
            <option value="">Prefer not to say</option>
            {item.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>)}
      </div>

      <p className="apply-section-title">Statements on forms</p>
      <label className="apply-agree">
        <input type="checkbox" disabled={!loaded} checked={fields.agree_for_me === "yes"} onChange={event => setField("agree_for_me", event.target.checked ? "yes" : "")} />
        <span>Tick required statements for me</span>
      </label>
      <p className="jobs-form-hint">Many forms make you tick a statement to apply, such as accepting a privacy notice or confirming your application is your own work. With this on, the agent ticks the required ones for you, and each counts as you saying it. With it off, those jobs wait for your answer. Optional boxes, such as offers to text you, stay empty either way.</p>

      {schools.length > 0 && <>
        <p className="apply-section-title">School dates</p>
        <p className="jobs-form-hint">Your résumé keeps only the year for each school, and forms often ask the month too.</p>
        {schools.map(school => <div key={school} className="jobs-form-pair">
          {[{ name: startOf(school), label: `${school}: start month` }, { name: endOf(school), label: `${school}: end month` }].map(item => <label key={item.name} className="chat-field"><span>{item.label}</span>
            <select disabled={!loaded} value={factFor(item.name)} onChange={event => setFact(item.name, event.target.value)}>
              <option value="">Not set</option>
              {MONTHS.map(month => <option key={month} value={month}>{month}</option>)}
            </select>
          </label>)}
        </div>)}
      </>}

      <p className="apply-section-title">For written answers</p>
      <div className="jobs-form-pair">
        {WRITTEN.map(item => <label key={item.question} className="chat-field"><span>{item.question}</span>
          <input maxLength={ANSWER_LIMIT} disabled={!loaded} value={factFor(item.question)} onChange={event => setFact(item.question, event.target.value)} />
          <small className="jobs-form-hint">{item.hint}</small>
        </label>)}
      </div>
      <label className="chat-field"><span>More about my career</span>
        <textarea rows={6} maxLength={CAREER_LIMIT} disabled={!loaded} value={fields.career ?? ""} onChange={event => setField("career", event.target.value)} />
        <small className="jobs-form-hint">What your résumé leaves out: projects, tools, results, why you do this work. The model only knows what you tell it, so anything left out here it can only guess at.</small>
      </label>

      {extras.length > 0 && <>
        <p className="apply-section-title">Answers you gave to forms</p>
        <ul className="apply-facts">{extras.map(fact => <li key={same(fact.question)} className="apply-fact">
          <div className="apply-main">
            <p className="apply-ask-label">{fact.question}</p>
            <p className="apply-detail">{fact.answer}</p>
          </div>
          <button type="button" className="chat-pill" aria-label={`Remove your answer: ${fact.question}`} onClick={() => setFacts(list => list.filter(item => item !== fact))}>Remove</button>
        </li>)}</ul>
      </>}

      <p className="jobs-form-hint">When the agent applies, the job description, the résumé made for that job and these details go to KIASA&apos;s model server, which writes the answers and does not keep them. The model itself is not given your name, email or phone.</p>
      <div className="apply-save">
        <button type="submit" className="jobs-button" data-primary="" disabled={!loaded || saving}>{saving ? "Saving…" : "Save my details"}</button>
        {note && <p className="jobs-form-hint" role={note.bad ? "alert" : "status"}>{note.text}</p>}
      </div>
    </form>
  </section>;
}
