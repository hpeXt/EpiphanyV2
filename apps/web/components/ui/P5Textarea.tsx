"use client";

import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  className?: string;
};

export function P5Textarea({ className = "", ...props }: Props) {
  return (
    <textarea
      {...props}
      className={[
        "w-full border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)] px-3 py-2 text-sm text-[color:var(--ink)] shadow-[var(--p5-shadow-ink)]",
        "focus-visible:outline-none focus-visible:shadow-[var(--p5-shadow-rebel)]",
        className,
      ].join(" ")}
    />
  );
}

