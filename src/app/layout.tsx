import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import { STORAGE_ORIGIN } from "@/lib/storage";
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
  // Lets every page resolve relative canonical/OG URLs against the real origin
  // instead of inheriting a hardcoded one.
  metadataBase: new URL(SITE_URL),
  title: "Can You Imagine",
  description: "A public archive of satirical UI/UX concepts by Soren Iverson",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Can You Imagine",
    description: "A public archive of satirical UI/UX concepts by Soren Iverson",
    url: "/",
    siteName: "Can You Imagine",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Can You Imagine",
    description: "A public archive of satirical UI/UX concepts by Soren Iverson",
    images: ["/og-image.png"],
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
      <head>
        {/* The canvas needs these two files and nothing else to draw the whole
            archive. Preloading them means the browser starts both during HTML
            parse, in parallel with the JS, rather than after hydration and
            WebGL init - which measured at t+1227ms before this. */}
        <link rel="preload" as="image" href="/atlas/preview-v1.webp" fetchPriority="high" />
        <link rel="preload" as="image" href="/atlas/thumbs-0-v1.webp" />
        {/* Mid-res images are served from this cross-origin host, so warm
            the DNS + TCP + TLS handshake before the canvas asks for one. */}
        {STORAGE_ORIGIN && (
          <>
            <link rel="preconnect" href={STORAGE_ORIGIN} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={STORAGE_ORIGIN} />
          </>
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
