import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { homepageCopy } from "@/lib/copy";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: homepageCopy.meta.title,
  description: homepageCopy.meta.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" className={`${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
