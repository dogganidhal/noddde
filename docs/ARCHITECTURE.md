# noddde Architecture & Design Philosophy

## What noddde Is

A TypeScript framework for building business applications with Domain-Driven Design (DDD), CQRS, and Event Sourcing. It implements the functional Decider pattern where domain logic is expressed as data (plain objects and pure functions), not class hierarchies.

## Target Audience

Teams building event-sourced business applications in TypeScript — particularly those who value:

- Compile-time correctness over runtime discovery
- Explicit data flow over magic (decorators, reflection, DI containers)
- Testability through pure functions
- Progressive complexity (start simple, add sophistication only when needed)

## Design Priorities (ordered)

1. **Type safety** — The type system should catch incorrect wiring at compile time, not at runtime. If a decide handler returns the wrong event type, `tsc` should reject it.
2. **Explicitness** — No hidden behavior. Infrastructure is passed as function parameters. Handlers are plain functions. Configuration is a data object.
3. **Testability** — Domain logic (decide handlers, evolve handlers) must be testable without infrastructure. Pure functions in, assertions out.
4. **Simplicity** — Minimize concepts. The Decider pattern (initialState + decide + evolve) is the only pattern for aggregates. No competing abstractions.
5. **Composability** — Small, focused interfaces that combine. Two persistence strategies, not a universal adapter. Buses are interfaces, not base classes.

## Anti-Goals (What NOT to Build)

- **No decorator-based API** — Decorators hide behavior, break tree-shaking, and fight TypeScript's type inference. Use typed objects instead.
- **No service locator / DI container** — Infrastructure injection is explicit function parameters. No `@Inject()`, no container.resolve().
- **No base classes for domain concepts** — No `extends AggregateRoot`. Aggregates are configuration objects, not class instances. Classes are only for infrastructure implementations.
- **No runtime reflection** — Don't use `reflect-metadata` or similar. The type system does the work.
- **No opinionated transport** — noddde is not an HTTP framework. It provides buses and persistence; the user chooses how to wire HTTP/gRPC/etc.
- **No multi-tenancy built-in** — Keep the core simple. Multi-tenancy is an infrastructure concern handled by the user's persistence layer.

## Key Architectural Decisions

Detailed rationale lives in `docs/content/docs/design-decisions/`:

| Decision                       | Summary                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| Why Decider                    | Functional pattern (initialState + decide + evolve) vs class hierarchies |
| Why AggregateTypes             | Named type bundle vs 4+ positional generics                              |
| Why Commands Return Events     | Direct event emission, not side effects                                  |
| Why DefineCommands/Events      | Mapped type builders for discriminated unions                            |
| Why ID Not in State            | ID as aggregate coordinate, separate from payload                        |
| Why Injectable Infrastructure  | Function parameters vs DI containers                                     |
| Why Pure Evolve Handlers       | Deterministic replay guarantee                                           |
| Why Sagas Return Commands      | State machines, not orchestrators                                        |
| Why Two Persistence Strategies | Event sourcing vs state snapshots, swappable                             |

## Competitive Context

noddde occupies a specific niche compared to alternatives:

- **vs Axon Framework (Java)**: noddde is TypeScript-native, functional, no annotations. Axon is Java, class-based, annotation-heavy.
- **vs EventStoreDB client**: EventStoreDB is an event store database. noddde is a framework that can use any event store (including EventStoreDB).
- **vs NestJS CQRS module**: NestJS CQRS uses decorators, DI, and class-based commands/events. noddde uses plain objects and pure functions.
- **vs custom implementations**: noddde provides the patterns and types so teams don't reinvent discriminated unions, aggregate wiring, and saga orchestration.

## Production Readiness

See `ROADMAP.md` for the full roadmap. Current state:

- API surface: complete
- In-memory runtime: complete
- Persistence adapters: complete (Drizzle, Prisma, TypeORM with transaction support)
- Concurrency control: complete (optimistic with retries, pessimistic with advisory locks)
- Event metadata: complete (auto-enrichment, correlation propagation through sagas)
- Snapshotting: complete (configurable strategies, partial event loading)
- Idempotent commands: complete (commandId deduplication with TTL)
- Remaining gaps: projection rebuild, observability, distributed systems support (see ROADMAP.md)
