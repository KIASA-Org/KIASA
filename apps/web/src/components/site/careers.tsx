import Image from "next/image";
import Link from "next/link";
import studio from "@/assets/media/studio.jpg";
import { careers } from "@/content/site";
import { CtaContent } from "./cta";

/** An invitation to join: a photograph that runs to the edge of the window, and a few words beside it. */
export function Careers() {
  return <section className="careers" aria-labelledby="careers-title">
    <div className="careers-media reveal">
      <Image src={studio} alt={careers.imageAlt} fill sizes="(max-width: 899px) 100vw, 50vw" placeholder="blur" />
    </div>
    <div className="careers-text">
      <p className="eyebrow reveal">{careers.eyebrow}</p>
      <h2 id="careers-title" className="careers-title reveal">{careers.heading}</h2>
      <p className="careers-body reveal">{careers.body}</p>
      <Link href={careers.cta.href} prefetch={false} className="cta reveal"><CtaContent>{careers.cta.label}</CtaContent></Link>
    </div>
  </section>;
}
