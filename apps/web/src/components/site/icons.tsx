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
export const Play = icon(<path d="M8.25 5.25v13.5L19.5 12 8.25 5.25Z" fill="currentColor" stroke="none" />);
export const Pause = icon(<path d="M8.75 6v12m6.5-12v12" strokeWidth="2.4" strokeLinecap="butt" />);
