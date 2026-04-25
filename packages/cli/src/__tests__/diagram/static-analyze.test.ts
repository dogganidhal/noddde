import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { analyzeSagaCommands } from "../../diagram/static-analyze.js";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const hotelEntry = path.join(
  REPO_ROOT,
  "samples/sample-hotel-booking/src/domain/domain.ts",
);

describe("analyzeSagaCommands", () => {
  it("returns an empty result when no saga keys are passed", () => {
    const result = analyzeSagaCommands(hotelEntry, []);
    expect(result.commands.size).toBe(0);
    expect(result.unresolved).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("extracts the BookingCommand | RoomCommand union for BookingFulfillment", () => {
    const result = analyzeSagaCommands(hotelEntry, ["BookingFulfillment"]);
    const cmds = result.commands.get("BookingFulfillment");

    expect(cmds).toBeDefined();
    // BookingCommand union members:
    expect(cmds).toContain("ConfirmBooking");
    expect(cmds).toContain("CancelBooking");
    expect(cmds).toContain("CreateBooking");
    // RoomCommand union members:
    expect(cmds).toContain("ReserveRoom");
    expect(cmds).toContain("CheckInGuest");
  });

  it("warns when a saga key is not present on the entry's `sagas` export", () => {
    const result = analyzeSagaCommands(hotelEntry, ["NotARealSaga"]);
    expect(result.unresolved).toContain("NotARealSaga");
    expect(result.warnings.some((w) => w.includes("NotARealSaga"))).toBe(true);
  });
});
