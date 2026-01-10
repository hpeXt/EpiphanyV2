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
        "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      ].join(" ")}
    />
  );
}
