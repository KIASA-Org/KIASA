import Image from "next/image";
import Link from "next/link";
import riverRoad from "@/assets/media/river-road.jpg";
import { spotlight } from "@/content/site";
import { ChevronRight, Play } from "./icons";

/** Client work: a film on the left, four stories to read on the right. */
export function Spotlight() {
  const { film } = spotlight;
  return <section className="spotlight wrap" aria-labelledby="spotlight-title">
    <h2 id="spotlight-title" className="heading reveal">{spotlight.heading}</h2>
    <div className="spotlight-grid">
      <article className="film reveal">
        <Link href={film.cta.href} prefetch={false} className="film-frame" aria-label={`Watch ${film.episode}, ${film.caption} (${film.duration})`}>
          <Image src={riverRoad} alt="" fill sizes="(max-width: 899px) 100vw, 58vw" placeholder="blur" />
          <span className="film-play"><Play /></span>
          <span className="film-caption">
            <span className="film-episode">{film.episode}</span>
            <span className="film-name">{film.caption}</span>
          </span>
          <span className="film-time">{film.duration}</span>
        </Link>
        <h3 className="film-title">{film.title}</h3>
        <p className="film-text">{film.description}</p>
        <Link href={film.cta.href} prefetch={false} className="textlink">{film.cta.label}</Link>
      </article>
      <ul className="spotlight-list">
        {spotlight.stories.map(story => <li key={story.href} className="reveal">
          <Link href={story.href} prefetch={false} className="spotlight-item">
            <span className="spotlight-item-title">{story.title}</span>
            <span className="more">Explore<ChevronRight /></span>
          </Link>
        </li>)}
      </ul>
    </div>
  </section>;
}
