import { RootProvider } from "fumadocs-ui/provider/next";
import "fumadocs-ui/style.css";
import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  metadataBase: new URL("https://noddde.dev"),
  title: {
    default: "noddde",
    template: "%s | noddde",
  },
  description: "A TypeScript framework for DDD, CQRS, and Event Sourcing",
  openGraph: {
    type: "website",
    siteName: "noddde",
    title: {
      default: "noddde",
      template: "%s | noddde",
    },
    description: "A TypeScript framework for DDD, CQRS, and Event Sourcing",
    url: "https://noddde.dev",
  },
  verification: {
    google: "_SAdehsZlCb-zjOyICC50XtkE91DtBJgxBERkq2PtbE",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareSourceCode",
              name: "noddde",
              description:
                "Functional DDD framework for TypeScript — Decider pattern, Event Sourcing & CQRS",
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
