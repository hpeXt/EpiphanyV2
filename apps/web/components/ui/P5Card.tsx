"use client";

import type { ReactNode } from "react";

import { P5LinkButton } from "@/components/ui/P5Button";

type TitleAs = "h1" | "h2" | "h3";

type Action = {
  href: string;
  label: string;
  variant?: Parameters<typeof P5LinkButton>[0]["variant"];
};

type Props = {
  title: string;
  titleAs?: TitleAs;
  subtitle?: string;
  actions?: Action[];
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function P5Card({
  title,
  titleAs = "h2",
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: Props) {
  const TitleTag = titleAs;

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--ink)] px-4 py-3 text-[color:var(--paper)]">
        <div className="min-w-0">
          <TitleTag className="truncate font-mono text-sm font-semibold uppercase tracking-wide">
            {title}
          </TitleTag>
          {subtitle ? (
            <p className="mt-1 truncate text-xs text-white/80">{subtitle}</p>
          ) : null}
        </div>

        {actions?.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action) => (
              <P5LinkButton
                key={`${action.href}:${action.label}`}
                href={action.href}
                variant={action.variant ?? "ghost"}
                size="sm"
                className="border-[color:var(--paper)] text-[color:var(--paper)] shadow-none hover:bg-white/10"
              >
                {action.label}
              </P5LinkButton>
            ))}
          </div>
        ) : null}
      </div>

      <div className={["px-4 py-4", bodyClassName].join(" ").trim()}>{children}</div>
    </section>
  );
}

