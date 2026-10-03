import { formatDay } from "@/content/pages";
import { news } from "@/content/site";
import { NewsRail } from "./news-rail";

/** The latest announcements, as a row of large headlines that moves along on its own. */
export function News() {
  return <section className="news" aria-labelledby="news-title">
    <div className="wrap"><h2 id="news-title" className="heading reveal">{news.heading}</h2></div>
    <NewsRail items={news.items.map(item => ({ ...item, day: formatDay(item.date) }))} />
  </section>;
}
