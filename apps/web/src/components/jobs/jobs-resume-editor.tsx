"use client";

import { useState, type ReactNode } from "react";
import { fromForm, tidyProfile, toForm, validateProfile, type ExperienceForm, type FormModel, type SkillForm } from "@/lib/resume/profile-form";
import type { Profile } from "@/lib/resume/schema";
import { ArrowLeft, ChevronDown, Close, Plus } from "../site/icons";

type Certification = Profile["certifications"][number];
type Education = Profile["education"][number];

const newExperience = (): ExperienceForm => ({ title: "", company: "", location: "", startDate: "", endDate: "", bullets: "" });
const newEducation = (): Education => ({ degree: "", major: "", school: "", startDate: "", endDate: "" });
const newSkill = (): SkillForm => ({ category: "", skills: "" });
const newCertification = (): Certification => ({ name: "", issuer: "", date: "" });
/** An empty form is friendlier with a row to type into; empty rows are dropped on saving. */
const withStarterRows = (form: FormModel): FormModel => ({
  ...form,
  experience: form.experience.length ? form.experience : [newExperience()],
  education: form.education.length ? form.education : [newEducation()],
  skills: form.skills.length ? form.skills : [newSkill()],
});
const replaceAt = <T,>(list: T[], index: number, patch: Partial<T>) => list.map((item, at) => at === index ? { ...item, ...patch } : item);
const without = <T,>(list: T[], index: number) => list.filter((_, at) => at !== index);
const moved = <T,>(list: T[], index: number, by: number) => {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};

/** A résumé to read and change, section by section (the Resume Tailor App's
 * editor): contact, summary, roles (most recent first), schools, skills and
 * certifications. Dates are tidied ("2021-05" becomes "May 2021"), and what
 * must be fixed is said before it is kept. */
