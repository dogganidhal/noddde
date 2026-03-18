import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-light.png"
              alt=""
              width={20}
              height={14}
              className="logo-light"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-dark.png"
              alt=""
              width={20}
              height={14}
              className="logo-dark"
            />
            <span className="font-semibold">noddde</span>
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
