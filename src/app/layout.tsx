import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Can You Imagine",
  description: "A public archive of satirical UI/UX concepts by Soren Iverson",
  openGraph: {
    title: "Can You Imagine",
    description: "A public archive of satirical UI/UX concepts by Soren Iverson",
    url: "https://canyouimagine.lol",
    siteName: "Can You Imagine",
    type: "website",
    images: [
      {
        url: "https://canyouimagine.lol/og-image.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Can You Imagine",
    description: "A public archive of satirical UI/UX concepts by Soren Iverson",
    images: ["https://canyouimagine.lol/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
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
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
