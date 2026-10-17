import { PartyPopper } from "lucide-react";
import type { CSSProperties } from "react";

const COLOURS = ["var(--primary)", "var(--success)", "var(--warning)", "var(--chart-2)", "var(--chart-3)"];
// Fixed directions and spins, so the burst looks the same every time (and renders the same in tests).
const PIECES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  const distance = 38 + (i % 4) * 12;
  return {
    dx: `${Math.round(Math.cos(angle) * distance)}px`,
    dy: `${Math.round(Math.sin(angle) * distance - 12)}px`,
    rot: `${(i * 67) % 360}deg`,
    colour: COLOURS[i % COLOURS.length]!,
    delay: `${(i % 3) * 40}ms`,
  };
});

/** A small burst of confetti and a badge when every request succeeds after a fix. */
export function Celebration() {
  return (
    <span
      role="status"
      className="sdl-badge-pop relative inline-flex h-6 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 text-xs font-medium text-success"
    >
      <PartyPopper className="size-3.5" aria-hidden />
      All requests succeed
      <span className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
        {PIECES.map((p, i) => (
          <span
            key={i}
            className="sdl-confetti"
            style={
              {
                "--dx": p.dx,
                "--dy": p.dy,
                "--rot": p.rot,
                background: p.colour,
                animationDelay: p.delay,
              } as CSSProperties
            }
          />
        ))}
      </span>
    </span>
  );
}
