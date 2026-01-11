import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { I18nProvider } from "@/components/i18n/I18nProvider";
import { P5ConfirmProvider } from "@/components/ui/P5ConfirmProvider";
import { P5ToastProvider } from "@/components/ui/P5ToastProvider";
import { IdentityInitializerWrapper } from "@/components/identity/IdentityInitializerWrapper";
import { BRAND } from "@/lib/brand";
import { toHtmlLang } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/server";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html
      lang={toHtmlLang(locale)}
      className={lxgwWenKai.variable}
    >
      <body className="font-body antialiased">
        <I18nProvider initialLocale={locale}>
          <IdentityInitializerWrapper />
          <P5ToastProvider>
            <P5ConfirmProvider>{children}</P5ConfirmProvider>
          </P5ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
