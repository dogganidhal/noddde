import { DefineEvents } from "@noddde/core";

export type PaymentEvent = DefineEvents<{
  PaymentRequested: {
    paymentId: string;
    referenceId: string;
    amount: number;
    requestedAt: Date;
  };
  PaymentCompleted: {
    paymentId: string;
    referenceId: string;
    amount: number;
    completedAt: Date;
  };
  PaymentFailed: {
    paymentId: string;
    referenceId: string;
    reason: string;
    failedAt: Date;
  };
  PaymentRefunded: {
    paymentId: string;
    referenceId: string;
    amount: number;
    reason: string;
    refundedAt: Date;
  };
}>;
