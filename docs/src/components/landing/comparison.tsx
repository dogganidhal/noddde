import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import type { ReactNode } from "react";

const CLASSICAL = `type DomainEvent = { type: "Deposited"; amount: number };

export class Account {
  private balance = 0;
  private uncommitted: DomainEvent[] = [];

  static rehydrate(history: DomainEvent[]) {
    const account = new Account();
    history.forEach((e) => account.apply(e));
    return account;
  }

  deposit(amount: number) {
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }
    this.apply({ type: "Deposited", amount });
  }

  private apply(event: DomainEvent) {
    if (event.type === "Deposited") {
      this.balance += event.amount;
    }
    this.uncommitted.push(event);
  }

  pullEvents(): DomainEvent[] {
    const out = this.uncommitted;
    this.uncommitted = [];
    return out;
  }
}

export class DepositMoney {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly events: EventBus,
  ) {}

  async execute(cmd: { accountId: string; amount: number }) {
    const account = await this.accounts.findById(cmd.accountId);
    account.deposit(cmd.amount);
    await this.accounts.save(account);
    for (const event of account.pullEvents()) {
      await this.events.publish(event);
    }
  }
}`;

const NODDDE = `type AccountDef = {
  state: { balance: number };
  commands: DefineCommands<{ Deposit: { amount: number } }>;
  events: DefineEvents<{ Deposited: { amount: number } }>;
  infrastructure: {};
};

const Account = defineAggregate<AccountDef>({
  initialState: { balance: 0 },

  decide: {
    Deposit: (cmd) => {
      if (cmd.payload.amount <= 0) {
        throw new Error("Amount must be positive");
      }
      return { name: "Deposited", payload: cmd.payload };
    },
  },

  evolve: {
    Deposited: ({ amount }, state) => ({
      balance: state.balance + amount,
    }),
  },
});

// Anywhere you need to deposit money:
await domain.dispatchCommand({
  name: "Deposit",
  targetAggregateId: accountId,
  payload: { amount: 100 },
});`;

type LifecycleStep = {
  name: string;
  without: ReactNode;
  with: ReactNode;
  byFramework?: boolean;
};

const STEPS: LifecycleStep[] = [
  {
    name: "Hydrate",
    without: (
      <>
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">
          accounts.findById(id)
        </code>{" "}
        — your repository loads events and replays them through{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">apply</code>.
      </>
    ),
    with: (
      <>
        Framework loads events from the configured persistence and folds them
        through{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">evolve</code>{" "}
        before calling{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">decide</code>.
      </>
    ),
    byFramework: true,
  },
  {
    name: "Decide",
    without: (
      <>
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">
          account.deposit(amount)
        </code>{" "}
        — invariants live inside the instance method.
      </>
    ),
    with: (
      <>
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">
          decide.Deposit(cmd, state, infra) =&gt; events
        </code>{" "}
        — pure function returning the events to record.
      </>
    ),
  },
  {
    name: "Update state",
    without: (
      <>
        Mutation hidden inside{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">apply</code>,
        which also accumulates events on the instance.
      </>
    ),
    with: (
      <>
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">
          evolve.Deposited(payload, state) =&gt; state
        </code>{" "}
        — pure function called once per recorded event.
      </>
    ),
  },
  {
    name: "Publish",
    without: (
      <>
        Drain{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5 text-xs">
          pullEvents()
        </code>{" "}
        from the use-case and hand each event to your event bus.
      </>
    ),
    with: (
      <>
        Framework appends to the event store and dispatches to the event bus in
        the same transaction.
      </>
    ),
    byFramework: true,
  },
];

export async function Comparison() {
  const [classical, noddde] = await Promise.all([
    highlight(CLASSICAL, {
      lang: "typescript",
      themes: { light: "github-light", dark: "github-dark" },
    }),
    highlight(NODDDE, {
      lang: "typescript",
      themes: { light: "github-light", dark: "github-dark" },
    }),
  ]);

  return (
    <section className="border-t border-fd-border py-16 lg:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-fd-foreground">
            The same domain, mapped step by step
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
            Both sides handle the same four-step lifecycle — hydrate the
            aggregate, decide what events to produce, update state, publish. The
            difference is who writes which step.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
                Without noddde
              </span>
              <span className="text-xs text-fd-muted-foreground">
                aggregate, repository-loaded use-case, manual publishing
              </span>
            </div>
            <CodeBlock title="account.ts" keepBackground>
              <Pre>{classical}</Pre>
            </CodeBlock>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-fd-primary/40 bg-fd-primary/10 px-3 py-1 text-xs font-medium text-fd-primary">
                With noddde
              </span>
              <span className="text-xs text-fd-muted-foreground">
                decide and evolve; the framework owns the rest
              </span>
            </div>
            <CodeBlock title="account.ts" keepBackground>
              <Pre>{noddde}</Pre>
            </CodeBlock>
          </div>
        </div>

        <div className="mt-12 overflow-hidden rounded-xl border border-fd-border">
          <div className="grid grid-cols-[140px_1fr_1fr] gap-x-4 border-b border-fd-border bg-fd-muted/40 px-6 py-3 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            <div>Step</div>
            <div>Without noddde</div>
            <div>With noddde</div>
          </div>
          {STEPS.map((step, idx) => (
            <div
              key={step.name}
              className={`grid grid-cols-[140px_1fr_1fr] gap-x-4 px-6 py-4 text-sm ${
                idx < STEPS.length - 1 ? "border-b border-fd-border" : ""
              }`}
            >
              <div className="font-semibold text-fd-foreground">
                {step.name}
              </div>
              <div className="leading-relaxed text-fd-muted-foreground">
                {step.without}
              </div>
              <div
                className={`leading-relaxed ${
                  step.byFramework
                    ? "text-fd-foreground"
                    : "text-fd-muted-foreground"
                }`}
              >
                {step.byFramework && (
                  <span className="mr-2 inline-flex items-center rounded-full border border-fd-primary/40 bg-fd-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fd-primary">
                    framework
                  </span>
                )}
                {step.with}
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-fd-muted-foreground">
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
