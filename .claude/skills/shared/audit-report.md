# Audit Report Format

Produced by the **Auditor** agent after completing Steps 5-6 (validate, update docs). Consumed by the **Orchestrator** to decide next action (report success, re-run Builder, or escalate to developer).

## File Location

Written to `specs/reports/<spec-name>.audit-report.md` in the working tree. Overwritten on each Auditor run.

## Format

```markdown
## Audit Report: <spec title>

- **Verdict**: PASS | FAIL | CONCERN
- **Cycle**: <1 or 2 — which Builder-Auditor iteration this is>

### Mechanical Checks

| Check               | Result    | Details                 |
| ------------------- | --------- | ----------------------- |
| Export coverage     | PASS/FAIL | <N>/<M> exports present |
| Stubs remaining     | PASS/FAIL | <count> stubs found     |
| Type check          | PASS/FAIL | <error count>           |
| Tests               | PASS/FAIL | <N>/<M> passing         |
| Invariants enforced | PASS/FAIL | <N>/<M> enforced        |
| Edge cases covered  | PASS/FAIL | <N>/<M> covered         |

### Coherence Review

- **Spec intent alignment**: <Does the implementation match the spec's intent, or does it merely game the tests? Specific observations.>
- **Unhandled scenarios**: <Edge cases or requirements the spec describes but the implementation doesn't fully address. List or "None".>
- **Convention compliance**: <Does the code follow the project's functional style, naming, JSDoc, handler signatures? Specific issues or "Compliant".>
- **Breaking change propagation**: <For breaking changes: were ALL downstream specs and samples updated? "N/A" if no breaking changes. Otherwise: "Complete" or list what was missed.>

### Documentation

- **Pages updated**: <count>
- **Pages created**: <count>
- **API reference updated**: <count>

### Findings (on FAIL or CONCERN)

For each finding:

1. **[MECHANICAL|DESIGN]** <description>
   - **Location**: <file:line>
   - **Fix**: <actionable guidance for the Builder or developer>
```

## Verdicts

- **PASS**: All mechanical checks pass AND coherence review found no issues. Pipeline complete.
- **FAIL**: Mechanical check failures OR design coherence issues that the Builder can fix. Re-run Builder with findings (up to 2 cycles).
- **CONCERN**: Issues that require developer judgment — ambiguous spec intent, architectural trade-offs, or problems the Auditor cannot confidently classify. Escalate to developer.

## Rules

- The Auditor MUST write this report before signaling completion to the Orchestrator.
- MECHANICAL findings are fixable by the Builder without developer input.
- DESIGN findings may require spec revision (Orchestrator handles this).
- CONCERN findings always go to the developer — the Auditor does not have authority to resolve ambiguity.
- The Auditor caps at 2 cycles. If the Builder has already been re-run once and issues persist, the verdict escalates to CONCERN regardless.
- Findings must be specific and actionable. "Code could be better" is not a finding. "Function X at file:line returns undefined for empty input but spec requires empty array" is.
