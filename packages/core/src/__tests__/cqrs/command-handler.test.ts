/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Command,
  CQRSInfrastructure,
  Infrastructure,
  StandaloneCommand,
  StandaloneCommandHandler,
} from "@noddde/core";

describe("StandaloneCommandHandler", () => {
  interface NotificationInfra extends Infrastructure {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  interface SendNotificationCommand extends StandaloneCommand {
    name: "SendNotification";
    payload: { to: string; body: string };
  }

  type Handler = StandaloneCommandHandler<
    NotificationInfra,
    SendNotificationCommand
  >;

  it("should receive the full command as first parameter", () => {
    expectTypeOf<
      Parameters<Handler>[0]
    >().toEqualTypeOf<SendNotificationCommand>();
  });

  it("should receive infrastructure merged with CQRSInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<
      NotificationInfra & CQRSInfrastructure
    >();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});

describe("StandaloneCommandHandler CQRS access", () => {
  it("should allow dispatching commands via infrastructure", () => {
    const handler: StandaloneCommandHandler<Infrastructure, Command> = async (
      command,
      infrastructure,
    ) => {
      // The handler has access to all three buses
      await infrastructure.commandBus.dispatch({ name: "FollowUp" });
      await infrastructure.eventBus.dispatch({
        name: "Processed",
        payload: {},
      });
      await infrastructure.queryBus.dispatch({
        name: "GetStatus",
        payload: {},
      });
    };
    expect(handler).toBeDefined();
  });
});

describe("StandaloneCommandHandler with empty infra", () => {
  type Handler = StandaloneCommandHandler<Infrastructure, Command>;

  it("should still provide CQRSInfrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().toMatchTypeOf<CQRSInfrastructure>();
  });
});
