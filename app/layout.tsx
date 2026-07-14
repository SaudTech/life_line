import type { Metadata } from "next";
import { Hanken_Grotesk, Zilla_Slab, Geist_Mono } from "next/font/google";
import "./globals.css";

// Hanken Grotesk is the typeface from the imported claude.ai/design system.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Zilla Slab (bold) - a free, Clarendon-style bracketed slab serif used only for
// the "LIFE LINE" brand wordmark (login), to echo the hospital signage.
const zillaSlab = Zilla_Slab({
  variable: "--font-zilla-slab",
  subsets: ["latin"],
  weight: ["700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Life Line Hospital",
  description: "Life Line Hospital billing and patient-visit system",
  icons: { icon: "/logo.png", apple: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${zillaSlab.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
