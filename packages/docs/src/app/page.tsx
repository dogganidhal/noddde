import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-5xl font-bold tracking-tight">noddde</h1>
      <p className="max-w-lg text-lg text-fd-muted-foreground">
        Domain-Driven Design, CQRS, and Event Sourcing for TypeScript
      </p>
      <div className="flex gap-4">
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
