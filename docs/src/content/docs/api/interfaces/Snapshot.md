---
editUrl: false
next: false
prev: false
title: "Snapshot"
---

Defined in: [persistence/snapshot.ts:13](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L13)

A snapshot of an aggregate's state at a specific event stream version. Snapshots are an optimization for event-sourced aggregates.

## Properties

### state

> **state**: `any`

The aggregate state at the time of the snapshot.

---

### version

> **version**: `number`

The event stream version (number of events) at which this snapshot was taken.
