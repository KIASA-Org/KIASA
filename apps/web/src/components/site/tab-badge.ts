/** The unread count on the browser's tab, for a tab pinned small or one among
 * many: a red badge with the number on KIASA's leaf, and "(3)" before the
 * page's title. One count per page; 0 takes both away. */

const PLAIN = "data-plain-href";
const COUNTED = /^\(\d+\+?\) /;
let count = 0;
let watcher: MutationObserver | null = null;
let leaf: Promise<HTMLImageElement | null> | null = null;
const drawn = new Map<string, string>();

export function showTabBadge(next: number) {
  count = Math.max(0, Math.floor(next));
  apply();
  if (!watcher) {
    // Next.js puts a page's own title and icon back as pages change: the count goes back on them.
    watcher = new MutationObserver(apply);
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });
  }
}

function apply() {
  const plainTitle = document.title.replace(COUNTED, "");
  const title = count ? `(${count > 99 ? "99+" : count}) ${plainTitle}` : plainTitle;
  if (document.title !== title) document.title = title;

  const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  for (const icon of icons) if (!icon.hasAttribute(PLAIN)) icon.setAttribute(PLAIN, icon.getAttribute("href") ?? "");
  const label = count > 9 ? "9+" : String(count);
  const href = count ? drawn.get(label) : null;
  if (count && !href) {
    void badge(label, icons[0]?.getAttribute(PLAIN) || "/icon.png").then(url => {
      if (url) drawn.set(label, url);
      if (url && count) apply();
    });
    return;
  }
  for (const icon of icons) {
    const wanted = href ?? icon.getAttribute(PLAIN) ?? "";
    if (icon.getAttribute("href") !== wanted) icon.setAttribute("href", wanted);
  }
}

/** The leaf with the badge on it: red, the number in white, at the lower right,
 * as mail and chat apps show theirs. */
async function badge(label: string, source: string): Promise<string | null> {
  leaf ??= new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
  const image = await leaf;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (image) context.drawImage(image, 0, 0, 64, 64);
  // Big enough that the number still reads on a tab drawn 16 pixels wide.
  const width = label.length > 1 ? 54 : 42;
  context.beginPath();
  context.roundRect(64 - width, 22, width, 42, 21);
  context.fillStyle = "#e5383b";
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `800 ${label.length > 1 ? 30 : 36}px system-ui, "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 64 - width / 2, 44);
  return canvas.toDataURL("image/png");
}
