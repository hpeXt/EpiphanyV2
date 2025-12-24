import type { Metadata } from "next";
import { Bebas_Neue, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

import { P5Shell } from "@/components/ui/P5Shell";
import { P5ConfirmProvider } from "@/components/ui/P5ConfirmProvider";
import { P5ToastProvider } from "@/components/ui/P5ToastProvider";
import { IdentityInitializerWrapper } from "@/components/identity/IdentityInitializerWrapper";
import { BRAND } from "@/lib/brand";

// Display font: Bebas Neue (titles, labels)
const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Mono font: JetBrains Mono (data, code)
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

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
      className={`${bebasNeue.variable} ${jetbrainsMono.variable} ${lxgwWenKai.variable}`}
    >
      <body className="font-body antialiased">
        <IdentityInitializerWrapper />
        <P5ToastProvider>
          <P5ConfirmProvider>
            <P5Shell>{children}</P5Shell>
          </P5ConfirmProvider>
        </P5ToastProvider>
      </body>
    </html>
  );
}
