/**
 * Internal toolkit for noddde adapter integration tests.
 *
 * Two pillars:
 * 1. `containers/*`  — thin helpers around testcontainers for each backend
 *    (Postgres, MySQL, MSSQL, Kafka, NATS, RabbitMQ).
 * 2. `contracts/*`   — shared `defineContract(...)` test suites every adapter
 *    re-uses by passing in its own factory. This keeps "the rules of being a
 *    persistence/event-bus adapter" centralized.
 */
export * from "./containers/index.js";
export * from "./contracts/persistence-contract.js";
export * from "./contracts/outbox-contract.js";
export * from "./contracts/scale-contract.js";
export * from "./contracts/saga-contract.js";
export * from "./contracts/snapshot-contract.js";
export * from "./contracts/unit-of-work-contract.js";
export * from "./contracts/advisory-locker-contract.js";
export * from "./contracts/event-reader-contract.js";
export * from "./contracts/event-bus-contract.js";
export * from "./utils.js";
