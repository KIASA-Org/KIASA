import Link from "next/link";
import { recognition } from "@/content/site";
import { ChevronRight } from "./icons";

/** Fine lines behind each card's title, built from the leaf's own shapes: veins, drops, rings. */
const PATTERNS = [
  <>
    <path d="M-20 380Q150 250 560 232M-20 380Q170 190 560 96M-20 380Q120 120 420-20M-20 380Q40 150 200-20" />
    <circle cx="352" cy="118" r="54" /><path d="M322 96a37 37 0 0 1 22-14" />
    <path d="M-10 70H560" />
  </>,
  <>
    <circle cx="430" cy="40" r="96" /><circle cx="430" cy="40" r="176" /><circle cx="430" cy="40" r="262" />
    <path d="M-10 250L560 136M150-10V360" />
    <circle cx="150" cy="218" r="30" /><path d="M133 206a21 21 0 0 1 13-8" />
  </>,
  <>
    <path d="M96-10V360M212-10V360M430-10V360" />
    <circle cx="322" cy="150" r="132" /><path d="M250 92a92 92 0 0 1 48-34" />
    <path d="M-10 286C120 250 180 330 300 300S470 232 560 262" />
  </>,
];

/** Three statements of standing. On a wide screen the heading holds the middle of
 * the window while the cards travel up across it; that is done with sticky
 * positioning alone, so nothing here listens to scrolling. */
export function Recognition() {
  return <section className="recog" aria-labelledby="recog-title">
    <h2 id="recog-title" className="recog-title">{recognition.heading}</h2>
    <ul className="recog-cards wrap">
      {recognition.items.map((item, index) => <li key={item.title} className="recog-card" data-tone={item.tone}>
        <svg className="recog-pattern" viewBox="0 0 520 344" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true" focusable="false">{PATTERNS[index]}</svg>
        <div className="recog-text">
          <h3 className="recog-name">{item.title}</h3>
          <div className="recog-more"><div>
            <p>{item.body}</p>
            <Link href={item.cta.href} prefetch={false} className="more">{item.cta.label}<ChevronRight /></Link>
          </div></div>
        </div>
      </li>)}
    </ul>
  </section>;
}
