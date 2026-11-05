/** The words of a live script on a page. The model gives them in small bursts:
 * they appear one at a time, quickly, and go straight into the page (not through
 * React), as they arrive many times a second. */
export class Words {
  target = "";
  private shown = "";
  private timer = 0;
  private box: HTMLElement | null = null;
  private following = true;
  private resized: ResizeObserver | null = null;
  private onBehind: (behind: boolean) => void = () => {};
  /** Only the member scrolling away stops it following: not the words wrapping differently when
   * the window changes size, which leaves the box somewhere in the middle of the script. */
  private scrolled = () => {
    const box = this.box;
    if (!box) return;
    const following = box.scrollTop + box.clientHeight >= box.scrollHeight - 48;
    if (following !== this.following) this.onBehind(!following);
    this.following = following;
  };
  // Re-attaching (the member came back to the Interview page) shows all of it at once.
  attach(box: HTMLElement | null, onBehind: (behind: boolean) => void = () => {}) {
    this.box?.removeEventListener("scroll", this.scrolled);
    this.resized?.disconnect();
    this.resized = null;
    this.box = box;
    if (!box) return;
    this.onBehind = onBehind;
    this.following = true;
    onBehind(false);
    box.addEventListener("scroll", this.scrolled, { passive: true });
    this.resized = new ResizeObserver(() => { if (this.following) box.scrollTop = box.scrollHeight; });
    this.resized.observe(box);
    this.shown = "";
    this.draw(this.target);
  }
  stop() { window.clearTimeout(this.timer); this.timer = 0; }
  set(text: string) {
    this.target = text;
    if (!text) this.draw("");
    if (!this.timer) this.step();
  }
  private draw(text: string) {
    const box = this.box;
    this.shown = text;
    if (!box) return;
    box.textContent = text;
    if (this.following) box.scrollTop = box.scrollHeight;
  }
  private step() {
    this.timer = 0;
    if (this.shown === this.target) return;
    let now = this.shown;
    if (!this.target.startsWith(now)) now = this.target.split(" ").slice(0, now.split(" ").length).join(" "); // A word already shown was corrected.
    const rest = this.target.slice(now.length);
    const waiting = rest.trim().split(" ").length;
    // Far behind (opened mid-way), or in a hidden tab, whose timers a browser slows: all at once.
    if (waiting > 12 || document.hidden) now = this.target;
    else if (rest) {
      const lead = rest.length - rest.trimStart().length;
      const end = rest.indexOf(" ", lead);
      now += end === -1 ? rest : rest.slice(0, end);
    }
    this.draw(now);
    // Quick enough to feel live: a word every 18–45 ms, faster the further behind it is.
    if (now !== this.target) this.timer = window.setTimeout(() => this.step(), Math.max(18, Math.min(45, 160 / waiting)));
  }
}

/** The private channel a member's live script goes over. */
export const scriptTopic = (member: string) => `live-script:${member}`;

