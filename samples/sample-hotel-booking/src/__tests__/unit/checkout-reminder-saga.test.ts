import { describe, expect, it } from "vitest";
import { testSaga } from "@noddde/testing";
import { InMemoryViewStore } from "@noddde/engine";
import {
  CheckoutReminderSaga,
  type CheckoutReminderState,
} from "../../domain/process-model/checkout-reminder";
import { InMemorySmsService } from "../../infrastructure/services/sms-service";
import { InMemoryRoomAvailabilityViewStore } from "../../infrastructure/services/room-availability-view-store";

describe("CheckoutReminder saga", () => {
  it("should record guest check-in and send welcome SMS", async () => {
    const smsService = new InMemorySmsService();

    const result = await testSaga(CheckoutReminderSaga)
      .when({
        name: "GuestCheckedIn",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedInAt: "2026-04-10T14:00:00Z",
        },
      })
      .withInfrastructure({
        clock: { now: () => new Date() },
        emailService: { send: async () => {} },
        smsService,
        paymentGateway: {
          charge: async () => ({ transactionId: "" }),
          refund: async () => {},
        },
        roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
        guestHistoryViewStore: new InMemoryViewStore(),
        revenueViewStore: new InMemoryViewStore(),
      })
      .execute();

    expect(result.state.status).toBe("guest_checked_in");
    expect(result.state.roomId).toBe("room-101");
    expect(result.state.guestId).toBe("guest-1");
    expect(result.state.bookingId).toBe("b-1");
    expect(result.commands).toHaveLength(0);
    expect(smsService.sent).toHaveLength(1);
    expect(smsService.sent[0]!.phone).toBe("guest-1");
  });

  it("should complete saga and send farewell on GuestCheckedOut", async () => {
    const smsService = new InMemorySmsService();
    const checkedInState: CheckoutReminderState = {
      roomId: "room-101",
      bookingId: "b-1",
      guestId: "guest-1",
      status: "guest_checked_in",
    };

    const result = await testSaga(CheckoutReminderSaga)
      .givenState(checkedInState)
      .when({
        name: "GuestCheckedOut",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkedOutAt: "2026-04-15T11:00:00Z",
        },
      })
      .withInfrastructure({
        clock: { now: () => new Date() },
        emailService: { send: async () => {} },
        smsService,
        paymentGateway: {
          charge: async () => ({ transactionId: "" }),
          refund: async () => {},
        },
        roomAvailabilityViewStore: new InMemoryRoomAvailabilityViewStore(),
        guestHistoryViewStore: new InMemoryViewStore(),
        revenueViewStore: new InMemoryViewStore(),
      })
      .execute();

    expect(result.state.status).toBe("completed");
    expect(result.commands).toHaveLength(0);
    expect(smsService.sent).toHaveLength(1);
    expect(smsService.sent[0]!.message).toContain("Thank you");
  });

  it("should observe RoomCreated without state change or commands", async () => {
    const result = await testSaga(CheckoutReminderSaga)
      .when({
        name: "RoomCreated",
        payload: {
          roomId: "room-101",
          roomNumber: "101",
          type: "single" as const,
          floor: 1,
          pricePerNight: 100,
        },
      })
      .execute();
    expect(result.commands).toHaveLength(0);
  });

  it("should observe RoomMadeAvailable without state change or commands", async () => {
    const result = await testSaga(CheckoutReminderSaga)
      .when({
        name: "RoomMadeAvailable",
        payload: { roomId: "room-101" },
      })
      .execute();
    expect(result.commands).toHaveLength(0);
  });

  it("should observe RoomUnderMaintenance without state change or commands", async () => {
    const result = await testSaga(CheckoutReminderSaga)
      .when({
        name: "RoomUnderMaintenance",
        payload: {
          roomId: "room-101",
          reason: "Plumbing",
          estimatedUntil: "2026-05-01",
        },
      })
      .execute();
    expect(result.commands).toHaveLength(0);
  });

  it("should observe RoomReserved without dispatching commands", async () => {
    const result = await testSaga(CheckoutReminderSaga)
      .when({
        name: "RoomReserved",
        payload: {
          roomId: "room-101",
          bookingId: "b-1",
          guestId: "guest-1",
          checkIn: "2026-04-10",
          checkOut: "2026-04-15",
        },
      })
      .execute();

    expect(result.commands).toHaveLength(0);
  });
});
