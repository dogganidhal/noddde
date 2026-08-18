---
"@noddde/kafka": patch
---

Fix `KafkaEventBus` never redelivering a message after a handler failure. kafkajs's `consumer.run()` only auto-restarts a crashed fetch loop when the crash error is marked `retriable`; handler failures rethrown by `_handleMessage` are plain `Error`s, so the consumer crashed permanently instead of redelivering the uncommitted offset, silently breaking the retry/DLQ mechanism. `_handleMessage` now flags those errors `retriable` before rethrowing, and the consumer is created with `retry.restartOnFailure` always resolving `true`, restoring the documented at-least-once redelivery behavior.
