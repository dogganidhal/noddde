---
"@noddde/testing": patch
---

Fix `testDomain`'s command-bus spy silently swallowing every command dispatch error instead of only the intended "no handler registered" case (#140). A `decide` handler's business-rule violation — including one thrown by a saga reaction command — now rethrows to the caller as it would at runtime, and is recorded on two new `DomainSpy` fields: `unhandledCommands` (commands with no registered handler, the only case still suppressed) and `commandErrors` (`{ command, error }` for every other thrown/rejected dispatch). Both fields are additive — existing `publishedEvents`/`dispatchedCommands` are unchanged.
