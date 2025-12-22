"use client";

import type { ReactNode } from "react";

type Variant = "error" | "warn" | "info";

type Props = {
  title?: string;
  children: ReactNode;
  variant?: Variant;
  role?: "alert" | "status";
  className?: string;
};

const VARIANT: Record<Variant, { bar: string; body: string }> = {
  error: {
    bar: "bg-[color:var(--rebel-red)]",
    body: "bg-[color:var(--paper)] text-[color:var(--ink)]",
  },
  warn: {
    bar: "bg-[color:var(--acid)]",
    body: "bg-[color:var(--paper)] text-[color:var(--ink)]",
  },
  info: {
    bar: "bg-[color:var(--electric)]",
    body: "bg-[color:var(--paper)] text-[color:var(--ink)]",
  },
};

export function P5Alert({
  title,
  children,
  variant = "info",
  role = "alert",
  className = "",
}: Props) {
  const style = VARIANT[variant];

  return (
    <div
      role={role}
      className={[
        "overflow-hidden border-[var(--p5-border-width)] border-[color:var(--ink)] shadow-[var(--p5-shadow-ink)]",
        className,
      ].join(" ")}
      style={{
        clipPath:
          "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
      }}
    >
      <div className={["px-4 py-2 text-[color:var(--paper)]", style.bar].join(" ")}>
        <div className="font-mono text-xs font-semibold uppercase tracking-wide">
          {title ?? variant}
        </div>
      </div>
      <div className={["px-4 py-3 text-sm", style.body].join(" ")}>{children}</div>
    </div>
  );
}

