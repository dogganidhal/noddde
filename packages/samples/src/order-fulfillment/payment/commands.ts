import { DefineCommands } from "@noddde/core";

export type PaymentCommand = DefineCommands<{
  RequestPayment: { referenceId: string; amount: number };
  CompletePayment: void;
  FailPayment: { reason: string };
  RefundPayment: { reason: string };
}>;
