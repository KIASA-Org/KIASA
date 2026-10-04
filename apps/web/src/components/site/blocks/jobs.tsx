"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { JobsBlock } from "@/content/blocks";
import { CtaContent } from "../cta";
import { Plus, Search } from "../icons";
import { Section, SectionHead, longDate } from "./shared";

const ALL = "All";

/** Open roles, searchable by words and narrowed by area and studio. Every role opens in place. */
export function Jobs({ block }: { block: JobsBlock }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const areas = useMemo(() => [ALL, ...new Set(block.jobs.map(job => job.area))].sort((a, b) => (a === ALL ? -1 : b === ALL ? 1 : a.localeCompare(b))), [block.jobs]);
  const locations = useMemo(() => [ALL, ...new Set(block.jobs.map(job => job.location))].sort((a, b) => (a === ALL ? -1 : b === ALL ? 1 : a.localeCompare(b))), [block.jobs]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = block.jobs
    .filter(job => (area === ALL || job.area === area) && (location === ALL || job.location === location))
    .filter(job => words.every(word => `${job.title} ${job.area} ${job.location} ${job.kind} ${job.summary}`.toLowerCase().includes(word)))
    .sort((first, second) => second.posted.localeCompare(first.posted));

  return <Section type="jobs" tone={block.tone} id={block.id}>
    <SectionHead heading={block.heading} intro={block.intro} />
    <form className="b-jobs-filters" role="search" onSubmit={event => event.preventDefault()}>
      <label className="b-jobs-search">
        <Search />
        <span className="sr-only">Search roles</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by role, skill or studio" autoComplete="off" />
      </label>
      <label className="b-select">
        <span className="sr-only">Area</span>
        <select value={area} onChange={event => setArea(event.target.value)}>{areas.map(value => <option key={value} value={value}>{value === ALL ? "All areas" : value}</option>)}</select>
      </label>
      <label className="b-select">
        <span className="sr-only">Location</span>
        <select value={location} onChange={event => setLocation(event.target.value)}>{locations.map(value => <option key={value} value={value}>{value === ALL ? "All locations" : value}</option>)}</select>
      </label>
    </form>
    <p className="b-jobs-count" role="status">{shown.length === 1 ? "1 role" : `${shown.length} roles`}</p>
    <ul className="b-jobs">
      {shown.map((job, index) => <li key={job.title + job.location}>
        <details className="b-job">
          <summary className="b-job-head">
            <span className="b-job-title" id={`${id}-${index}`}>{job.title}</span>
            <span className="b-job-meta">{job.area}</span>
            <span className="b-job-meta">{job.location}</span>
            <span className="b-job-meta">{job.kind}</span>
            <span className="b-job-icon" aria-hidden="true"><Plus /></span>
          </summary>
          <div className="b-job-body">
            <p>{job.summary}</p>
            <p className="b-job-posted">Posted {longDate(job.posted)}</p>
            <Link href="/careers/hiring-journey" prefetch={false} className="cta" aria-describedby={`${id}-${index}`}><CtaContent>Apply</CtaContent></Link>
          </div>
        </details>
      </li>)}
    </ul>
    {shown.length === 0 && <p className="b-jobs-empty">No roles match yet. Try fewer words, or another studio.</p>}
  </Section>;
}
