# @noddde/cli

CLI tool for scaffolding noddde DDD aggregates, projections, and sagas.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
# Run directly with npx
npx @noddde/cli new aggregate

# Or install globally
npm install -g @noddde/cli
```

## Usage

The CLI scaffolds new domain modules with the correct folder structure, types, and handler signatures.

```bash
# Scaffold a new aggregate
noddde new aggregate

# Scaffold a new projection
noddde new projection

# Scaffold a new saga
noddde new saga
```

The interactive prompts guide you through naming and configuration. Generated files follow noddde conventions: pure functions, typed events and commands, and the Decider pattern.

## Related Packages

| Package                                                          | Description                                 |
| :--------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)     | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine) | Runtime engine with domain orchestration    |

## License

MIT
