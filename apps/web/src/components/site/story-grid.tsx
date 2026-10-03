"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Story } from "@/content/site";
import { CtaContent } from "./cta";
import { Close, Plus } from "./icons";

export type StoryItem = { story: Story; art: ReactNode; detailArt: ReactNode };

/** The grid of cards. A card opens in place of a page change: its summary and a
 * link to the full piece appear in a dialog, as the cards on the model site expand. */
export function StoryGrid({ items }: { items: StoryItem[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState<StoryItem | null>(null);

  const open = (item: StoryItem) => {
    // Render the card's details before the dialog opens, so focus lands inside it.
    flushSync(() => setActive(item));
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  // The dialog element itself is only visible as the backdrop around the sheet.
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget) close(); };

  return <>
    <ul className="story-grid">
      {items.map(item => <li key={item.story.id}>
        <article className="story" data-surface={item.story.surface}>
          <div className="story-art">{item.art}</div>
          <div className="story-text">
            <p className="eyebrow">{item.story.kind}</p>
            <h3 className="story-title">{item.story.title}</h3>
          </div>
          <button type="button" className="story-open" aria-haspopup="dialog" aria-label={`Expand: ${item.story.title}`} onClick={() => open(item)}>
            <span className="story-plus"><Plus /></span>
          </button>
        </article>
      </li>)}
    </ul>

    <dialog ref={dialog} className="story-dialog" aria-labelledby="story-dialog-title" onClick={onBackdrop}>
      {active && <div className="story-sheet" data-surface={active.story.surface}>
        <div className="story-sheet-art">{active.detailArt}</div>
        <div className="story-sheet-text">
          <p className="eyebrow">{active.story.kind}</p>
          <h2 id="story-dialog-title" className="story-sheet-title">{active.story.title}</h2>
          <p className="story-sheet-summary">{active.story.summary}</p>
          <p className="story-sheet-detail">{active.story.detail}</p>
          <Link href={active.story.href} prefetch={false} className="cta" onClick={close}><CtaContent>{active.story.cta}</CtaContent></Link>
        </div>
        <button type="button" className="story-sheet-close" aria-label="Close" onClick={close}><Close /></button>
      </div>}
    </dialog>
  </>;
}
