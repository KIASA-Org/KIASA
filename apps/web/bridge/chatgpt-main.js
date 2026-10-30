// KIASA ChatGPT Bridge, inside ChatGPT's own page (its "main world"): when the
// bridge presses ChatGPT's "Copy response" under an answer, the text ChatGPT
// copies (the whole answer, as written) is handed to the bridge instead of the
// clipboard, so the member's clipboard stays as it was. Any other copy is left
// alone. (ChatGPT's page may show a long answer only in part; its copy is whole.)
(() => {
  const clip = navigator.clipboard;
  if (!clip) return;
  // The bridge marks the page just before it presses Copy (a mark both sides
  // see at once: a message would arrive after the click).
  const MARK = "data-kiasa-capture";
  const ours = () => {
    const at = Number(document.documentElement.getAttribute(MARK) || 0);
    return at > 0 && Date.now() - at < 5000;
  };
  const hand = text => {
    document.documentElement.removeAttribute(MARK);
    window.postMessage({ source: "kiasa-bridge-copied", text: String(text ?? "") }, window.location.origin);
  };
  const writeText = clip.writeText?.bind(clip);
  const write = clip.write?.bind(clip);
  if (writeText) clip.writeText = text => {
    if (!ours()) return writeText(text);
    hand(text);
    return Promise.resolve();
  };
  if (write) clip.write = async items => {
    if (!ours()) return write(items);
    for (const item of items ?? []) {
      if (item.types?.includes("text/plain")) return hand(await (await item.getType("text/plain")).text());
    }
    return write(items);
  };
})();
