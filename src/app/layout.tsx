import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
import { Instrument_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  style: ["normal", "italic"],
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = "https://everyfield.app";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "EveryField",
  description: "Navigate your church plant from calling to launch",
  openGraph: {
    siteName: "EveryField",
    locale: "en_US",
    type: "website",
    url: baseUrl,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "EveryField",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${instrumentSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
