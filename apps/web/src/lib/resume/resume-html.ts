import type { Profile } from "./schema";

/**
 * The résumé template: a professional one-column layout that applicant tracking systems read cleanly.
 * Real text only, no tables, icons or columns; dates and locations are right-aligned on the same line.
 * Pure: profile in, HTML document out. The PDF footer (name and page numbers) is `renderResumeFooter`.
 */
export interface ResumeHtmlOptions {
  /** @font-face rules for the "Resume Sans" family (see resumeFonts.ts). Without them, system fonts are used. */
  fontCss?: string;
}

export function renderResumeHtml(p: Profile, opts: ResumeHtmlOptions = {}): string {
  const sections = [summary(p), skills(p), experience(p), education(p), certifications(p)].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(p.info.name || "Résumé")}</title>
<style>
${opts.fontCss ?? ""}
${CSS}
</style>
</head>
<body>
${header(p)}
${sections.join("\n")}
</body>
</html>
`;
}

/** Footer for Chrome's PDF printer: the name on the left, "Page X of Y" on the right. */
export function renderResumeFooter(p: Profile): string {
  return `<div style="width:100%;padding:0 0.6in;font:7.5pt Helvetica,Arial,sans-serif;color:#8a929d;display:flex;justify-content:space-between;">
<span>${esc(p.info.name)}</span>
<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
}

// ------------------------------------------------------------------ parts

function header(p: Profile): string {
  const items: string[] = [];
  const { location, email, phone, linkedin } = p.info;
  if (location.trim()) items.push(`<span>${esc(location.trim())}</span>`);
  if (email.trim()) items.push(`<a href="mailto:${esc(email.trim())}">${esc(email.trim())}</a>`);
  if (phone.trim()) items.push(`<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(phone.trim())}</a>`);
  if (linkedin.trim()) items.push(`<a href="${esc(linkedinHref(linkedin))}">${esc(displayLink(linkedin))}</a>`);

  return `<header class="hdr">
<h1 class="name">${esc(p.info.name)}</h1>
${p.info.title.trim() ? `<div class="headline">${esc(p.info.title.trim())}</div>` : ""}
${items.length ? `<div class="contact">${items.join(SEP)}</div>` : ""}
</header>`;
}

function summary(p: Profile): string {
  if (!p.summary.trim()) return "";
  return `<section><h2>Professional Summary</h2><p class="summary">${esc(p.summary.trim())}</p></section>`;
}

function skills(p: Profile): string {
  const groups = p.skills.filter((c) => c.skills.length);
  if (!groups.length) return "";
  const rows = groups
    .map((c) => `<p>${c.category.trim() ? `<span class="label">${esc(c.category.trim())}:</span> ` : ""}${esc(c.skills.join(", "))}</p>`)
    .join("");
  return `<section><h2>Skills</h2><div class="skills">${rows}</div></section>`;
}

function experience(p: Profile): string {
  if (!p.experience.length) return "";
  const roles = p.experience
    .map((e) => {
      const primary = e.title.trim() || e.company.trim();
      const org = e.title.trim() ? e.company.trim() : "";
      const sub =
        org || e.location.trim()
          ? `<div class="line sub"><span class="org">${esc(org)}</span><span class="loc">${esc(e.location.trim())}</span></div>`
          : "";
      const bullets = e.descriptionLines.length ? `<ul>${e.descriptionLines.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
      return `<article class="role"><div class="role-head"><div class="line"><span class="title">${esc(primary)}</span>${dates(
        e.startDate,
        e.endDate,
      )}</div>${sub}</div>${bullets}</article>`;
    })
    .join("");
  return `<section><h2>Professional Experience</h2>${roles}</section>`;
}

function education(p: Profile): string {
  if (!p.education.length) return "";
  const rows = p.education
    .map((e) => {
      const degree = [e.degree.trim(), e.major.trim()].filter(Boolean).join(", ");
      const parts = [degree && `<span class="strong">${esc(degree)}</span>`, e.school.trim() && `<span class="org">${esc(e.school.trim())}</span>`];
      return `<div class="entry line"><span>${parts.filter(Boolean).join(SEP)}</span>${dates(e.startDate, e.endDate)}</div>`;
    })
    .join("");
  return `<section><h2>Education</h2>${rows}</section>`;
}

function certifications(p: Profile): string {
  if (!p.certifications.length) return "";
  const rows = p.certifications
    .map((c) => {
      const parts = [c.name.trim() && `<span class="strong">${esc(c.name.trim())}</span>`, c.issuer.trim() && `<span class="org">${esc(c.issuer.trim())}</span>`];
      return `<div class="entry line"><span>${parts.filter(Boolean).join(SEP)}</span>${dates(c.date, "")}</div>`;
    })
    .join("");
  return `<section><h2>Certifications</h2>${rows}</section>`;
}

// ---------------------------------------------------------------- helpers

const SEP = `<span class="sep">|</span>`;

function dates(start: string, end: string): string {
  const text = [start.trim(), end.trim()].filter(Boolean).join(" – ");
  return text ? `<span class="dates">${esc(text)}</span>` : "";
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkedinHref(v: string): string {
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, "")}`;
}

/** "https://www.linkedin.com/in/x/" prints as "linkedin.com/in/x". */
function displayLink(v: string): string {
  return v.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

const CSS = `
:root {
  --ink: #1f2328;
  --navy: #1b2a41;
  --accent: #2f5d8a;
  --muted: #59606b;
  --rule: #c3ccd7;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: var(--ink);
  font: 10pt/1.32 "Resume Sans", "Source Sans 3", "Segoe UI", Calibri, Arial, sans-serif;
  font-kerning: normal;
}
a { color: inherit; text-decoration: none; }

.hdr { border-bottom: 2pt solid var(--navy); padding-bottom: 7pt; text-align: center; }
.name { margin: 0; font-size: 23pt; line-height: 1.1; font-weight: 700; color: var(--navy); letter-spacing: 0.2pt; }
.headline { margin-top: 3pt; font-size: 11.5pt; font-weight: 600; color: var(--accent); }
.contact { margin-top: 4pt; font-size: 9.5pt; color: var(--muted); }
.sep { margin: 0 6pt; color: var(--rule); }

h2 {
  margin: 13pt 0 6pt;
  padding-bottom: 2.5pt;
  border-bottom: 0.75pt solid var(--rule);
  font-size: 10.5pt;
  font-weight: 700;
  color: var(--navy);
  text-transform: uppercase;
  letter-spacing: 1.2pt;
  break-after: avoid;
}
.summary { margin: 0; }
.skills p { margin: 0 0 2.5pt; padding-left: 12pt; text-indent: -12pt; }
.label { font-weight: 700; color: var(--navy); }

.line { display: flex; justify-content: space-between; align-items: baseline; gap: 14pt; }
.role { margin-bottom: 9pt; }
.role:last-child { margin-bottom: 0; }
.role-head { break-inside: avoid; break-after: avoid; }
.title { font-size: 10.5pt; font-weight: 700; }
.sub { margin-top: 0.5pt; }
.org { font-weight: 600; color: var(--accent); }
.loc { font-size: 9.5pt; font-style: italic; color: var(--muted); white-space: nowrap; }
.dates { font-size: 9.5pt; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

ul { margin: 3pt 0 0; padding-left: 12pt; }
li { margin: 0 0 2pt; padding-left: 2pt; break-inside: avoid; }
li::marker { color: var(--accent); }

.entry { margin-bottom: 3pt; }
.strong { font-weight: 600; }
`;
