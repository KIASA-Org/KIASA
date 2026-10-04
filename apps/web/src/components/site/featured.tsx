import Image, { type StaticImageData } from "next/image";
import blueLeaf from "@/assets/media/blue-leaf.jpg";
import forestRoad from "@/assets/media/forest-road.jpg";
import leafTip from "@/assets/media/leaf-tip.jpg";
import { stories, type StoryArt } from "@/content/site";
import { Plate, PlateDefs, isPlate } from "./plates";
import { StoryGrid } from "./story-grid";

const PHOTOS: Partial<Record<StoryArt, StaticImageData>> = { "blue-leaf": blueLeaf, "forest-road": forestRoad, "leaf-tip": leafTip };

/** A card's picture: a line drawing or a photograph. `detail` asks for the larger photograph shown when a card is opened. */
function Art({ art, detail = false }: { art: StoryArt; detail?: boolean }) {
  if (isPlate(art)) return <Plate name={art} />;
  const photo = PHOTOS[art];
  if (!photo) return null;
  return <Image src={photo} alt="" fill placeholder="blur"
    sizes={detail ? "(max-width: 799px) 92vw, 480px" : "(max-width: 1099px) 300px, (max-width: 1919px) 20vw, 380px"} />;
}

/** The eight cards under the hero: what KIASA has announced, published and delivered. */
export function Featured() {
  return <section className="featured wrap" aria-labelledby="featured-title">
    <h2 id="featured-title" className="sr-only">Featured</h2>
    <PlateDefs />
    <StoryGrid items={stories.map(story => {
      const art = <Art art={story.art} />;
      // A drawing is the same at any size; a photograph is asked for again, larger.
      return { story, art, detailArt: isPlate(story.art) ? art : <Art art={story.art} detail /> };
    })} />
  </section>;
}
