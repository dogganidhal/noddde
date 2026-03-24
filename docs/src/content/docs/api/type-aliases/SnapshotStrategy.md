---
editUrl: false
next: false
prev: false
title: "SnapshotStrategy"
---

> **SnapshotStrategy** = (`context`) => `boolean`

Defined in: [persistence/snapshot.ts:64](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L64)

Strategy function that decides whether to take a snapshot after processing a command. Called by the domain engine after each successful event-sourced command dispatch.

## Parameters

### context

> **context**: `object`

#### context.version

`number` - Current event stream version.

#### context.lastSnapshotVersion

`number` - Version at which the last snapshot was taken (0 if none).

#### context.eventsSinceSnapshot

`number` - Number of events since the last snapshot.

## Returns

`boolean` - `true` to take a snapshot, `false` to skip.
