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
        "rounded-lg border border-border/60 bg-card text-card-foreground shadow-sm",
        className,
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <TitleTag className="truncate font-serif text-xl font-semibold text-foreground">
            {title}
          </TitleTag>
          {subtitle ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p>
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
                className="text-muted-foreground hover:text-foreground"
              >
                {action.label}
              </P5LinkButton>
            ))}
          </div>
        ) : null}
      </div>

      <div className={["px-5 py-5", bodyClassName].join(" ").trim()}>{children}</div>
    </section>
  );
}
