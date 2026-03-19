// Level 1: Unit harnesses
export { testAggregate, evolveAggregate } from "./aggregate-harness";
export type {
  AggregateTestBuilder,
  AggregateTestBuilderWithCommand,
} from "./aggregate-harness";

export { testProjection } from "./projection-harness";
export type { ProjectionTestBuilder } from "./projection-harness";

export { testSaga } from "./saga-harness";
export type { SagaTestBuilder, SagaTestBuilderWithEvent } from "./saga-harness";

// Level 2: Domain harness
export { testDomain } from "./domain-harness";
export type { TestDomainConfig, TestDomainResult } from "./domain-harness";

// Shared types
export type {
  AggregateTestResult,
  ProjectionTestResult,
  SagaTestResult,
  DomainSpy,
} from "./types";
