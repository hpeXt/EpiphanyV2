"use client";

import dynamic from "next/dynamic";

// Dynamic import with SSR disabled - uses localStorage
const IdentityInitializer = dynamic(
  () =>
    import("@/components/identity/IdentityInitializer").then(
      (m) => m.IdentityInitializer
    ),
  { ssr: false }
);

export function IdentityInitializerWrapper() {
  return <IdentityInitializer />;
}
