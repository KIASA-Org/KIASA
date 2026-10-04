import Image, { type StaticImageData } from "next/image";
import blueLeaf from "@/assets/media/blue-leaf.jpg";
import forestRoad from "@/assets/media/forest-road.jpg";
import leafTip from "@/assets/media/leaf-tip.jpg";
import { stories, type StoryArt } from "@/content/site";
import { Plate, PlateDefs, isPlate } from "./plates";
import { StoryGrid } from "./story-grid";

const PHOTOS: Partial<Record<StoryArt, StaticImageData>> = { "blue-leaf": blueLeaf, "forest-road": forestRoad, "leaf-tip": leafTip };

/** A card's picture: a line drawing or a photograph. */
export function Art({ art }: { art: StoryArt }) {
  if (isPlate(art)) return <Plate name={art} />;
  const photo = PHOTOS[art];
  if (!photo) return null;
  return <Image src={photo} alt="" fill placeholder="blur" sizes="(max-width: 1099px) 300px, (max-width: 1919px) 20vw, 380px" />;
}

/** The eight cards under the hero: what KIASA has announced, published and delivered. */
export function Featured() {
  return <section className="featured wrap wrap-wide" aria-labelledby="featured-title">
    <h2 id="featured-title" className="sr-only">Featured</h2>
    <PlateDefs />
    <StoryGrid items={stories.map(story => ({ story, art: <Art art={story.art} /> }))} />
  </section>;
}
