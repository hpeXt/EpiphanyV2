"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/components/i18n/I18nProvider";

function cls(active: boolean) {
  return [
    "inline-flex items-center justify-center",
    "rounded-md px-3 py-2 text-sm font-medium",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  ].join(" ");
}

function isTopicsPath(pathname: string): boolean {
  return pathname === "/topics" || pathname.startsWith("/topics/");
}

export function P5TopNav() {
  const pathname = usePathname() ?? "";
  const { t } = useI18n();

  const topicsActive = isTopicsPath(pathname);
  const myActive = pathname === "/my" || pathname.startsWith("/my/");

  return (
    <nav className="flex flex-wrap items-center gap-2">
      <Link
        href="/topics"
        aria-current={topicsActive ? "page" : undefined}
        className={cls(topicsActive)}
      >
        {t("nav.topics")}
      </Link>
      <Link
        href="/my"
        aria-current={myActive ? "page" : undefined}
        className={cls(myActive)}
      >
        {t("nav.my")}
      </Link>
    </nav>
  );
}
