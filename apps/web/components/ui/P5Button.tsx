"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ink" | "ghost" | "danger";
type Size = "sm" | "md";

type P5ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

type P5LinkButtonProps = {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: Variant;
  size?: Size;
};

const BASE =
  "inline-flex select-none items-center justify-center gap-2 border-[var(--p5-border-width)] border-[color:var(--ink)] font-medium shadow-[var(--p5-shadow-ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 disabled:translate-x-0 disabled:translate-y-0 disabled:opacity-60 focus-visible:outline-none focus-visible:shadow-[var(--p5-shadow-rebel)]";

const SIZE: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[color:var(--rebel-red)] text-[color:var(--paper)] shadow-[var(--p5-shadow-rebel)]",
  ink: "bg-[color:var(--ink)] text-[color:var(--paper)]",
  ghost:
    "bg-[color:var(--paper)] text-[color:var(--ink)] hover:bg-[color:var(--concrete-200)]",
  danger:
    "bg-[color:var(--paper)] text-[color:var(--ink)] shadow-[var(--p5-shadow-rebel)] hover:bg-[color:var(--paper)]",
};

function cls(props: { variant: Variant; size: Size; className?: string }) {
  return [BASE, SIZE[props.size], VARIANT[props.variant], props.className ?? ""]
    .join(" ")
    .trim();
}

export function P5Button({
  variant = "ghost",
  size = "md",
  className,
  type,
  ...props
}: P5ButtonProps) {
  return (
    <button
      {...props}
      type={type ?? "button"}
      className={cls({ variant, size, className })}
    />
  );
}

export function P5LinkButton({
  href,
  children,
  variant = "ghost",
  size = "md",
  className,
}: P5LinkButtonProps) {
  return (
    <Link href={href} className={cls({ variant, size, className })}>
      {children}
    </Link>
  );
}
