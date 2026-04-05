/* eslint-disable no-unused-vars */
import type { ViewStore } from "@noddde/core";
import type {
  RoomAvailabilityViewStore,
  GuestHistoryView,
  RevenueView,
} from "../domain/read-model/queries";

/** Room type classification. */
export type RoomType = "single" | "double" | "suite";

// ── Service Interfaces ──────────────────────────────────────────

/** Deterministic time injection for testability. */
export interface Clock {
  now(): Date;
}

/** Sends email notifications. */
export interface EmailService {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Sends SMS notifications. */
export interface SmsService {
  send(phone: string, message: string): Promise<void>;
}

/** Processes payments and refunds. */
export interface PaymentGateway {
  charge(guestId: string, amount: number): Promise<{ transactionId: string }>;
  refund(transactionId: string): Promise<void>;
}

// ── Aggregate Ports ─────────────────────────────────────────────

/**
 * Custom port dependencies for the hotel booking domain.
 * Injected into command handlers, saga handlers, and event handlers.
 */
export interface HotelPorts {
  clock: Clock;
  emailService: EmailService;
  smsService: SmsService;
  paymentGateway: PaymentGateway;
  roomAvailabilityViewStore: RoomAvailabilityViewStore;
  guestHistoryViewStore: ViewStore<GuestHistoryView>;
  revenueViewStore: ViewStore<RevenueView>;
}
