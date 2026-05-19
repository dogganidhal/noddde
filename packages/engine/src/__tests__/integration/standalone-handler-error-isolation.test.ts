// Integration test for standalone event handler error isolation
// From specs/core/edd/event-handler.spec.md

import { describe, expect, it, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

// ### Failing standalone event handler does not affect sibling handlers nor the dispatcher
describe("Standalone event handler error isolation", () => {
  it("should keep the command successful and still invoke sibling handlers when one throws", async () => {
    const healthyHandler = vi.fn();
    const bus = new EventEmitterEventBus();

    bus.on("UserCreated", async () => {
      throw new Error("handler bug");
    });
    bus.on("UserCreated", healthyHandler);

    // dispatch must not reject even though the first handler throws
    await expect(
      bus.dispatch({
        name: "UserCreated",
        payload: { id: "u-1", name: "Alice" },
      }),
    ).resolves.not.toThrow();

    // The sibling handler was still invoked with the event.
    expect(healthyHandler).toHaveBeenCalledOnce();
    expect(healthyHandler.mock.calls[0]![0]).toMatchObject({
      name: "UserCreated",
      payload: { id: "u-1", name: "Alice" },
    });
  });
});
