import Link from "next/link";
import { LogoIcon } from "@/components/logo";

export function Footer() {
  return (
    <footer className="border-t border-fd-border py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-fd-muted-foreground">
          <LogoIcon className="size-6" />
          <span className="text-sm">noddde &middot; MIT License</span>
        </div>
        <div className="flex gap-6 text-sm text-fd-muted-foreground">
          <Link
            href="/docs"
            className="transition-colors hover:text-fd-foreground"
          >
            Documentation
          </Link>
          <a
            href="https://github.com/dogganidhal/noddde"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-fd-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
