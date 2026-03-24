import { randomUUID } from "crypto";
import type { PaymentGateway } from "../types";

/** Always succeeds — for development and demo. */
export class FakePaymentGateway implements PaymentGateway {
  /* eslint-disable no-unused-vars */
  async charge(
    _guestId: string,
    _amount: number,
  ): Promise<{ transactionId: string }> {
    /* eslint-enable no-unused-vars */
    return { transactionId: `txn-${randomUUID()}` };
  }

  // eslint-disable-next-line no-unused-vars
  async refund(_transactionId: string): Promise<void> {
    // no-op
  }
}

/** Captures charges/refunds in memory — for tests. */
export class InMemoryPaymentGateway implements PaymentGateway {
  public readonly charges: Array<{
    guestId: string;
    amount: number;
    transactionId: string;
  }> = [];
  public readonly refunds: Array<{ transactionId: string }> = [];
  public shouldFail = false;

  async charge(
    guestId: string,
    amount: number,
  ): Promise<{ transactionId: string }> {
    if (this.shouldFail) {
      throw new Error("Payment declined");
    }
    const transactionId = `txn-${randomUUID()}`;
    this.charges.push({ guestId, amount, transactionId });
    return { transactionId };
  }

  async refund(transactionId: string): Promise<void> {
    this.refunds.push({ transactionId });
  }
}
