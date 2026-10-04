import Image from "next/image";
import portrait from "@/assets/media/portrait.jpg";
import { voice } from "@/content/site";

/** One sentence from the firm's leader, beside their portrait. */
export function Voice() {
  return <section className="voice wrap" aria-label={`A word from ${voice.name}`}>
    <figure className="voice-figure">
      <div className="voice-media reveal">
        <Image src={portrait} alt={voice.imageAlt} fill sizes="(max-width: 899px) 100vw, 42vw" placeholder="blur" />
      </div>
      <blockquote className="voice-quote reveal"><p>“{voice.quote}”</p></blockquote>
      <figcaption className="voice-by reveal">
        <span className="voice-name">{voice.name}</span>
        <span className="voice-role">{voice.role}</span>
      </figcaption>
    </figure>
  </section>;
}
