---
title: Defining Aggregates
description: How to define domain aggregates with state, commands, and events
---

## Overview

Aggregates are the core building block in noddde. They encapsulate state, handle commands, and produce events following the Decider pattern:

- **`initialState`** — The starting state for a new aggregate
- **`commands`** — Handlers that decide which events to emit based on the current state
- **`apply`** — Pure reducers that evolve the state from events

## defineAggregate

Use `defineAggregate<T>()` to create a fully typed aggregate definition.

<!-- TODO: Detailed examples with AggregateTypes, CommandHandler, ApplyHandler -->
