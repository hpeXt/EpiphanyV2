import type { Metadata } from "next";
import "./globals.css";

import { P5Shell } from "@/components/ui/P5Shell";
import { P5ConfirmProvider } from "@/components/ui/P5ConfirmProvider";
import { P5ToastProvider } from "@/components/ui/P5ToastProvider";

export const metadata: Metadata = {
  title: "The Thought Market",
  description: "Structured debate × QV × semantic maps × AI governance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <P5ToastProvider>
          <P5ConfirmProvider>
            <P5Shell>{children}</P5Shell>
          </P5ConfirmProvider>
        </P5ToastProvider>
      </body>
    </html>
  );
}
