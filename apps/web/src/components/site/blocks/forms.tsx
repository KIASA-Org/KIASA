"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { FormBlock } from "@/content/blocks";
import { ArrowRight } from "../icons";
import { Section, SectionHead } from "./shared";

/** Nothing is sent anywhere yet. Submitting says so plainly instead of pretending. */
function Sent({ children }: { children: ReactNode }) {
  return <div className="b-form-sent" role="status">
    <p className="b-form-sent-title">Thank you.</p>
    <p>{children}</p>
    <p className="b-form-sent-note">This is a sample site: the form is not connected yet, so nothing was sent or stored.</p>
  </div>;
}

function Submit({ children }: { children: ReactNode }) {
  return <button type="submit" className="b-submit"><span>{children}</span><span className="cta-chip" aria-hidden="true"><span className="cta-chip-track"><ArrowRight /><ArrowRight /></span></span></button>;
}

const TOPICS = ["Starting a project", "KIASA Canopy", "Technology due diligence", "Partnerships", "Press and media", "Something else"];

function ContactForm() {
  const [sent, setSent] = useState(false);
  if (sent) return <Sent>A partner reads every message and replies within two working days.</Sent>;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (event.currentTarget.reportValidity()) setSent(true); };
  return <form className="b-form" onSubmit={submit} noValidate={false}>
    <div className="b-form-row">
      <label className="b-field"><span>First name</span><input name="first" autoComplete="given-name" required /></label>
      <label className="b-field"><span>Last name</span><input name="last" autoComplete="family-name" required /></label>
    </div>
    <div className="b-form-row">
      <label className="b-field"><span>Work email</span><input name="email" type="email" autoComplete="email" required /></label>
      <label className="b-field"><span>Organization</span><input name="organization" autoComplete="organization" /></label>
    </div>
    <label className="b-field"><span>What is it about?</span>
      <select name="topic" defaultValue={TOPICS[0]}>{TOPICS.map(topic => <option key={topic}>{topic}</option>)}</select>
    </label>
    <label className="b-field"><span>Tell us what you are working on</span><textarea name="message" rows={6} required /></label>
    <label className="b-check"><input type="checkbox" name="consent" required /><span>I agree that KIASA may use these details to reply to me, as the privacy statement describes.</span></label>
    <Submit>Send</Submit>
  </form>;
}

const SUBJECTS = ["Research and reports", "Perspectives from our people", "News from KIASA", "Events and webinars", "Careers and open roles"];

function PreferencesForm() {
  const [sent, setSent] = useState(false);
  if (sent) return <Sent>Your choices are saved. You can change them here at any time.</Sent>;
  return <form className="b-form" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) setSent(true); }}>
    <label className="b-field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
    <fieldset className="b-fieldset">
      <legend>What would you like to hear about?</legend>
      {SUBJECTS.map((subject, index) => <label key={subject} className="b-check"><input type="checkbox" name="subjects" value={subject} defaultChecked={index < 2} /><span>{subject}</span></label>)}
    </fieldset>
    <fieldset className="b-fieldset">
      <legend>How often?</legend>
      {["As things are published", "A monthly digest", "Only the annual research"].map((often, index) => <label key={often} className="b-check" data-kind="radio"><input type="radio" name="often" value={often} defaultChecked={index === 1} /><span>{often}</span></label>)}
    </fieldset>
    <Submit>Save my choices</Submit>
  </form>;
}

const COOKIES = [
  { name: "Strictly necessary", text: "Keep the site working: security, and remembering the choices on this page. Always on.", locked: true },
  { name: "Performance", text: "Count visits and see which pages are read, so we can improve them. No advertising.", locked: false },
  { name: "Functional", text: "Remember preferences such as your region between visits.", locked: false },
  { name: "Marketing", text: "Measure our campaigns on other sites. Off unless you turn it on.", locked: false },
];

function CookieForm() {
  const [sent, setSent] = useState(false);
  if (sent) return <Sent>Your cookie settings are saved for this browser.</Sent>;
  return <form className="b-form b-cookies" onSubmit={event => { event.preventDefault(); setSent(true); }}>
    {COOKIES.map((cookie, index) => <label key={cookie.name} className="b-toggle">
      <span className="b-toggle-text"><span className="b-toggle-name">{cookie.name}</span><span>{cookie.text}</span></span>
      <input type="checkbox" role="switch" name={cookie.name} defaultChecked={cookie.locked || index === 1} disabled={cookie.locked} />
      <span className="b-toggle-switch" aria-hidden="true" />
    </label>)}
    <Submit>Save settings</Submit>
  </form>;
}

export function FormSection({ block }: { block: FormBlock }) {
  return <Section type="form" tone={block.tone} id={block.id}>
    <div className="b-form-layout">
      <SectionHead heading={block.heading} intro={block.intro} />
      {block.kind === "contact" ? <ContactForm /> : block.kind === "preferences" ? <PreferencesForm /> : <CookieForm />}
    </div>
  </Section>;
}
