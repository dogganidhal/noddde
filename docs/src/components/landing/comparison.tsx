import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { ArrowRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

type StepDef = {
  step: number;
  name: string;
  description: string;
  without: { code: string; note: ReactNode };
  with: { code?: string; framework?: boolean; note: ReactNode };
};

const STEPS: StepDef[] = [
  {
    step: 1,
    name: "Hydrate",
    description: "Load the aggregate's state before deciding anything.",
    without: {
      code: `const account = await this.accounts.findById(cmd.accountId);`,
      note: "Your repository loads events and replays them through apply().",
    },
    with: {
      framework: true,
      note: "Framework loads events from the configured persistence and folds them through evolve before calling decide.",
    },
  },
  {
    step: 2,
    name: "Enforce invariants",
    description: "Check business rules and produce the resulting events.",
    without: {
      code: `deposit(amount: number) {
  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }
  this.apply({ type: "Deposited", amount });
}`,
      note: "Invariant and event recording live inside an instance method that mutates this.",
    },
    with: {
      code: `decide: {
  Deposit: (cmd) => {
    if (cmd.payload.amount <= 0) {
      throw new Error("Amount must be positive");
    }
    return { name: "Deposited", payload: cmd.payload };
  },
}`,
      note: "Pure function: same command + state produces the same events every time.",
    },
  },
  {
    step: 3,
    name: "Update state",
    description: "Fold each event into the next state.",
    without: {
      code: `private apply(event: DomainEvent) {
  if (event.type === "Deposited") {
    this.balance += event.amount;
  }
  this.uncommitted.push(event);
}`,
      note: "Mutation hidden inside apply(), which also accumulates events on the instance.",
    },
    with: {
      code: `evolve: {
  Deposited: ({ amount }, state) => ({
    balance: state.balance + amount,
  }),
}`,
      note: "Pure function called once per recorded event; no instance state to track.",
    },
  },
  {
    step: 4,
    name: "Publish",
    description: "Hand events to the event bus for projections and sagas.",
    without: {
      code: `for (const event of account.pullEvents()) {
  await this.events.publish(event);
}`,
      note: "Drain pullEvents() and call the event bus from the use-case.",
    },
    with: {
      framework: true,
      note: "Framework appends to the event store and dispatches to the event bus in the same transaction.",
    },
  },
];

const HIGHLIGHT_OPTS = {
  lang: "typescript",
  themes: { light: "github-light", dark: "github-dark" },
} as const;

export async function Comparison() {
  const rendered = await Promise.all(
    STEPS.map(async (s) => ({
      ...s,
      withoutNode: await highlight(s.without.code, HIGHLIGHT_OPTS),
      withNode: s.with.code
        ? await highlight(s.with.code, HIGHLIGHT_OPTS)
        : null,
    })),
  );

  return (
    <section className="border-t border-fd-border py-16 lg:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-fd-foreground">
            The same domain, mapped step by step
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
            Both sides handle the same four-step lifecycle &mdash; hydrate the
            aggregate, enforce invariants, update state, publish. The difference
            is who writes which step.
          </p>
        </div>

        <div className="mt-14 space-y-12">
          {rendered.map((s) => (
            <article
              key={s.step}
              className="grid gap-6 lg:grid-cols-[240px_1fr] lg:items-start"
            >
              <header>
                <div className="flex items-center gap-3">
                  <StepBadge step={s.step} />
                  <h3 className="text-lg font-semibold text-fd-foreground">
                    {s.name}
                  </h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                  {s.description}
                </p>
              </header>

              <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
                <Cell
                  variant="muted"
                  label="Without noddde"
                  note={s.without.note}
                >
                  <CodeBlock keepBackground>
                    <Pre>{s.withoutNode}</Pre>
                  </CodeBlock>
                </Cell>

                <div className="hidden items-center justify-center pt-12 lg:flex">
                  <ArrowRight
                    className="size-5 text-fd-muted-foreground/70"
                    aria-hidden
                  />
                </div>

                <Cell variant="primary" label="With noddde" note={s.with.note}>
                  {s.withNode ? (
                    <CodeBlock keepBackground>
                      <Pre>{s.withNode}</Pre>
                    </CodeBlock>
                  ) : (
                    <FrameworkPanel />
                  )}
                </Cell>
              </div>
            </article>
          ))}
        </div>

        <p className="mx-auto mt-14 max-w-3xl text-center text-sm leading-relaxed text-fd-muted-foreground">
          You write{" "}
          <code className="rounded bg-fd-muted px-1.5 py-0.5 text-xs">
            decide
          </code>{" "}
          and{" "}
          <code className="rounded bg-fd-muted px-1.5 py-0.5 text-xs">
            evolve
          </code>
          . Hydration and publishing become configuration.
        </p>
      </div>
    </section>
  );
}

function StepBadge({ step }: { step: number }) {
  return (
    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-fd-primary/40 bg-fd-primary/10 px-2 text-sm font-semibold tabular-nums text-fd-primary">
      {step}
    </span>
  );
}

function Cell({
  variant,
  label,
  note,
  children,
}: {
  variant: "muted" | "primary";
  label: string;
  note: ReactNode;
  children: ReactNode;
}) {
  const labelClasses =
    variant === "primary"
      ? "border-fd-primary/40 bg-fd-primary/10 text-fd-primary"
      : "border-fd-border bg-fd-card text-fd-muted-foreground";
  return (
    <div className="min-w-0">
      <span
        className={`mb-2 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${labelClasses}`}
      >
        {label}
      </span>
      {children}
      <p className="mt-3 text-xs leading-relaxed text-fd-muted-foreground">
        {note}
      </p>
    </div>
  );
}

function FrameworkPanel() {
  return (
    <div className="flex min-h-[64px] items-center justify-center rounded-lg border border-dashed border-fd-primary/40 bg-fd-primary/5 px-4 py-6">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-fd-primary">
        <Sparkles className="size-4" aria-hidden />
        Handled by the framework
      </span>
    </div>
  );
}
