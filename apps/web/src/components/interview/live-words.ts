/** The words of a live script on a page. The model gives them in small bursts:
 * they appear one at a time, quickly, and go straight into the page (not through
 * React), as they arrive many times a second. */
export class Words {
  target = "";
  private shown = "";
  private timer = 0;
  private box: HTMLElement | null = null;
  // Re-attaching (the member came back to the Interview page) shows all of it at once.
  attach(box: HTMLElement | null) { this.box = box; if (box) { this.shown = ""; this.draw(this.target); } }
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
    const follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 48;
    box.textContent = text;
    if (follow) box.scrollTop = box.scrollHeight;
  }
  private step() {
    this.timer = 0;
    if (this.shown === this.target) return;
    let now = this.shown;
    if (!this.target.startsWith(now)) now = this.target.split(" ").slice(0, now.split(" ").length).join(" "); // A word already shown was corrected.
    const rest = this.target.slice(now.length);
    const waiting = rest.trim().split(" ").length;
    // Far behind (opened mid-way), or in a hidden tab, whose timers a browser slows: all at once.
    if (waiting > 30 || document.hidden) now = this.target;
    else if (rest) {
      const lead = rest.length - rest.trimStart().length;
      const end = rest.indexOf(" ", lead);
      now += end === -1 ? rest : rest.slice(0, end);
    }
    this.draw(now);
    if (now !== this.target) this.timer = window.setTimeout(() => this.step(), Math.max(30, Math.min(100, 250 / waiting)));
  }
}

/** The private channel a member's live script goes over. */
export const scriptTopic = (member: string) => `live-script:${member}`;

