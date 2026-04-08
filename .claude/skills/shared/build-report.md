# Build Report Format

Produced by the **Builder** agent after completing Steps 2-4 (generate tests, implement, run tests). Consumed by the **Auditor** agent for independent validation.

## File Location

Written to `specs/reports/<spec-name>.build-report.md` in the working tree. Overwritten on each Builder run.

## Format

```markdown
## Build Report: <spec title>

- **Spec**: <spec-path>
- **Source**: <source-file-path>
- **Tests**: <test-file-path>
- **Result**: GREEN | STUCK
- **Tests passing**: <N>/<M>
- **Loop count**: <number of Step 3-4 iterations>

### Test Results

| Test        | Status      |
| ----------- | ----------- |
| <test name> | PASS / FAIL |

### Concerns

<any issues the Builder flagged during implementation, or "None">

### Stuck Details (only if Result is STUCK)

- **Stuck on**: <test name>
- **Error**: <error message>
- **Attempts**: <list of what was tried>
```

## Rules

- The Builder MUST write this report before signaling completion to the Orchestrator.
- On STUCK, the Builder writes the partial report and signals failure. The Orchestrator decides whether to escalate to the developer.
- The report is a snapshot — it reflects the state at the end of the Builder's run, not intermediate states.
- The Auditor reads this report as context but performs its own independent checks. The report does not substitute for the Auditor's own test execution.
