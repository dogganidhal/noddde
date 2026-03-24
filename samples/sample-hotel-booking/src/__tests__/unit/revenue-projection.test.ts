import { describe, expect, it } from "vitest";
import { testProjection } from "@noddde/testing";
import { RevenueProjection } from "../../domain/read-model/projections/revenue";

describe("Revenue projection", () => {
  it("should aggregate revenue from a single payment", async () => {
    const result = await testProjection(RevenueProjection)
      .initialView({ date: "", totalRevenue: 0, bookingCount: 0 })
      .given({
        name: "PaymentCompleted",
        payload: {
          bookingId: "b-1",
          paymentId: "pay-1",
          transactionId: "txn-1",
          amount: 500,
          completedAt: "2026-04-10T14:00:00Z",
        },
      })
      .execute();

    expect(result.view).toMatchObject({
      date: "2026-04-10",
      totalRevenue: 500,
      bookingCount: 1,
    });
  });

  it("should accumulate revenue from multiple payments on the same day", async () => {
    const result = await testProjection(RevenueProjection)
      .initialView({ date: "", totalRevenue: 0, bookingCount: 0 })
      .given(
        {
          name: "PaymentCompleted",
          payload: {
            bookingId: "b-1",
            paymentId: "pay-1",
            transactionId: "txn-1",
            amount: 500,
            completedAt: "2026-04-10T10:00:00Z",
          },
        },
        {
          name: "PaymentCompleted",
          payload: {
            bookingId: "b-2",
            paymentId: "pay-2",
            transactionId: "txn-2",
            amount: 300,
            completedAt: "2026-04-10T16:00:00Z",
          },
        },
      )
      .execute();

    expect(result.view.totalRevenue).toBe(800);
    expect(result.view.bookingCount).toBe(2);
    expect(result.view.date).toBe("2026-04-10");
  });
});
