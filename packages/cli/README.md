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

The CLI has two command groups:

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

## Related Packages

| Package                                                          | Description                                 |
| :--------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)     | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine) | Runtime engine with domain orchestration    |

## License

MIT
