import type { DefineEvents } from "@noddde/core";
import type { RoomCreatedPayload } from "./room-created";
import type { RoomMadeAvailablePayload } from "./room-made-available";
import type { RoomReservedPayload } from "./room-reserved";
import type { GuestCheckedInPayload } from "./guest-checked-in";
import type { GuestCheckedOutPayload } from "./guest-checked-out";
import type { RoomUnderMaintenancePayload } from "./room-under-maintenance";
import type { BookingCreatedPayload } from "./booking-created";
import type { BookingConfirmedPayload } from "./booking-confirmed";
import type { BookingCancelledPayload } from "./booking-cancelled";
import type { BookingModifiedPayload } from "./booking-modified";
import type { PaymentRequestedPayload } from "./payment-requested";
import type { PaymentCompletedPayload } from "./payment-completed";
import type { PaymentFailedPayload } from "./payment-failed";
import type { PaymentRefundedPayload } from "./payment-refunded";
import type { InventoryInitializedPayload } from "./inventory-initialized";
import type { RoomTypeCountUpdatedPayload } from "./room-type-count-updated";
import type { AvailabilityDecrementedPayload } from "./availability-decremented";
import type { AvailabilityIncrementedPayload } from "./availability-incremented";

export type { RoomCreatedPayload } from "./room-created";
export type { RoomMadeAvailablePayload } from "./room-made-available";
export type { RoomReservedPayload } from "./room-reserved";
export type { GuestCheckedInPayload } from "./guest-checked-in";
export type { GuestCheckedOutPayload } from "./guest-checked-out";
export type { RoomUnderMaintenancePayload } from "./room-under-maintenance";
export type { BookingCreatedPayload } from "./booking-created";
export type { BookingConfirmedPayload } from "./booking-confirmed";
export type { BookingCancelledPayload } from "./booking-cancelled";
export type { BookingModifiedPayload } from "./booking-modified";
export type { PaymentRequestedPayload } from "./payment-requested";
export type { PaymentCompletedPayload } from "./payment-completed";
export type { PaymentFailedPayload } from "./payment-failed";
export type { PaymentRefundedPayload } from "./payment-refunded";
export type { InventoryInitializedPayload } from "./inventory-initialized";
export type { RoomTypeCountUpdatedPayload } from "./room-type-count-updated";
export type { AvailabilityDecrementedPayload } from "./availability-decremented";
export type { AvailabilityIncrementedPayload } from "./availability-incremented";

/** Discriminated union of all room aggregate events. */
export type RoomEvent = DefineEvents<{
  RoomCreated: RoomCreatedPayload;
  RoomMadeAvailable: RoomMadeAvailablePayload;
  RoomReserved: RoomReservedPayload;
  GuestCheckedIn: GuestCheckedInPayload;
  GuestCheckedOut: GuestCheckedOutPayload;
  RoomUnderMaintenance: RoomUnderMaintenancePayload;
}>;

/** Discriminated union of all booking aggregate events. */
export type BookingEvent = DefineEvents<{
  BookingCreated: BookingCreatedPayload;
  BookingConfirmed: BookingConfirmedPayload;
  BookingCancelled: BookingCancelledPayload;
  BookingModified: BookingModifiedPayload;
  PaymentRequested: PaymentRequestedPayload;
  PaymentCompleted: PaymentCompletedPayload;
  PaymentFailed: PaymentFailedPayload;
  PaymentRefunded: PaymentRefundedPayload;
}>;

/** Discriminated union of all inventory aggregate events. */
export type InventoryEvent = DefineEvents<{
  InventoryInitialized: InventoryInitializedPayload;
  RoomTypeCountUpdated: RoomTypeCountUpdatedPayload;
  AvailabilityDecremented: AvailabilityDecrementedPayload;
  AvailabilityIncremented: AvailabilityIncrementedPayload;
}>;
