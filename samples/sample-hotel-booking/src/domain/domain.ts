import { Room } from "./write-model/aggregates/room";
import { Booking } from "./write-model/aggregates/booking";
import { Inventory } from "./write-model/aggregates/inventory";
import { RoomAvailabilityProjection } from "./read-model/projections/room-availability";
import { GuestHistoryProjection } from "./read-model/projections/guest-history";
import { RevenueProjection } from "./read-model/projections/revenue";
import { BookingFulfillmentSaga } from "./process-model/booking-fulfillment";
import { CheckoutReminderSaga } from "./process-model/checkout-reminder";
import { PaymentProcessingSaga } from "./process-model/payment-processing";

/** All aggregates in the hotel booking domain. */
export const aggregates = { Room, Booking, Inventory };

/** All projections in the hotel booking domain. */
export const projections = {
  RoomAvailability: RoomAvailabilityProjection,
  GuestHistory: GuestHistoryProjection,
  Revenue: RevenueProjection,
};

/** All sagas in the hotel booking domain. */
export const sagas = {
  BookingFulfillment: BookingFulfillmentSaga,
  CheckoutReminder: CheckoutReminderSaga,
  PaymentProcessing: PaymentProcessingSaga,
};
