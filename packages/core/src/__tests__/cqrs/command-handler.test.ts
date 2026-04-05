/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  Command,
  CQRSPorts,
  Ports,
  StandaloneCommand,
  StandaloneCommandHandler,
} from "@noddde/core";

describe("StandaloneCommandHandler", () => {
  interface NotificationPorts extends Ports {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  interface SendNotificationCommand extends StandaloneCommand {
    name: "SendNotification";
    payload: { to: string; body: string };
  }

  type Handler = StandaloneCommandHandler<
    NotificationPorts,
    SendNotificationCommand
  >;

  it("should receive the full command as first parameter", () => {
    expectTypeOf<
      Parameters<Handler>[0]
    >().toEqualTypeOf<SendNotificationCommand>();
  });

  it("should receive ports merged with CQRSPorts", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<
      NotificationPorts & CQRSPorts
    >();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});

describe("StandaloneCommandHandler CQRS access", () => {
  it("should allow dispatching commands via ports", () => {
    const handler: StandaloneCommandHandler<Ports, Command> = async (
      command,
      ports,
    ) => {
      // The handler has access to all three buses
      await ports.commandBus.dispatch({ name: "FollowUp" });
      await ports.eventBus.dispatch({
        name: "Processed",
        payload: {},
      });
      await ports.queryBus.dispatch({
        name: "GetStatus",
        payload: {},
      });
    };
    expect(handler).toBeDefined();
  });
});

describe("StandaloneCommandHandler with empty ports", () => {
  type Handler = StandaloneCommandHandler<Ports, Command>;

  it("should still provide CQRSPorts", () => {
    expectTypeOf<Parameters<Handler>[1]>().toMatchTypeOf<CQRSPorts>();
  });
});
