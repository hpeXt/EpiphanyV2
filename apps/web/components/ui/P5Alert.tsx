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
    bar: "bg-destructive text-destructive-foreground",
    body: "bg-card text-card-foreground",
  },
  warn: {
    bar: "bg-[color:var(--chart-2)] text-foreground",
    body: "bg-card text-card-foreground",
  },
  info: {
    bar: "bg-accent text-accent-foreground",
    body: "bg-card text-card-foreground",
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
        "overflow-hidden rounded-lg border border-border/60 shadow-sm",
        className,
      ].join(" ")}
    >
      <div className={["px-4 py-2", style.bar].join(" ")}>
        <div className="text-xs font-medium tracking-wide">{title ?? variant}</div>
      </div>
      <div className={["px-4 py-3 text-sm", style.body].join(" ")}>{children}</div>
    </div>
  );
}
