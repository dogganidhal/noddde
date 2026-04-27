# @noddde/cli

CLI tool for scaffolding and extending noddde DDD aggregates, projections, and sagas.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
# Run directly with npx
npx @noddde/cli new aggregate

# Or install globally
npm install -g @noddde/cli
```

## Usage

The CLI has three command groups:

### `noddde new` — scaffold new modules

```bash
noddde new project <name>       # full runnable project
noddde new domain <name>        # domain layer only
noddde new aggregate <name>     # single aggregate
noddde new projection <name>    # single projection
noddde new saga <name>          # single saga
```

### `noddde add` — extend existing modules

```bash
noddde add command <name> [--aggregate <name>] [--event <name>]
noddde add query <name> [--projection <name>]
noddde add event-handler <event-name> [--projection <name>]
```

`add` commands generate the new handler files and wire them into the existing barrels, `DefineCommands`/`DefineEvents`/`DefineQueries` unions, and `decide`/`evolve`/`queryHandlers`/`on` maps — no manual import juggling. They're idempotent: running twice leaves files unchanged.

When adding a command, the event name is auto-derived (`PlaceBid` → `BidPlaced`) with interactive confirmation. Override via `--event`. If `--aggregate` or `--projection` is omitted, the CLI prompts you to pick from discovered modules.

Generated files follow noddde conventions: pure functions, typed events and commands, and the Decider pattern.

### `noddde diagram` — flow diagram from a domain

```bash
noddde diagram [domain-file] [--format mermaid|dot|json] [--scope write|read|process|all] [--out path] [--hide-isolated] [--tsconfig path]
```

Reads a domain (defaults to `src/domain/domain.ts`), introspects every aggregate / projection / saga, and emits a flow diagram showing how commands, events, and queries traverse the system. Five edge types come straight from runtime introspection (`Object.keys` on the `decide` / `evolve` / `on` / `queryHandlers` maps); saga-dispatched commands are resolved via the TypeScript compiler API from each saga's `commands` discriminated union.

Output is Mermaid by default — paste into a Markdown preview or commit to GitHub for inline rendering. Solid arrows mark runtime-derived edges, dashed arrows mark statically-resolved (saga → command) edges. Commands a saga dispatches but no aggregate handles are flagged as `external` with a warning.

## Related Packages

| Package                                                          | Description                                 |
| :--------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)     | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine) | Runtime engine with domain orchestration    |

## License

MIT
