import {
  Eye,
  GitBranch,
  History,
  ShieldCheck,
  Split,
  Workflow,
} from "lucide-react";
import { FeatureCard } from "./feature-card";

const features = [
  {
    icon: <GitBranch className="size-5" />,
    title: "Decider Pattern",
    description:
      "Pure functions for state transitions. initialState + decide + evolve — nothing else.",
  },
  {
    icon: <Split className="size-5" />,
    title: "CQRS",
    description:
      "Separate command and query models with dedicated buses and handlers.",
  },
  {
    icon: <History className="size-5" />,
    title: "Event Sourcing",
    description:
      "Full audit trail of state changes. Replay and rebuild state from events.",
  },
  {
    icon: <Eye className="size-5" />,
    title: "Projections",
    description:
      "Materialized read models built from event streams, always up to date.",
  },
  {
    icon: <Workflow className="size-5" />,
    title: "Sagas",
    description:
      "Coordinate long-running business processes across aggregates.",
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: "Type-Safe",
    description:
      "Full TypeScript inference from end to end. Zero decorators. Zero runtime magic.",
  },
];

export function Features() {
  return (
    <section className="border-t border-fd-border py-16 lg:py-24">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-fd-foreground">
          Everything you need to model your domain
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-fd-muted-foreground">
          Aggregates, projections, and sagas — using plain objects and pure
          functions. No base classes. No decorators. No DI container.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
