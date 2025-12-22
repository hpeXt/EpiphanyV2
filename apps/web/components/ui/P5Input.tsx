"use client";

import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function P5Input({ className = "", ...props }: Props) {
  return (
    <input
      {...props}
      className={[
        "w-full border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] px-3 py-2 text-sm text-[color:var(--ink)] shadow-[var(--p5-shadow-ink)]",
        "focus-visible:outline-none focus-visible:shadow-[var(--p5-shadow-rebel)]",
        className,
      ].join(" ")}
    />
  );
}

