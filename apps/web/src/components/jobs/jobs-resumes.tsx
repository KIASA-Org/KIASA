"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobsMe, Resume, ResumeStats } from "@/lib/jobs/types";
import { Confirm } from "../chat/chat-dialog";
import { FormDialog } from "./jobs-dialogs";
import { BaseResume } from "./jobs-resume-base";
import { partsIn, shortDay } from "./jobs-format";

const KINDS: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const LIMIT = 10 * 1024 * 1024;
const size = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

/** A member's résumés: each version under a title (one is the default, chosen
 * first when applying), how each has done, and the file a click away. Only
 * they and admins can open them. */
export function Resumes({ me, supabase, resumes, zone, today, version, onChanged }: {
  me: JobsMe; supabase: SupabaseClient; resumes: Resume[]; zone: string; today: string; version: number; onChanged: () => void;
}) {
  const [stats, setStats] = useState<ResumeStats[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<Resume | null>(null);
  const [removing, setRemoving] = useState<Resume | null>(null);
  // While the base résumé (or one made for a job) is open in the editor, it has the page.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let stopped = false;
    void supabase.rpc("resume_stats").then(({ data }) => { if (!stopped) setStats((data ?? []) as ResumeStats[]); });
    return () => { stopped = true; };
  }, [supabase, version, resumes.length]);

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const title = String(data.get("title") ?? "").trim();
    setError("");
    if (!(file instanceof File) || !file.size) return setError("Choose the file first.");
    const ending = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = KINDS[ending];
    if (!mime) return setError("A résumé is kept as a PDF or a Word file (.pdf, .doc, .docx).");
    if (file.size > LIMIT) return setError("Résumés can be up to 10 MB.");
    setBusy(true);
    const path = `${me.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || `resume.${ending}`}`;
    const stored = await supabase.storage.from("resumes").upload(path, file, { contentType: mime, upsert: false });
    if (stored.error) { setBusy(false); return setError("The file could not be uploaded. Please try again."); }
    const { data: made, error: failed } = await supabase.from("resumes")
      .insert({ user_id: me.id, title: title || file.name.replace(/\.[^.]+$/, "").slice(0, 80), path, file_name: file.name.slice(0, 200), mime, size: file.size })
      .select("id").single();
    if (failed || !made) {
      await supabase.storage.from("resumes").remove([path]);
      setBusy(false);
      return setError("The résumé could not be kept. Please try again.");
    }
    if (!resumes.some(entry => entry.is_default)) await supabase.rpc("set_default_resume", { resume: made.id });
    setBusy(false);
    form.reset();
    onChanged();
  };
  const open = async (resume: Resume) => {
    const { data } = await supabase.storage.from("resumes").createSignedUrl(resume.path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };
  const makeDefault = async (resume: Resume) => {
    const { error: failed } = await supabase.rpc("set_default_resume", { resume: resume.id });
    if (failed) setError("That did not work. Please try again.");
    onChanged();
  };

  return <div className="jobs-view">
    {me.member && <BaseResume me={me} supabase={supabase} zone={zone} today={today} onEditing={setEditing} />}
    {!editing && <>
    <section className="jobs-card" aria-labelledby="jobs-resumes-title">
      <h2 id="jobs-resumes-title" className="jobs-card-title">Your résumés</h2>
      <p className="jobs-card-sub">Keep a version for each kind of role. The one chosen above the day&apos;s list goes with each application, so you can see which one gets interviews.</p>
      <ul className="jobs-ledger">
        {resumes.map(resume => {
          const done = stats.find(row => row.resume_id === resume.id);
          const applied = Number(done?.applications ?? 0), interviews = Number(done?.interviews ?? 0);
          return <li key={resume.id}>
            <div className="jobs-ledger-main">
              <p className="jobs-ledger-title">{resume.title}{resume.is_default && <span className="jobs-you">Default</span>}</p>
              <p className="jobs-row-meta">
                <span>{resume.file_name}</span><span>{size(resume.size)}</span><span>Added {shortDay(partsIn(zone, resume.created_at).day)}</span>
              </p>
              <p className="jobs-row-meta">
                <span>{applied === 1 ? "1 application" : `${applied} applications`}</span>
                <span>{interviews === 1 ? "1 interview" : `${interviews} interviews`}</span>
                <span>{Number(done?.offers ?? 0)} offers</span>
                {applied > 0 && <span>{Math.round((interviews / applied) * 100)}% got an interview</span>}
              </p>
            </div>
            <div className="jobs-row-actions">
              <button type="button" className="chat-pill" onClick={() => void open(resume)}>Open</button>
              {!resume.is_default && <button type="button" className="chat-pill" onClick={() => void makeDefault(resume)}>Make default</button>}
              <button type="button" className="chat-pill" onClick={() => setRenaming(resume)}>Rename</button>
              <button type="button" className="chat-pill" data-danger="" onClick={() => setRemoving(resume)}>Remove</button>
            </div>
          </li>;
        })}
      </ul>
      {!resumes.length && <p className="jobs-empty-line">No résumé yet. Add one below; it goes with your applications.</p>}
    </section>
    <section className="jobs-card" aria-labelledby="jobs-resume-add">
      <h2 id="jobs-resume-add" className="jobs-card-title">Add a résumé</h2>
      <form className="jobs-resume-form" onSubmit={upload}>
        <label className="chat-field"><span>Title</span><input name="title" maxLength={80} placeholder="For example: Frontend, Full-stack, Data" /></label>
        <label className="chat-field"><span>File (PDF or Word, up to 10 MB)</span><input name="file" type="file" accept=".pdf,.doc,.docx" required /></label>
        <div className="jobs-save-row">
          <p className="jobs-hint" role="status">{error}</p>
          <button type="submit" className="jobs-button" data-primary="" disabled={busy}>{busy ? "Uploading…" : "Add résumé"}</button>
        </div>
      </form>
    </section>
    </>}
    {renaming && <FormDialog title="Rename this résumé" action="Save" onClose={() => setRenaming(null)} onSubmit={async form => {
      const title = String(form.get("title") ?? "").trim();
      if (!title) return "Give it a title.";
      const { error: failed } = await supabase.from("resumes").update({ title }).eq("id", renaming.id);
      if (failed) return "That did not save. Please try again.";
      onChanged();
      return null;
    }}>
      <label className="chat-field"><span>Title</span><input name="title" defaultValue={renaming.title} maxLength={80} required /></label>
    </FormDialog>}
    {removing && <Confirm title="Remove this résumé?" confirm="Remove"
      text={<>“{removing.title}” and its file go. Applications made with it stay, without it.</>}
      onClose={() => setRemoving(null)} onConfirm={async () => {
        const { error: failed } = await supabase.from("resumes").delete().eq("id", removing.id);
        if (failed) return "That did not work. Please try again.";
        await supabase.storage.from("resumes").remove([removing.path]);
        onChanged();
        return null;
      }} />}
  </div>;
}
