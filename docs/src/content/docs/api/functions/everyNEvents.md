---
editUrl: false
next: false
prev: false
title: "everyNEvents"
---

> **everyNEvents**(`n`): [`SnapshotStrategy`](/api/type-aliases/snapshotstrategy/)

Defined in: [persistence/snapshot.ts:114](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L114)

Creates a snapshot strategy that triggers every N events since the last snapshot.

## Parameters

### n

`number` - The number of events between snapshots. Must be >= 1.

## Returns

[`SnapshotStrategy`](/api/type-aliases/snapshotstrategy/)
