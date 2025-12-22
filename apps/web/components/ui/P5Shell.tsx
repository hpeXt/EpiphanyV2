import Link from "next/link";
import type { ReactNode } from "react";

import { P5TopNav } from "@/components/ui/P5TopNav";

export function P5Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-[color:var(--concrete-300)] text-[color:var(--ink)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:border-[var(--p5-border-width)] focus:border-[color:var(--ink)] focus:bg-[color:var(--paper)] focus:px-3 focus:py-2 focus:font-mono focus:text-sm focus:font-semibold focus:uppercase focus:tracking-wide focus:shadow-[var(--p5-shadow-rebel)]"
      >
        Skip to content
      </a>
      <div
        aria-hidden
        className={[
          "pointer-events-none fixed inset-0 z-0 opacity-[var(--p5-noise-opacity)]",
          // 3-layer cheap texture: diagonal lines + dots + grain-ish
          "bg-[linear-gradient(135deg,rgba(0,0,0,0.15)_0,rgba(0,0,0,0.15)_1px,transparent_1px,transparent_10px),radial-gradient(rgba(0,0,0,0.18)_1px,transparent_1px),radial-gradient(rgba(0,0,0,0.08)_1px,transparent_1px)]",
          "bg-[length:14px_14px,18px_18px,34px_34px] bg-[position:0_0,6px_2px,12px_9px]",
        ].join(" ")}
      />

      <header className="relative z-10 px-4 pt-4">
        <div className="mx-auto max-w-5xl">
          <div
            className={[
              "flex flex-wrap items-center justify-between gap-3",
              "border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)]",
              "shadow-[var(--p5-shadow-ink)]",
              "px-4 py-3",
            ].join(" ")}
            style={{
              clipPath:
                "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
            }}
          >
            <Link
              href="/topics"
              className={[
                "inline-flex items-baseline gap-3",
                "font-mono text-sm font-semibold uppercase tracking-wide",
              ].join(" ")}
            >
              <span className="bg-[color:var(--ink)] px-2 py-1 text-[color:var(--paper)]">
                TM
              </span>
              <span className="hidden sm:inline">The Thought Market</span>
            </Link>

            <P5TopNav />
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