export function ResumeEditor({ initial, title, banner, saveLabel, note, onSave, onBack }: {
  initial: Profile; title: string; banner?: ReactNode; saveLabel: string; note: string;
  onSave: (profile: Profile) => Promise<string[] | null>; onBack: () => void;
}) {
  const [form, setForm] = useState<FormModel>(() => withStarterRows(toForm(initial)));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const info = (patch: Partial<Profile["info"]>) => setForm(current => ({ ...current, info: { ...current.info, ...patch } }));
  const roles = (next: (list: ExperienceForm[]) => ExperienceForm[]) => setForm(current => ({ ...current, experience: next(current.experience) }));
  const schools = (next: (list: Education[]) => Education[]) => setForm(current => ({ ...current, education: next(current.education) }));
  const skills = (next: (list: SkillForm[]) => SkillForm[]) => setForm(current => ({ ...current, skills: next(current.skills) }));
  const certifications = (next: (list: Certification[]) => Certification[]) => setForm(current => ({ ...current, certifications: next(current.certifications) }));

  const save = async () => {
    const profile = tidyProfile(fromForm(form));
    const problems = validateProfile(profile);
    if (problems.length) { setErrors(problems); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setErrors([]);
    setBusy(true);
    const failed = await onSave(profile);
    setBusy(false);
    if (failed?.length) { setErrors(failed); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  return <div className="resume-editor">
    <section className="jobs-card">
      <div className="jobs-card-head">
        <div className="jobs-day-nav">
          <button type="button" className="chat-icon" aria-label="Back" onClick={onBack}><ArrowLeft /></button>
          <h2 className="jobs-card-title">{title}</h2>
        </div>
      </div>
      {banner}
      {errors.length > 0 && <div className="resume-report"><div data-tone="error" role="alert"><strong>Please fix these first:</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div></div>}
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Contact</h3>
      <div className="jobs-form-pair">
        <Field label="Full name" value={form.info.name} set={value => info({ name: value })} />
        <Field label="Headline" value={form.info.title} set={value => info({ title: value })} placeholder="Senior Software Engineer" />
        <Field label="Location" value={form.info.location} set={value => info({ location: value })} placeholder="City, ST" />
        <Field label="Email" value={form.info.email} set={value => info({ email: value })} type="email" />
        <Field label="Phone" value={form.info.phone} set={value => info({ phone: value })} />
        <Field label="LinkedIn" value={form.info.linkedin} set={value => info({ linkedin: value })} placeholder="linkedin.com/in/your-name" />
      </div>
      <p className="jobs-form-hint">Your email and phone are never in the text you copy for a chat. The LinkedIn link is printed on the résumé.</p>
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Summary</h3>
      <label className="chat-field"><span>A few sentences at the top (optional)</span>
        <textarea rows={5} value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} />
      </label>
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Experience</h3>
      <p className="jobs-form-hint">Most recent first. Dates like &quot;May 2021&quot; or &quot;2021&quot;; &quot;Present&quot; for the job you have now.</p>
      {form.experience.map((role, index) => <div className="resume-item" key={index}>
        <Head label={`Role ${index + 1}`} onUp={() => roles(list => moved(list, index, -1))} onDown={() => roles(list => moved(list, index, 1))} onRemove={() => roles(list => without(list, index))} />
        <div className="jobs-form-pair">
          <Field label="Job title" value={role.title} set={value => roles(list => replaceAt(list, index, { title: value }))} />
          <Field label="Company" value={role.company} set={value => roles(list => replaceAt(list, index, { company: value }))} />
          <Field label="Location" value={role.location} set={value => roles(list => replaceAt(list, index, { location: value }))} />
          <div className="jobs-form-pair">
            <Field label="Start" value={role.startDate} set={value => roles(list => replaceAt(list, index, { startDate: value }))} placeholder="May 2021" />
            <Field label="End" value={role.endDate} set={value => roles(list => replaceAt(list, index, { endDate: value }))} placeholder="Present" />
          </div>
        </div>
        <label className="chat-field"><span>What you did: one point a line</span>
          <textarea rows={6} value={role.bullets} onChange={event => roles(list => replaceAt(list, index, { bullets: event.target.value }))} />
        </label>
      </div>)}
      <button type="button" className="chat-pill" onClick={() => roles(list => [...list, newExperience()])}><Plus /> Add a role</button>
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Education</h3>
      <p className="jobs-form-hint">Years, like &quot;2014&quot; and &quot;2018&quot;.</p>
      {form.education.map((school, index) => <div className="resume-item" key={index}>
        <Head label={`School ${index + 1}`} onUp={() => schools(list => moved(list, index, -1))} onDown={() => schools(list => moved(list, index, 1))} onRemove={() => schools(list => without(list, index))} />
        <div className="jobs-form-pair">
          <Field label="Degree" value={school.degree} set={value => schools(list => replaceAt(list, index, { degree: value }))} placeholder="Bachelor's Degree" />
          <Field label="Major" value={school.major} set={value => schools(list => replaceAt(list, index, { major: value }))} placeholder="Computer Science" />
          <Field label="School" value={school.school} set={value => schools(list => replaceAt(list, index, { school: value }))} />
          <div className="jobs-form-pair">
            <Field label="Start year" value={school.startDate} set={value => schools(list => replaceAt(list, index, { startDate: value }))} placeholder="2014" />
            <Field label="End year" value={school.endDate} set={value => schools(list => replaceAt(list, index, { endDate: value }))} placeholder="2018" />
          </div>
        </div>
      </div>)}
      <button type="button" className="chat-pill" onClick={() => schools(list => [...list, newEducation()])}><Plus /> Add a school</button>
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Skills</h3>
      {form.skills.map((group, index) => <div className="resume-item" key={index}>
        <Head label={`Group ${index + 1}`} onUp={() => skills(list => moved(list, index, -1))} onDown={() => skills(list => moved(list, index, 1))} onRemove={() => skills(list => without(list, index))} />
        <div className="jobs-form-pair">
          <Field label="Group" value={group.category} set={value => skills(list => replaceAt(list, index, { category: value }))} placeholder="Programming Languages" />
          <Field label="Skills, with commas" value={group.skills} set={value => skills(list => replaceAt(list, index, { skills: value }))} placeholder="Python, Go, TypeScript" />
        </div>
      </div>)}
      <button type="button" className="chat-pill" onClick={() => skills(list => [...list, newSkill()])}><Plus /> Add a group</button>
    </section>

    <section className="jobs-card resume-section">
      <h3 className="resume-section-title">Certifications</h3>
      <p className="jobs-form-hint">Only ones you hold; the year you got it.</p>
      {form.certifications.map((cert, index) => <div className="resume-item" key={index}>
        <Head label={`Certification ${index + 1}`} onUp={() => certifications(list => moved(list, index, -1))} onDown={() => certifications(list => moved(list, index, 1))} onRemove={() => certifications(list => without(list, index))} />
        <div className="jobs-form-pair">
          <Field label="Name" value={cert.name} set={value => certifications(list => replaceAt(list, index, { name: value }))} />
          <div className="jobs-form-pair">
            <Field label="Issuer" value={cert.issuer} set={value => certifications(list => replaceAt(list, index, { issuer: value }))} />
            <Field label="Year" value={cert.date} set={value => certifications(list => replaceAt(list, index, { date: value }))} placeholder="2023" />
          </div>
        </div>
      </div>)}
      <button type="button" className="chat-pill" onClick={() => certifications(list => [...list, newCertification()])}><Plus /> Add a certification</button>
    </section>

    <div className="resume-save">
      <p className="jobs-hint">{note}</p>
      <button type="button" className="chat-pill" onClick={onBack} disabled={busy}>Cancel</button>
      <button type="button" className="jobs-button" data-primary="" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
    </div>
  </div>;
}

function Field({ label, value, set, placeholder, type = "text" }: { label: string; value: string; set: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="chat-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={event => set(event.target.value)} /></label>;
}

function Head({ label, onUp, onDown, onRemove }: { label: string; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return <div className="resume-item-head">
    <strong>{label}</strong>
    <span>
      <button type="button" className="chat-icon resume-up" aria-label={`Move ${label} up`} title="Move up" onClick={onUp}><ChevronDown /></button>
      <button type="button" className="chat-icon" aria-label={`Move ${label} down`} title="Move down" onClick={onDown}><ChevronDown /></button>
      <button type="button" className="chat-icon" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}><Close /></button>
    </span>
  </div>;
}
