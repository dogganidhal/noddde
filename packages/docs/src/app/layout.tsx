import { RootProvider } from "fumadocs-ui/provider/next";
import "fumadocs-ui/style.css";
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    default: "noddde",
    template: "%s | noddde",
  },
  description:
    "A TypeScript framework for DDD, CQRS, and Event Sourcing",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
