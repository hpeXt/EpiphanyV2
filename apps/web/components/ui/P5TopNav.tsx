"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function cls(active: boolean) {
  return [
    "inline-flex items-center justify-center",
    "border-[var(--p5-border-width)] border-[color:var(--ink)]",
    "px-3 py-1.5 text-sm font-semibold",
    "shadow-[var(--p5-shadow-ink)]",
    "transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5",
    "focus-visible:outline-none focus-visible:shadow-[var(--p5-shadow-rebel)]",
    active
      ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
      : "bg-[color:var(--paper)] text-[color:var(--ink)] hover:bg-[color:var(--concrete-200)]",
  ].join(" ");
}

function isTopicsPath(pathname: string): boolean {
  return pathname === "/topics" || pathname.startsWith("/topics/");
}

export function P5TopNav() {
  const pathname = usePathname() ?? "";

  const topicsActive = isTopicsPath(pathname);
  const myActive = pathname === "/my" || pathname.startsWith("/my/");

  return (
    <nav className="flex flex-wrap items-center gap-2">
      <Link
        href="/topics"
        aria-current={topicsActive ? "page" : undefined}
        className={cls(topicsActive)}
      >
        Topics
      </Link>
      <Link
        href="/my"
        aria-current={myActive ? "page" : undefined}
        className={cls(myActive)}
      >
        My
      </Link>
    </nav>
  );
}

