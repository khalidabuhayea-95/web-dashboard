import { IBM_Plex_Sans_Arabic, Geist_Mono } from "next/font/google";

import { SHARE_ORIGIN } from "@/lib/shareLink";

import "./globals.css";

// IBM Plex Sans Arabic is the Nayroz brand typeface and carries both scripts,
// so Arabic copy renders in the same family instead of a system fallback. The
// CSS variable keeps its original name so every `--font-geist-sans` reference
// across the app picks this up unchanged.
const brandSans = IBM_Plex_Sans_Arabic({
  variable: "--font-geist-sans",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL(SHARE_ORIGIN),
  title: {
    default: "Nayroz Studio",
    template: "%s · Nayroz Studio",
  },
  description: "Nayroz Studio — design templates, fonts, and mobile app operations in one place.",
  applicationName: "Nayroz Studio",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "Nayroz Studio",
    title: "Nayroz Studio",
    description: "Design templates, fonts, and mobile app operations in one place.",
    images: [{ url: "/brand/social/nayroz-og-1200x630.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nayroz Studio",
    description: "Design templates, fonts, and mobile app operations in one place.",
    images: ["/brand/social/nayroz-og-1200x630.png"],
  },
  // The console is behind a login; nothing here belongs in a search index.
  robots: { index: false, follow: false },
};

export const viewport = {
  // Brand teal on light chrome, Ink on dark — matches the two page grounds.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#22828c" },
    { media: "(prefers-color-scheme: dark)", color: "#17191c" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${brandSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
