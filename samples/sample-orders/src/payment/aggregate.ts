import { defineAggregate } from "@noddde/core";
import { EcommerceInfrastructure } from "../infrastructure";
import { PaymentCommand } from "./commands";
import { PaymentEvent } from "./events";

export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

export interface PaymentState {
  referenceId: string | null;
  amount: number;
  status: PaymentStatus;
}

type PaymentDef = {
  state: PaymentState;
  events: PaymentEvent;
  commands: PaymentCommand;
  infrastructure: EcommerceInfrastructure;
};

export const Payment = defineAggregate<PaymentDef>({
  initialState: {
    referenceId: null,
    amount: 0,
    status: "pending",
  },

  commands: {
    RequestPayment: (command, _state, { clock }) => ({
      name: "PaymentRequested",
      payload: {
        paymentId: command.targetAggregateId,
        referenceId: command.payload.referenceId,
        amount: command.payload.amount,
        requestedAt: clock.now(),
      },
    }),

    CompletePayment: (command, state, { clock }) => ({
      name: "PaymentCompleted",
      payload: {
        paymentId: command.targetAggregateId,
        referenceId: state.referenceId!,
        amount: state.amount,
        completedAt: clock.now(),
      },
    }),

    FailPayment: (command, state, { clock }) => ({
      name: "PaymentFailed",
      payload: {
        paymentId: command.targetAggregateId,
        referenceId: state.referenceId!,
        reason: command.payload.reason,
        failedAt: clock.now(),
      },
    }),

    RefundPayment: (command, state, { clock }) => ({
      name: "PaymentRefunded",
      payload: {
        paymentId: command.targetAggregateId,
        referenceId: state.referenceId!,
        amount: state.amount,
        reason: command.payload.reason,
        refundedAt: clock.now(),
      },
    }),
  },

  apply: {
    PaymentRequested: (event) => ({
      referenceId: event.referenceId,
      amount: event.amount,
      status: "pending" as const,
    }),

    PaymentCompleted: (_event, state) => ({
      ...state,
      status: "completed" as const,
    }),

    PaymentFailed: (_event, state) => ({
      ...state,
      status: "failed" as const,
    }),

    PaymentRefunded: (_event, state) => ({
      ...state,
      status: "refunded" as const,
    }),
  },
});
