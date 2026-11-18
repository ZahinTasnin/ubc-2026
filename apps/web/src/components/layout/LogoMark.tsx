// The W from the supplied Wincentive logo, zoomed into a black square. The artwork is never
// recreated or recolored. Decorative: the wordmark always sits beside it.
// NOTE: the file on disk is named "wincentive-logo.png.png" (double extension). If it is renamed to
// "wincentive-logo.png", change LOGO_SRC here (the only place it is referenced by the layout components).
export const LOGO_SRC = "/brand/wincentive-logo.png.png";

export function LogoMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`relative block shrink-0 overflow-hidden bg-black ${className}`}>
      <img
        src={LOGO_SRC}
        alt=""
        width={1536}
        height={1024}
        decoding="async"
        className="absolute left-1/2 top-1/2 h-auto w-[135%] max-w-none -translate-x-[52.7%] -translate-y-[46.1%]"
      />
    </span>
  );
}
