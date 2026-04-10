import Link from "next/link";
import { InstallCommand } from "./install-command";
import { HeroCode } from "./hero-code";

export function Hero() {
  return (
    <section className="relative overflow-hidden py-20 lg:py-32">
      {/* Dashed grid background */}
      <div className="dashed-grid-bg pointer-events-none absolute inset-0" />

      <div className="relative mx-auto grid max-w-5xl gap-10 px-6 lg:grid-cols-2 lg:items-center">
        {/* Left column — text content */}
        <div className="flex flex-col items-start">
          <span className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
            Functional DDD for TypeScript
          </span>

          <h1 className="mt-6 text-4xl font-bold tracking-tight text-fd-foreground lg:text-5xl">
            Build business logic with{" "}
            <span className="text-fd-primary">pure functions</span>
          </h1>

          <p className="mt-4 text-lg leading-relaxed text-fd-muted-foreground">
            Define aggregates, projections, and sagas using the Decider
            pattern&nbsp;&mdash; typed objects and plain functions, no magic.
          </p>

          <div className="mt-8">
            <InstallCommand />
          </div>

          <div className="mt-6 flex gap-4">
            <Link
              href="/docs/getting-started/introduction"
              className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            >
              Get Started
            </Link>
            <Link
              href="/docs"
              className="rounded-lg border border-fd-border px-6 py-3 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-card"
            >
              Documentation
            </Link>
          </div>
        </div>

        {/* Right column — code example */}
        <div className="hidden min-w-0 overflow-hidden lg:block">
          <HeroCode />
        </div>
      </div>
    </section>
  );
}
