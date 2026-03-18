import Link from "next/link";

export default function HomePage() {
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-light.png" alt="noddde" width={56} height={40} className="logo-light" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-dark.png" alt="noddde" width={56} height={40} className="logo-dark" />

      <h1 className="mt-5 text-4xl font-bold tracking-tight text-fd-foreground">
        noddde
      </h1>

      <p className="mt-4 max-w-md text-center text-base leading-relaxed text-fd-muted-foreground">
        Build business applications with aggregates, projections, and
        sagas&nbsp;&mdash; using plain objects and pure functions. No base
        classes. No decorators. No DI&nbsp;container.
      </p>

      <pre className="mt-6 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm text-fd-muted-foreground">
        <code>yarn add @noddde/core</code>
      </pre>

      <div className="mt-6 flex gap-4">
        <Link
          href="/docs/getting-started/introduction"
          className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground"
        >
          Get Started
        </Link>
        <Link
          href="/docs"
          className="rounded-lg border border-fd-border px-6 py-3 text-sm font-medium"
        >
          Documentation
        </Link>
      </div>
    </main>
  );
}
