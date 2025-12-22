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
        "border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)]",
        "shadow-[var(--p5-shadow-ink)]",
        className,
      ].join(" ")}
      style={{
        clipPath:
          "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
      }}
    >
      {header ? (
        <div
          className={[
            "border-b-[var(--p5-border-width)] border-[color:var(--ink)]",
            headerClassName,
          ].join(" ")}
        >
          {header}
        </div>
      ) : null}
      <div className={["px-4 py-4", bodyClassName].join(" ").trim()}>{children}</div>
    </section>
  );
}

