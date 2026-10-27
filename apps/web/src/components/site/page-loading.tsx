import { LeafMark } from "./brand";
import { LoadingSignal } from "./route-progress";
import { SiteShell } from "./shell";

type Kind = "site" | "jobs" | "chat" | "admin";

/** What a private page shows the moment it is asked for, while the server makes
 * it: the shape of what comes, and the line along the top keeps going. The site's
 * own pages keep their header; the desks (Jobs, Chat, Admin) their bar. */
export function PageLoading({ label, kind }: { label: string; kind: Kind }) {
  const said = <p className="loading-said" role="status">Opening {label}…</p>;
  if (kind === "site") return <SiteShell>
    <div className="page-loading page-loading-site wrap" aria-busy="true">
      <LoadingSignal />{said}
      <Text />
    </div>
  </SiteShell>;
  return <div className={`site page-loading page-loading-${kind}`} aria-busy="true">
    <LoadingSignal />{said}
    <header className="practice-header admin-header" aria-hidden="true">
      <div className="admin-bar wrap wrap-wide">
        <span className="practice-lockup">
          <LeafMark className="practice-mark" weight={3.4} />
          <span className="practice-divider" />
          <span className="practice-word">KIASA <span>{label}</span></span>
        </span>
      </div>
    </header>
    {kind === "chat" ? <Chat /> : kind === "admin" ? <div className="loading-admin wrap wrap-wide"><Text /><Row count={3} /></div> : <Jobs />}
  </div>;
}

const Block = ({ size }: { size?: string }) => <span className="loading-block" data-size={size} />;
const Row = ({ count }: { count: number }) => <div className="loading-row">{Array.from({ length: count }, (_, i) => <Block key={i} />)}</div>;

/** A page's opening: its small heading, its title, a line or two. */
const Text = () => <div className="loading-text" aria-hidden="true">
  <Block size="eyebrow" /><Block size="title" /><Block size="line" /><Block size="line-short" />
</div>;

const Jobs = () => <div className="loading-jobs" aria-hidden="true"><Block size="tabs" /><Row count={4} /><Block size="tall" /></div>;

/** The chat list beside an open chat. */
const Chat = () => <div className="loading-chat" aria-hidden="true">
  <div className="loading-chat-list">
    <Block size="search" />
    {Array.from({ length: 6 }, (_, i) => <div key={i} className="loading-chat-row">
      <Block size="dot" />
      <span className="loading-chat-lines"><Block size="line" /><Block size="line-short" /></span>
    </div>)}
  </div>
  <div className="loading-chat-pane" />
</div>;
