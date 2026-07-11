// A small, calm hospital-themed illustration for the empty Trash state: a clean
// waste bin with a heartbeat line rising out of it - "nothing discarded, all
// healthy". Monochrome in muted tokens, with one emerald accent for the pulse
// (colour = status only). Decorative, so aria-hidden.
export function EmptyTrashIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* soft backdrop disc */}
      <circle cx="60" cy="60" r="52" className="fill-muted" />

      {/* bin body */}
      <path
        d="M40 52h40l-3.4 42.5a6 6 0 0 1-6 5.5H49.4a6 6 0 0 1-6-5.5L40 52Z"
        className="fill-card stroke-muted-foreground/50"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* bin ribs */}
      <path
        d="M52 62v28M60 62v28M68 62v28"
        className="stroke-muted-foreground/30"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* lid */}
      <path
        d="M34 52h52"
        className="stroke-muted-foreground/60"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* handle */}
      <path
        d="M51 52v-5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5"
        className="stroke-muted-foreground/60"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* heartbeat pulse rising above the bin */}
      <path
        d="M26 34h11l4-11 7 22 4-11h32"
        className="stroke-emerald-500"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
