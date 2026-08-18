## Build Report: OutboxRelay

- **Spec**: specs/engine/outbox-relay.spec.md
- **Source**: packages/engine/src/outbox-relay.ts
- **Tests**: packages/engine/src/**tests**/engine/outbox-relay.test.ts
- **Result**: GREEN
- **Tests passing**: 8/8
- **Loop count**: 1

### Test Results

| Test                                                                                                  | Status |
| ----------------------------------------------------------------------------------------------------- | ------ |
| should dispatch each unpublished entry and mark it published                                          | PASS   |
| should return 0 when there are no unpublished entries                                                 | PASS   |
| should mark all entries published even when a handler throws — handler errors are isolated by the bus | PASS   |
| should poll at the configured interval and stop when told                                             | PASS   |
| should not create multiple timers when start is called twice                                          | PASS   |
| should catch a rejecting loadUnpublished, log it, and return 0                                        | PASS   |
| should not leave an unhandled rejection when the interval callback fires                              | PASS   |
| should process at most batchSize entries per call                                                     | PASS   |

### Concerns

None.
