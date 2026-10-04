import Link from "next/link";
import type { ReactNode } from "react";
import type { StorySurface } from "@/content/site";
import { ChevronRight } from "./icons";

/** What a card needs: what kind of piece it is, its title and summary, where it leads, and its picture. */
export type StoryCardData = { id: string; kind: string; title: string; summary: string; href: string; surface: StorySurface };
export type StoryItem = { story: StoryCardData; art: ReactNode };

/** One card. As on the model, the whole card is a link to its page. Pointed at
 * or focused, it grows a little, its picture gives way, and its summary and
 * "Expand" come up in its place. */
export function StoryCard({ story, art, headingLevel = 3 }: StoryItem & { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <Link href={story.href} prefetch={false} className="story" data-surface={story.surface}>
    <div className="story-art" aria-hidden="true">{art}</div>
    <div className="story-text">
      <p className="eyebrow">{story.kind}</p>
      <Heading className="story-title">{story.title}</Heading>
      <p className="story-summary">{story.summary}</p>
    </div>
    <span className="story-expand" aria-hidden="true">Expand <ChevronRight /></span>
  </Link>;
}

/** The grid of cards, four to a row. */
export function StoryGrid({ items }: { items: StoryItem[] }) {
  return <ul className="story-grid">
    {items.map(item => <li key={item.story.id}><StoryCard {...item} /></li>)}
  </ul>;
}
