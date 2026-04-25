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

describe("UnitOfWork.context", () => {
  it("should expose an optional unknown context", () => {
    expectTypeOf<UnitOfWork["context"]>().toEqualTypeOf<unknown>();
  });

  it("should accept a UoW that omits context", () => {
    const minimal: UnitOfWork = {
      enlist: () => {},
      deferPublish: () => {},
      commit: async () => [],
      rollback: async () => {},
    };
    expectTypeOf(minimal).toMatchTypeOf<UnitOfWork>();
  });

  it("should accept a UoW that exposes context", () => {
    const withCtx: UnitOfWork = {
      context: { tx: "fake" },
      enlist: () => {},
      deferPublish: () => {},
      commit: async () => [],
      rollback: async () => {},
    };
    expectTypeOf(withCtx).toMatchTypeOf<UnitOfWork>();
  });
});
