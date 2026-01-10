import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { P5ConfirmProvider } from "@/components/ui/P5ConfirmProvider";
import { P5ToastProvider } from "@/components/ui/P5ToastProvider";
import { IdentityInitializerWrapper } from "@/components/identity/IdentityInitializerWrapper";
import { BRAND } from "@/lib/brand";

// Body font: LXGW WenKai (Chinese-first body text)
const lxgwWenKai = localFont({
  src: "../public/fonts/LXGWWenKai-Regular.ttf",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={lxgwWenKai.variable}
    >
      <body className="font-body antialiased">
        <IdentityInitializerWrapper />
        <P5ToastProvider>
          <P5ConfirmProvider>
            {children}
          </P5ConfirmProvider>
        </P5ToastProvider>
      </body>
    </html>
  );
}
