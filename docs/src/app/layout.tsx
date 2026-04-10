import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";
import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://noddde.dev"),
  title: {
    default: "noddde — Functional DDD Framework for TypeScript",
    template: "%s | noddde",
  },
  description:
    "Build business applications with aggregates, projections, and sagas using the Decider pattern. No base classes. No decorators. No DI container.",
  openGraph: {
    type: "website",
    siteName: "noddde",
    title: {
      default: "noddde — Functional DDD Framework for TypeScript",
      template: "%s | noddde",
    },
    description:
      "Build business applications with aggregates, projections, and sagas using the Decider pattern. No base classes. No decorators. No DI container.",
    url: "https://noddde.dev",
    images: [
      {
        url: "https://noddde.dev/og-image.png",
        width: 1200,
        height: 630,
        alt: "noddde — Functional DDD Framework for TypeScript",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "noddde — Functional DDD Framework for TypeScript",
    description:
      "Build business applications with aggregates, projections, and sagas using the Decider pattern. No base classes. No decorators. No DI container.",
    images: ["https://noddde.dev/og-image.png"],
  },
  verification: {
    google: "_SAdehsZlCb-zjOyICC50XtkE91DtBJgxBERkq2PtbE",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareSourceCode",
              name: "noddde",
              description:
                "Build business applications with aggregates, projections, and sagas using the Decider pattern. No base classes. No decorators. No DI container.",
              url: "https://noddde.dev",
              codeRepository: "https://github.com/dogganidhal/noddde",
              programmingLanguage: "TypeScript",
              license: "https://opensource.org/licenses/MIT",
              runtimePlatform: "Node.js",
            }),
          }}
        />
        <Script
          src="https://cloud.umami.is/script.js"
          data-website-id="92e48cc6-8033-403c-9f0b-17f011bce691"
          strategy="afterInteractive"
        />
      </head>
      <body>
        <RootProvider search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
