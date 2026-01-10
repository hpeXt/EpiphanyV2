"use client";

import type { HTMLAttributes, ReactNode } from "react";

type Variant = "ink" | "paper" | "rebel" | "electric" | "acid";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  children: ReactNode;
  variant?: Variant;
};

const VARIANT: Record<Variant, string> = {
  ink: "border-transparent bg-foreground text-background",
  paper: "bg-background text-foreground",
  rebel: "border-transparent bg-destructive text-destructive-foreground",
  electric: "border-transparent bg-accent text-accent-foreground",
  acid: "border-transparent bg-[color:var(--chart-2)] text-foreground",
};

export function P5Badge({ children, variant = "paper", className = "", ...props }: Props) {
  return (
    <span
      {...props}
      className={[
        "inline-flex items-center justify-center rounded-full border border-border px-2 py-0.5 text-xs font-medium",
        VARIANT[variant],
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
