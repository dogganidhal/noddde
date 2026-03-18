import { describe, it, expectTypeOf } from "vitest";
import type { UnitOfWork, UnitOfWorkFactory, Event } from "@noddde/core";

describe("UnitOfWork Interface", () => {
  it("should have enlist accepting an async thunk", () => {
    expectTypeOf<UnitOfWork["enlist"]>().toBeFunction();
    expectTypeOf<UnitOfWork["enlist"]>()
      .parameter(0)
      .toMatchTypeOf<() => Promise<void>>();
  });

  it("should have deferPublish accepting spread events", () => {
    expectTypeOf<UnitOfWork["deferPublish"]>().toBeFunction();
    expectTypeOf<UnitOfWork["deferPublish"]>().parameters.toMatchTypeOf<
      Event[]
    >();
  });

  it("should have commit returning Promise of Event array", () => {
    expectTypeOf<UnitOfWork["commit"]>().toBeFunction();
    expectTypeOf<UnitOfWork["commit"]>().returns.toMatchTypeOf<
      Promise<Event[]>
    >();
  });

  it("should have rollback returning Promise of void", () => {
    expectTypeOf<UnitOfWork["rollback"]>().toBeFunction();
    expectTypeOf<UnitOfWork["rollback"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});

describe("UnitOfWorkFactory", () => {
  it("should be a function returning a UnitOfWork", () => {
    expectTypeOf<UnitOfWorkFactory>().toBeFunction();
    expectTypeOf<UnitOfWorkFactory>().returns.toMatchTypeOf<UnitOfWork>();
  });
});
