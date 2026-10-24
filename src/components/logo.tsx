import { LOGO } from "@/lib/logo";

/** The product mark. Decorative next to the name, so hidden from screen readers. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d={LOGO.tile} fill={LOGO.blue} />
      <path d={LOGO.bubble} fill="#fff" />
      <path d={LOGO.cross} fill={LOGO.blue} />
    </svg>
  );
}
