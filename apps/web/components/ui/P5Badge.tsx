"use client";

import type { HTMLAttributes, ReactNode } from "react";

type Variant = "ink" | "paper" | "rebel" | "electric" | "acid";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  children: ReactNode;
  variant?: Variant;
};

const VARIANT: Record<Variant, string> = {
  ink: "bg-[color:var(--ink)] text-[color:var(--paper)]",
  paper: "bg-[color:var(--paper)] text-[color:var(--ink)]",
  rebel: "bg-[color:var(--rebel-red)] text-[color:var(--paper)]",
  electric: "bg-[color:var(--electric)] text-[color:var(--paper)]",
  acid: "bg-[color:var(--acid)] text-[color:var(--ink)]",
};

export function P5Badge({ children, variant = "paper", className = "", ...props }: Props) {
  return (
    <span
      {...props}
      className={[
        "inline-flex items-center justify-center border-[3px] border-[color:var(--ink)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        "shadow-[2px_2px_0_var(--ink)]",
        VARIANT[variant],
        className,
      ].join(" ")}
      style={{
        clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
      }}
    >
      {children}
    </span>
  );
}

