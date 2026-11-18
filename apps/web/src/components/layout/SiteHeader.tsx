import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";
import { LogoMark } from "./LogoMark";

// Shared Wincentive site header: wordmark + W logo, the four standard destinations, an optional
// contextual link row, and an optional WalletButton.
//
// Server-compatible: no "use client", no hooks, no server-only imports, so it can be used from
// Server Components and from client pages alike. WalletButton is the existing client-only dynamic
// wrapper; this component adds no wallet provider of its own (SolanaProvider stays in the layout).
//
// Fonts: it does not load fonts. It uses the CSS variables --font-display and --font-body, which the
// page wrapper defines with next/font/local. Render it inside that wrapper.

export type SiteHeaderCurrent = "home" | "promotions" | "claims" | "checkout";

type SiteHeaderProps = {
  /** Which standard destination is the current page. Sets aria-current="page" on it. */
  current?: SiteHeaderCurrent;
  /** Page-specific links shown before the standard ones (e.g. an in-page "#how-it-works" anchor). */
  extraLinks?: ReadonlyArray<{ label: string; href: string }>;
  /** Show the header WalletButton. Default true. Pass false on pages whose panel already has one. */
  showWallet?: boolean;
};

const NAV: ReadonlyArray<{ key: SiteHeaderCurrent; label: string; href: string }> = [
  { key: "home", label: "Home", href: "/" },
  { key: "promotions", label: "Promotions", href: "/merchant" },
  { key: "claims", label: "Claims", href: "/merchant/claims" },
  { key: "checkout", label: "Demo checkout", href: "/checkout/demo" },
];

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] focus-visible:rounded-sm";
const LINK = `py-1.5 hover:text-[#6133A7] ${FOCUS}`;
const CURRENT = `py-1.5 font-semibold text-[#6133A7] underline decoration-2 underline-offset-[10px] ${FOCUS}`;

// Restyles the existing wallet adapter button through class overrides. One definition for every page.
const WALLET_STYLE =
  "[&_.wallet-adapter-button]:h-10! [&_.wallet-adapter-button]:rounded-full! [&_.wallet-adapter-button]:bg-[#211D28]! [&_.wallet-adapter-button]:px-5! [&_.wallet-adapter-button]:text-sm! [&_.wallet-adapter-button]:font-semibold! [&_.wallet-adapter-button]:font-[family-name:var(--font-body)]! [&_.wallet-adapter-button:hover]:bg-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-2! [&_.wallet-adapter-button:focus-visible]:outline-offset-4! [&_.wallet-adapter-button:focus-visible]:outline-[#6133A7]! [&_.wallet-adapter-button:focus-visible]:outline-solid!";

export function SiteHeader({ current, extraLinks = [], showWallet = true }: SiteHeaderProps) {
  return (
    <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:py-5">
      <Link href="/" aria-label="Wincentive home" className={`flex items-center gap-3 ${FOCUS}`}>
        <LogoMark className="h-10 w-10 rounded-[11px]" />
        <span className="font-[family-name:var(--font-display)] text-[1.35rem] font-bold tracking-[-0.03em]">
          Wincentive
        </span>
      </Link>

      <nav
        aria-label="Primary"
        className="order-3 flex w-full flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium md:order-none md:w-auto md:gap-x-8 md:text-[15px]"
      >
        {extraLinks.map((l) => (
          <a key={l.href} href={l.href} className={LINK}>
            {l.label}
          </a>
        ))}
        {NAV.map((item) =>
          item.key === current ? (
            <Link key={item.key} href={item.href} aria-current="page" className={CURRENT}>
              {item.label}
            </Link>
          ) : (
            <Link key={item.key} href={item.href} className={LINK}>
              {item.label}
            </Link>
          ),
        )}
      </nav>

      {showWallet ? (
        <div className={WALLET_STYLE}>
          <WalletButton />
        </div>
      ) : null}
    </header>
  );
}
