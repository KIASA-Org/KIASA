import type { ReactNode, SVGProps } from "react";

/** The site's icons: drawn as lines, like the leaf, on a 24 px grid. All decorative. */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

const icon = (shape: ReactNode) => function Icon(props: IconProps) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{shape}</svg>;
};

export const ArrowRight = icon(<path d="M4.5 12h15m-6-6 6 6-6 6" />);
export const ArrowLeft = icon(<path d="M19.5 12h-15m6-6-6 6 6 6" />);
export const ChevronDown = icon(<path d="m6.5 9.5 5.5 5.5 5.5-5.5" />);
export const ChevronRight = icon(<path d="m9.5 6.5 5.5 5.5-5.5 5.5" />);
export const Search = icon(<><circle cx="10.75" cy="10.75" r="6.25" /><path d="m15.4 15.4 5.1 5.1" /></>);
export const Globe = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5s1.3-6.2 3.8-8.5Z" /></>);
export const Close = icon(<path d="m6 6 12 12M18 6 6 18" />);
export const Menu = icon(<path d="M3.5 8.5h17m-17 7h17" />);
export const Plus = icon(<path d="M12 5.5v13M5.5 12h13" />);
export const Check = icon(<path d="m5.5 12.5 4.25 4.25L18.5 8" />);
/** Two checks, the second's short stroke tucked behind the first: read. */
export const Ticks = icon(<path d="m2.5 12.5 4.25 4.25L15.5 8m-4.25 7.25 1.5 1.5L21.5 8" />);
export const Clock = icon(<><circle cx="12" cy="12" r="7.5" /><path d="M12 8v4.25l2.75 1.75" /></>);
export const Alert = icon(<><circle cx="12" cy="12" r="8" /><path d="M12 7.75v5M12 16.25h.01" /></>);
export const ChatBubble = icon(<path d="M4.5 5.5h15v10.5h-8.5l-4.5 3.5v-3.5h-2V5.5Z" />);
export const Reply = icon(<path d="M9.5 6.5 4.5 11.5l5 5M5 11.5h9a5.5 5.5 0 0 1 5.5 5.5v1" />);
export const Pencil = icon(<path d="m14.5 5.5 4 4L8.5 19.5h-4v-4l10-10ZM12.5 7.5l4 4" />);
export const Trash = icon(<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.25 10.5v6m3.5-6v6" />);
export const Camera = icon(<><path d="M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4V8Z" /><circle cx="12" cy="13.25" r="3.25" /></>);
export const More = icon(<path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth="2.6" />);
export const Copy = icon(<><path d="M8.5 8.5h10v11h-10z" /><path d="M15.5 8.5v-4h-10v11h3" /></>);
export const Pin = icon(<path d="M14.5 4.5 19.5 9.5l-3 1.5-3 3 .5 4-2 1.5-7-7L6.5 10.5l4 .5 3-3 1-3.5ZM8 16l-3.5 3.5" />);
export const Forward = icon(<path d="m14.5 6.5 5 5-5 5M19 11.5h-9a5.5 5.5 0 0 0-5.5 5.5v1" />);
export const Select = icon(<><circle cx="12" cy="12" r="8" /><path d="m8.5 12.25 2.5 2.5 4.75-5" /></>);
export const BellOff = icon(<path d="M9.5 19.5a2.75 2.75 0 0 0 5 0M6.5 9.5a5.5 5.5 0 0 1 8.7-4.5M17.5 10v3.5l1.5 3H7M4.5 4.5l15 15M6.5 9.5v4l-1.5 3" />);
export const Bell = icon(<path d="M9.5 19.5a2.75 2.75 0 0 0 5 0M6.5 9.5a5.5 5.5 0 0 1 11 0v4l1.5 3h-14l1.5-3v-4Z" />);
export const Archive = icon(<path d="M4.5 5.5h15v3.5h-15zM5.5 9v9.5h13V9M10 12.5h4" />);
export const Unread = icon(<><path d="M4.5 5.5h10M4.5 5.5v10.5H7v3.5l4.5-3.5h8v-5" /><circle cx="18.5" cy="6.5" r="2.25" /></>);
export const Eraser = icon(<><circle cx="12" cy="12" r="8" /><path d="m6.5 17.5 11-11" /></>);
/** An eye: reading unseen. */
export const Eye = icon(<><path d="M2.75 12S6.25 5.75 12 5.75 21.25 12 21.25 12 17.75 18.25 12 18.25 2.75 12 2.75 12Z" /><circle cx="12" cy="12" r="2.75" /></>);
export const Bookmark = icon(<path d="M6.5 4.5h11v15L12 15.5l-5.5 4v-15Z" />);
export const People = icon(<><circle cx="9" cy="8.5" r="3.25" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.5a3.25 3.25 0 0 1 0 6.25M17 14.5a5.5 5.5 0 0 1 3.5 5" /></>);
export const Gear = icon(<><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.75 1.75M16.25 16.25 18 18M6 18l1.75-1.75M16.25 7.75 18 6" /></>);
export const NewTab = icon(<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 13.5v6h-13v-13h6" />);
export const Leave = icon(<path d="M10.5 4.5h-6v15h6M15 8l4 4-4 4M19 12H9.5" />);
export const Smile = icon(<><circle cx="12" cy="12" r="8" /><path d="M8.75 14a4 4 0 0 0 6.5 0M9.5 10h.01M14.5 10h.01" /></>);
export const Download = icon(<path d="M12 4.5v10.5m-4.5-4.5 4.5 4.5 4.5-4.5M5.5 19.5h13" />);
export const Paperclip = icon(<path d="m19 11.5-7.25 7.25a4.6 4.6 0 0 1-6.5-6.5l7.75-7.75a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.55 1.55 0 0 1-2.2-2.2l7-7" />);
export const Send = icon(<path d="M20 4 3.75 10.75l6.5 2.5L12.75 19.75 20 4ZM10.25 13.25 20 4" />);
export const Info = icon(<><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></>);
export const Play = icon(<path d="M8.25 5.25v13.5L19.5 12 8.25 5.25Z" fill="currentColor" stroke="none" />);
export const Pause = icon(<path d="M8.75 6v12m6.5-12v12" strokeWidth="2.4" strokeLinecap="butt" />);
export const Video = icon(<><path d="M3.5 7h12v10h-12z" /><path d="m15.5 10.5 5-3v9l-5-3" /></>);
export const VideoOff = icon(<><path d="M8 7h7.5v7.5M15.5 17h-12V7h1" /><path d="m15.5 10.5 5-3v9l-5-3M3.5 3.5l17 17" /></>);
export const Mic = icon(<><path d="M9 6.5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0v-5Z" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>);
export const MicOff = icon(<><path d="M15 10V6.5a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5" /><path d="M5.5 11.5a6.5 6.5 0 0 0 10.4 5.2M18.5 11.5c0 .9-.2 1.8-.5 2.6M12 18v2.5M4 4l16 16" /></>);
export const Screen = icon(<><path d="M3.5 5h17v11h-17z" /><path d="M9 19.5h6M12 16v3.5M12 13V8.5m-2.25 2.25L12 8.5l2.25 2.25" /></>);
export const Hand = icon(<path d="M8.5 11.5v-6a1.5 1.5 0 0 1 3 0v5m0-6.5a1.5 1.5 0 0 1 3 0v6.5m0-5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 14.6a1.5 1.5 0 0 1 2.3-1.9l2.2 2.3v-3.5" />);
export const Record = icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></>);
export const Calendar = icon(<><path d="M4.5 6h15v13.5h-15z" /><path d="M4.5 10h15M8.5 4v4M15.5 4v4" /></>);
export const PhoneOff = icon(<path d="M4 14.5c4.5-4.2 11.5-4.2 16 0l-1.6 2.6-3.5-1.3v-2.3a10 10 0 0 0-5.8 0v2.3l-3.5 1.3L4 14.5Z" />);
