"use client";

import type { ReactNode } from "react";

type Props = {
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
};

export function P5Panel({
  header,
  children,
  className = "",
  headerClassName = "",
  bodyClassName = "",
}: Props) {
  return (
    <section
      className={[
        "rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm",
        className,
      ].join(" ")}
    >
      {header ? (
        <div
          className={["border-b border-border/60", headerClassName].join(" ")}
        >
          {header}
        </div>
      ) : null}
      <div className={["px-5 py-5", bodyClassName].join(" ").trim()}>{children}</div>
    </section>
  );
}
