import { Link } from "react-router";

/** Three connected nodes: a tiny architecture diagram. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M7 7.5 12 16.5M17 7.5 12 16.5M8.5 6h7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <rect x="3" y="3" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.8" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.65" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-tight"
    >
      <LogoMark className="size-5 text-primary" />
      <span>System Design Lab</span>
    </Link>
  );
}
