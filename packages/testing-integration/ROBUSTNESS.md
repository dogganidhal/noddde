# Adapter Robustness Follow-Ups

Landing the integration test suite fixed 11 production bugs, but a candid review of what the contracts _don't_ cover surfaced more work. This doc captures the known gaps so they can be tackled deliberately later, rather than getting forgotten.

The list is grouped by urgency:

1. **Workarounds that ship a real bug** — users will hit these.
2. **Coverage gaps** — the contract suite is silent on these areas; behaviour is unverified.
3. **Plausible bugs the suite doesn't exercise** — code paths that look fragile under scrutiny but pass today.

Each item names the symptom, the affected package(s), and a concrete next step.

---

## 1. Workarounds that mask real production bugs

These were "made green" via test-side workarounds because the proper fix is out of scope for a test-landing PR. The bugs are real and should be addressed.

### 1.1 MSSQL TypeORM payloads silently drop supplementary-plane Unicode

- **Affected:** `@noddde/typeorm` + MSSQL
- **Symptom:** Events whose JSON payload contains emoji or any character outside the basic multilingual plane (e.g. `"Café — leave at door 🚪"`) are mangled on save and come back with replacement characters.
- **Root cause:** `NodddeEventEntity.payload` and `NodddeOutboxEntryEntity.event` use `type: "text"`. TypeORM maps that to MSSQL's legacy `TEXT` column type, which is codepage-limited and not Unicode-safe.
- **Workaround in tests:** `mssql.integration.test.ts` passes `unicodeSafe: false` to the persistence contract, which downgrades the Unicode-roundtrip case to ASCII-only.
- **Proper fix:** Use a dialect-aware column type. Two options:
  - Override the `payload`/`event`/`state` columns to `nvarchar(max)` specifically on MSSQL (TypeORM lets you do `@Column({ type: "nvarchar", length: "MAX" })` — verify behaviour on the other three dialects).
  - Or switch to a custom column type with a per-dialect type resolver.
- **Acceptance:** Remove `unicodeSafe: false` from the MSSQL test and run the suite green.

### 1.2 `PrismaAdvisoryLocker` is unsafe with the default Prisma connection pool

- **Affected:** `@noddde/prisma` (Postgres + MySQL/MariaDB)
- **Symptom:** Advisory locks are session-scoped at the database level. Prisma multiplexes queries over an internal connection pool, so `acquire()` may run on session A and `release()` may run on session B. Worst case: a `release()` call succeeds in MySQL with no effect (because the lock isn't held by that session), leaving the original lock held forever.
- **Workaround in tests:** Each Prisma client passed to the locker tests is pinned with `connection_limit=1` in the connection URL.
- **Proper fix:** Two paths:
  - **Recommended:** at `PrismaAdvisoryLocker` construction, inspect the client and either pin to a single connection or throw a startup error pointing the user at `connection_limit=1`.
  - Or expose the same Prisma `$transaction(async (tx) => ...)` callback handle so the locker can guarantee session affinity within a single tx. This changes the locker API but eliminates the footgun.
- **Acceptance:** Test setup no longer needs `connection_limit=1`; the locker either enforces it or surfaces it loudly.

---

## 2. Coverage gaps in the contract suite

_All items in this category have been addressed (failure injection, concurrent saves, scale smoke tests, `deletePublished(olderThan)`, JSON payload edge cases, advisory-lock crash recovery, and handler idempotency)._

---

## 3. Plausible bugs the suite doesn't exercise

Things that look fragile under scrutiny but pass today. Each gets a hypothesis and a test to prove or disprove it.

### 3.1 Drizzle PG outbox time ordering after the timestamp format change

This PR switched Drizzle pg/mysql timestamps from `mode: "date"` to `mode: "string"` and emits `YYYY-MM-DD HH:MM:SS.fff` instead of ISO with `Z`. New deployments are fine. **Mid-migration deployments** that have historical rows in the previous format could see `ORDER BY created_at` produce odd ordering.

**Next step:** document the timestamp-format change as a breaking change in CHANGELOG, and add a migration note. Add a test that mixes old-format and new-format strings and asserts ordering.

### 3.4 Kafka late `on()` after connect is silently broken, but the code pretends it works

`KafkaEventBus.on()` after `connect()` tries to call `consumer.subscribe()`, which kafkajs forbids (`Cannot subscribe to topic while consumer is running`). The current code catches and logs the error with a message claiming "It will be retried on the next on() call" — but there's no retry. The subscription is permanently lost.

The cross-broker contract no longer asserts this works (we moved the late-bind test to pre-connect form). But the adapter still leaks this footgun.

**Next step:** either implement actual late-bind correctly (stop the consumer, subscribe, restart — expensive but correct), or have `on()` throw when called after `connect()` with a topic that isn't already subscribed.

### 3.6 RabbitMQ exchange/queue assertion across config changes

If a user changes `exchangeType` from `"topic"` to `"fanout"` between deployments without manually deleting the exchange, `assertExchange` will throw with PRECONDITION_FAILED. We don't test this.

**Next step:** document the constraint in the package README. Optionally add a test that asserts the failure mode is clear.

---

## 4. Recommended ordering

The coverage-gap follow-ups (§2.1–§2.7) and two of the plausible-bug items (§3.2, §3.5) have landed: failure injection via Toxiproxy, the advisory-lock crash-recovery case, the concurrent-save race, the `deletePublished(olderThan)` coverage, the property-based JSON edge-case sweep, the slow-tagged scale smoke tests, and the handler-idempotency primitive.

Remaining, roughly in priority order:

1. **Section 1 in full** — these are real user-visible bugs.
2. **§3.4 (Kafka late `on()` actually broken)** — silent data loss in a documented public API.
3. The rest as time allows.

---

## Updating this doc

When one of these items is addressed, delete its section from this file and call it out in the PR description. The goal is for this file to shrink to zero, at which point delete the file.
