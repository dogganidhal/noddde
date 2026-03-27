/* eslint-disable no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents, Event } from "@noddde/core";
import {
  defineAggregate,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySnapshotStore,
} from "@noddde/engine";
import { everyNEvents } from "@noddde/core";

// ---- V2 aggregate: current schema has `status` on Created ----

type AccountState = {
  id: string | null;
  owner: string | null;
  status: "active" | "closed";
  balance: number;
};

type AccountEvent = DefineEvents<{
  AccountCreated: { id: string; owner: string; status: "active" | "closed" };
  DepositMade: { amount: number; currency: string };
}>;

type AccountCommand = DefineCommands<{
  CreateAccount: { owner: string };
  Deposit: { amount: number };
}>;

type AccountTypes = {
  state: AccountState;
  events: AccountEvent;
  commands: AccountCommand;
  infrastructure: {};
};

// V1 payload types (historical)
type AccountCreatedV1 = { id: string; owner: string };
type DepositMadeV1 = { amount: number };

const accountUpcasters = defineUpcasters<AccountEvent>({
  AccountCreated: defineEventUpcasterChain<
    [
      AccountCreatedV1,
      { id: string; owner: string; status: "active" | "closed" },
    ]
  >((v1) => ({ ...v1, status: "active" as const })),
  DepositMade: defineEventUpcasterChain<
    [DepositMadeV1, { amount: number; currency: string }]
  >((v1) => ({ ...v1, currency: "USD" })),
});

const Account = defineAggregate<AccountTypes>({
  initialState: { id: null, owner: null, status: "active", balance: 0 },
  commands: {
    CreateAccount: (command) => ({
      name: "AccountCreated",
      payload: {
        id: command.targetAggregateId,
        owner: command.payload.owner,
        status: "active" as const,
      },
    }),
    Deposit: (command) => ({
      name: "DepositMade",
      payload: {
        amount: command.payload.amount,
        currency: "USD",
      },
    }),
  },
  apply: {
    AccountCreated: (payload, state) => ({
      ...state,
      id: payload.id,
      owner: payload.owner,
      status: payload.status,
    }),
    DepositMade: (payload, state) => ({
      ...state,
      balance: state.balance + payload.amount,
    }),
  },
  upcasters: accountUpcasters,
});

// ---- Helper: create domain wiring with shared persistence ----

function createDomainWiring(
  persistence: InMemoryEventSourcedAggregatePersistence,
  snapshotStore?: InMemorySnapshotStore,
) {
  return {
    aggregates: {
      persistence: () => persistence,
      ...(snapshotStore
        ? {
            snapshots: {
              store: () => snapshotStore,
              strategy: everyNEvents(3),
            },
          }
        : {}),
    },
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),
  } as const;
}

// ---- Test scenarios ----

describe("Event upcasting integration", () => {
  describe("Replaying v1 events through upcaster chain", () => {
    it("should upcast v1 events during aggregate rehydration and rebuild correct state", async () => {
      const persistence = new InMemoryEventSourcedAggregatePersistence();

      // Simulate v1 events already in the store (no metadata.version)
      const v1Events: Event[] = [
        {
          name: "AccountCreated",
          payload: { id: "acc-1", owner: "Alice" }, // V1: no status
          metadata: {
            eventId: "evt-1",
            timestamp: "2024-01-01T00:00:00.000Z",
            correlationId: "corr-1",
            causationId: "CreateAccount",
            aggregateName: "Account",
            aggregateId: "acc-1",
            sequenceNumber: 1,
            // No version field — treated as v1
          },
        },
        {
          name: "DepositMade",
          payload: { amount: 100 }, // V1: no currency
          metadata: {
            eventId: "evt-2",
            timestamp: "2024-01-01T00:01:00.000Z",
            correlationId: "corr-1",
            causationId: "Deposit",
            aggregateName: "Account",
            aggregateId: "acc-1",
            sequenceNumber: 2,
          },
        },
      ];

      // Pre-populate the persistence with v1 events
      await persistence.save("Account", "acc-1", v1Events, 0);

      const definition = defineDomain({
        writeModel: { aggregates: { Account } },
        readModel: { projections: {} },
      });

      // Boot the domain with the v2 aggregate (which has upcasters)
      const domain = await wireDomain(
        definition,
        createDomainWiring(persistence),
      );

      // Dispatch a new command — this forces replay of the 2 v1 events
      // through the upcaster chain, then applies the new command
      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "acc-1",
        payload: { amount: 50 },
      });

      // Verify: 3 events total (2 original + 1 new)
      const events = await persistence.load("Account", "acc-1");
      expect(events).toHaveLength(3);

      // The original v1 events in persistence are unchanged (upcasting is in-memory only)
      expect(events[0]!.payload).toEqual({ id: "acc-1", owner: "Alice" });
      expect(events[1]!.payload).toEqual({ amount: 100 });

      // The new event has the current schema (v2)
      expect(events[2]!.payload).toEqual({ amount: 50, currency: "USD" });
    });
  });

  describe("Version stamping on new events", () => {
    it("should set metadata.version on new events matching the upcaster chain version", async () => {
      const persistence = new InMemoryEventSourcedAggregatePersistence();

      const definition = defineDomain({
        writeModel: { aggregates: { Account } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(
        definition,
        createDomainWiring(persistence),
      );

      await domain.dispatchCommand({
        name: "CreateAccount",
        targetAggregateId: "acc-1",
        payload: { owner: "Bob" },
      });

      const events = await persistence.load("Account", "acc-1");
      expect(events).toHaveLength(1);

      // AccountCreated has a 1-step chain → current version = 2
      expect(events[0]!.metadata!.version).toBe(2);
    });

    it("should stamp version on all event types with upcasters", async () => {
      const persistence = new InMemoryEventSourcedAggregatePersistence();

      const definition = defineDomain({
        writeModel: { aggregates: { Account } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(
        definition,
        createDomainWiring(persistence),
      );

      await domain.dispatchCommand({
        name: "CreateAccount",
        targetAggregateId: "acc-1",
        payload: { owner: "Bob" },
      });

      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "acc-1",
        payload: { amount: 200 },
      });

      const events = await persistence.load("Account", "acc-1");
      expect(events).toHaveLength(2);

      // AccountCreated: 1-step chain → version 2
      expect(events[0]!.metadata!.version).toBe(2);
      // DepositMade: 1-step chain → version 2
      expect(events[1]!.metadata!.version).toBe(2);
    });
  });

  describe("Upcasting with snapshots", () => {
    it("should upcast post-snapshot events correctly", async () => {
      const persistence = new InMemoryEventSourcedAggregatePersistence();
      const snapshotStore = new InMemorySnapshotStore();

      // Simulate: 3 v1 events were persisted, and a snapshot was taken at version 3
      const v1Events: Event[] = [
        {
          name: "AccountCreated",
          payload: { id: "acc-1", owner: "Alice" },
          metadata: {
            eventId: "evt-1",
            timestamp: "2024-01-01T00:00:00.000Z",
            correlationId: "corr-1",
            causationId: "CreateAccount",
            aggregateName: "Account",
            aggregateId: "acc-1",
            sequenceNumber: 1,
          },
        },
        {
          name: "DepositMade",
          payload: { amount: 100 },
          metadata: {
            eventId: "evt-2",
            timestamp: "2024-01-01T00:01:00.000Z",
            correlationId: "corr-2",
            causationId: "Deposit",
            aggregateName: "Account",
            aggregateId: "acc-1",
            sequenceNumber: 2,
          },
        },
        {
          name: "DepositMade",
          payload: { amount: 200 },
          metadata: {
            eventId: "evt-3",
            timestamp: "2024-01-01T00:02:00.000Z",
            correlationId: "corr-3",
            causationId: "Deposit",
            aggregateName: "Account",
            aggregateId: "acc-1",
            sequenceNumber: 3,
          },
        },
      ];

      await persistence.save("Account", "acc-1", v1Events, 0);

      // Snapshot was taken at version 2 (after AccountCreated + first Deposit)
      // State at that point reflects v1 schema applied (status was already
      // present via apply handler defaults, but this tests the post-snapshot
      // event upcasting path)
      await snapshotStore.save("Account", "acc-1", {
        state: { id: "acc-1", owner: "Alice", status: "active", balance: 100 },
        version: 2,
      });

      const definition = defineDomain({
        writeModel: { aggregates: { Account } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(
        definition,
        createDomainWiring(persistence, snapshotStore),
      );

      // Dispatch a new command — engine loads snapshot (version 2),
      // then replays post-snapshot events (the 3rd event at index 2),
      // which is a v1 DepositMade that needs upcasting
      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "acc-1",
        payload: { amount: 50 },
      });

      // 4 events total
      const events = await persistence.load("Account", "acc-1");
      expect(events).toHaveLength(4);

      // New event has version stamped
      expect(events[3]!.metadata!.version).toBe(2);
      expect(events[3]!.payload).toEqual({ amount: 50, currency: "USD" });
    });
  });

  describe("Multi-step upcaster chain integration", () => {
    it("should apply multi-step chains when replaying old events", async () => {
      // 3-version aggregate: v1 → v2 → v3
      type ItemState = { name: string; price: number; currency: string };

      type ItemEvent = DefineEvents<{
        ItemCreated: { name: string; price: number; currency: string };
      }>;

      type ItemCommand = DefineCommands<{
        CreateItem: { name: string };
      }>;

      type ItemTypes = {
        state: ItemState;
        events: ItemEvent;
        commands: ItemCommand;
        infrastructure: {};
      };

      type ItemCreatedV1 = { name: string };
      type ItemCreatedV2 = { name: string; price: number };
      type ItemCreatedV3 = { name: string; price: number; currency: string };

      const Item = defineAggregate<ItemTypes>({
        initialState: { name: "", price: 0, currency: "USD" },
        commands: {
          CreateItem: (command) => ({
            name: "ItemCreated",
            payload: {
              name: command.payload.name,
              price: 0,
              currency: "USD",
            },
          }),
        },
        apply: {
          ItemCreated: (payload) => ({
            name: payload.name,
            price: payload.price,
            currency: payload.currency,
          }),
        },
        upcasters: defineUpcasters<ItemEvent>({
          ItemCreated: defineEventUpcasterChain<
            [ItemCreatedV1, ItemCreatedV2, ItemCreatedV3]
          >(
            (v1) => ({ ...v1, price: 0 }),
            (v2) => ({ ...v2, currency: "USD" }),
          ),
        }),
      });

      const persistence = new InMemoryEventSourcedAggregatePersistence();

      // Pre-populate with a v1 event (no version in metadata)
      await persistence.save(
        "Item",
        "item-1",
        [
          {
            name: "ItemCreated",
            payload: { name: "Widget" }, // V1: only name
            metadata: {
              eventId: "evt-1",
              timestamp: "2024-01-01T00:00:00.000Z",
              correlationId: "corr-1",
              causationId: "CreateItem",
              aggregateName: "Item",
              aggregateId: "item-1",
              sequenceNumber: 1,
            },
          },
        ],
        0,
      );

      const definition = defineDomain({
        writeModel: { aggregates: { Item } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(definition, {
        aggregates: { persistence: () => persistence },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      });

      // Dispatch another command — triggers replay of the v1 event
      // through the 2-step upcaster chain (v1→v2→v3)
      await domain.dispatchCommand({
        name: "CreateItem",
        targetAggregateId: "item-1",
        payload: { name: "Gadget" },
      });

      const events = await persistence.load("Item", "item-1");
      expect(events).toHaveLength(2);

      // New event should have version 3 (2-step chain → version = 3)
      expect(events[1]!.metadata!.version).toBe(3);
    });
  });

  describe("Partial upcasting for intermediate versions", () => {
    it("should only apply remaining steps for events at an intermediate version", async () => {
      // Aggregate with a 2-step chain (v1→v2→v3)
      type TagState = { label: string; color: string; priority: number };

      type TagEvent = DefineEvents<{
        TagCreated: { label: string; color: string; priority: number };
      }>;

      type TagCommand = DefineCommands<{
        CreateTag: { label: string };
      }>;

      type TagTypes = {
        state: TagState;
        events: TagEvent;
        commands: TagCommand;
        infrastructure: {};
      };

      type TagV1 = { label: string };
      type TagV2 = { label: string; color: string };
      type TagV3 = { label: string; color: string; priority: number };

      const Tag = defineAggregate<TagTypes>({
        initialState: { label: "", color: "gray", priority: 0 },
        commands: {
          CreateTag: (command) => ({
            name: "TagCreated",
            payload: {
              label: command.payload.label,
              color: "gray",
              priority: 0,
            },
          }),
        },
        apply: {
          TagCreated: (payload) => ({
            label: payload.label,
            color: payload.color,
            priority: payload.priority,
          }),
        },
        upcasters: defineUpcasters<TagEvent>({
          TagCreated: defineEventUpcasterChain<[TagV1, TagV2, TagV3]>(
            (v1) => ({ ...v1, color: "gray" }),
            (v2) => ({ ...v2, priority: 0 }),
          ),
        }),
      });

      const persistence = new InMemoryEventSourcedAggregatePersistence();

      // Pre-populate with a v2 event (has version: 2 in metadata)
      await persistence.save(
        "Tag",
        "tag-1",
        [
          {
            name: "TagCreated",
            payload: { label: "important", color: "red" }, // V2: has color, no priority
            metadata: {
              eventId: "evt-1",
              timestamp: "2024-01-01T00:00:00.000Z",
              correlationId: "corr-1",
              causationId: "CreateTag",
              aggregateName: "Tag",
              aggregateId: "tag-1",
              sequenceNumber: 1,
              version: 2, // Explicitly v2
            },
          },
        ],
        0,
      );

      const definition = defineDomain({
        writeModel: { aggregates: { Tag } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(definition, {
        aggregates: { persistence: () => persistence },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      });

      // Dispatch a command — replays the v2 event, which should only apply
      // step 2 (v2→v3, adding priority), NOT step 1 (v1→v2)
      await domain.dispatchCommand({
        name: "CreateTag",
        targetAggregateId: "tag-1",
        payload: { label: "urgent" },
      });

      const events = await persistence.load("Tag", "tag-1");
      expect(events).toHaveLength(2);

      // The new event should be version 3
      expect(events[1]!.metadata!.version).toBe(3);
    });
  });

  describe("Domain.init() upcaster chain validation", () => {
    it("should reject invalid upcaster chains at init time", async () => {
      const InvalidAggregate = defineAggregate<AccountTypes>({
        initialState: { id: null, owner: null, status: "active", balance: 0 },
        commands: {
          CreateAccount: (command) => ({
            name: "AccountCreated",
            payload: {
              id: command.targetAggregateId,
              owner: command.payload.owner,
              status: "active" as const,
            },
          }),
          Deposit: (command) => ({
            name: "DepositMade",
            payload: { amount: command.payload.amount, currency: "USD" },
          }),
        },
        apply: {
          AccountCreated: (payload, state) => ({
            ...state,
            id: payload.id,
            owner: payload.owner,
            status: payload.status,
          }),
          DepositMade: (payload, state) => ({
            ...state,
            balance: state.balance + payload.amount,
          }),
        },
        // Intentionally invalid: not an array of functions
        upcasters: {
          AccountCreated: "not-an-array" as any,
        },
      });

      const definition = defineDomain({
        writeModel: { aggregates: { InvalidAggregate } },
        readModel: { projections: {} },
      });

      await expect(
        wireDomain(definition, {
          aggregates: {
            persistence: () => new InMemoryEventSourcedAggregatePersistence(),
          },
          buses: () => ({
            commandBus: new InMemoryCommandBus(),
            eventBus: new EventEmitterEventBus(),
            queryBus: new InMemoryQueryBus(),
          }),
        }),
      ).rejects.toThrow(/Invalid upcaster chain/);
    });
  });

  describe("Events dispatched on the bus have version metadata", () => {
    it("should publish version-stamped events on the event bus", async () => {
      const persistence = new InMemoryEventSourcedAggregatePersistence();
      const eventBus = new EventEmitterEventBus();
      const dispatchSpy = vi.spyOn(eventBus, "dispatch");

      const definition = defineDomain({
        writeModel: { aggregates: { Account } },
        readModel: { projections: {} },
      });

      const domain = await wireDomain(definition, {
        aggregates: { persistence: () => persistence },
        buses: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus,
          queryBus: new InMemoryQueryBus(),
        }),
      });

      await domain.dispatchCommand({
        name: "CreateAccount",
        targetAggregateId: "acc-1",
        payload: { owner: "Alice" },
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AccountCreated",
          metadata: expect.objectContaining({
            version: 2,
          }),
        }),
      );
    });
  });
});
