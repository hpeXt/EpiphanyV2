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
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3",
  md: "h-9 px-4",
};

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  ink: "bg-foreground text-background hover:bg-foreground/90",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
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
