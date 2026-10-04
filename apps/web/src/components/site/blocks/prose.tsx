import type { ProseBlock, ProseItem } from "@/content/blocks";
import { photos } from "@/content/photos";
import { Photo, Section } from "./shared";

function Item({ item }: { item: ProseItem }) {
  if ("p" in item) return <p>{item.p}</p>;
  if ("h" in item) return <h2 className="b-prose-heading">{item.h}</h2>;
  if ("list" in item) return <ul className="b-prose-list">{item.list.map(entry => <li key={entry}>{entry}</li>)}</ul>;
  if ("quote" in item) return <blockquote className="b-prose-quote"><p>“{item.quote}”</p>{item.by && <footer>{item.by}</footer>}</blockquote>;
  if ("figure" in item) return <figure className="b-prose-figure">
    <div className="b-prose-image"><Photo photo={item.figure} sizes="(max-width: 899px) 92vw, 760px" /></div>
    <figcaption>{item.caption ?? photos[item.figure].alt}</figcaption>
  </figure>;
  return <p className="b-prose-stat"><span className="b-prose-stat-value">{item.stat}</span><span className="b-prose-stat-label">{item.label}</span></p>;
}

/** Running text in a reading column, with an optional summary kept in view beside it. */
export function Prose({ block }: { block: ProseBlock }) {
  return <Section type="prose" tone={block.tone} id={block.id}>
    <div className="b-prose" data-aside={block.aside ? "" : undefined}>
      {block.aside && <aside className="b-prose-aside" aria-label={block.aside.heading}>
        <h2 className="eyebrow">{block.aside.heading}</h2>
        <ul>{block.aside.points.map(point => <li key={point}>{point}</li>)}</ul>
      </aside>}
      <div className="b-prose-body">
        {block.items.map((item, index) => <Item key={index} item={item} />)}
      </div>
    </div>
  </Section>;
}
