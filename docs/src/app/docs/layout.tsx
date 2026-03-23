import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import Image from "next/image";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <div className="flex items-center gap-2">
            <Image
              src="/icon-light.png"
              alt=""
              width={20}
              height={14}
              className="logo-light"
            />
            <Image
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
