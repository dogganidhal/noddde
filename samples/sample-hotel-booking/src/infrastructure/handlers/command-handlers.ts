import { type DefineCommands } from "@noddde/core";
import type { StandaloneCommandHandler } from "@noddde/core";
import type { HotelPorts } from "../types";

/**
 * Standalone command for the nightly audit process.
 * Not routed to any aggregate — instead uses CQRS buses to
 * query read models and dispatch cancellations.
 */
export type RunNightlyAuditCommand = DefineCommands<{
  RunNightlyAudit: {
    /** ISO date string for the audit date (e.g., "2026-04-10"). */
    auditDate: string;
  };
}>;

/**
 * Runs a nightly audit: queries for expired bookings (past checkIn
 * date, still pending) and dispatches CancelBooking commands.
 *
 * Demonstrates a standalone command handler that uses CQRSInfrastructure
 * to interact with the domain without owning aggregate state.
 */
export const RunNightlyAuditHandler: StandaloneCommandHandler<
  HotelPorts,
  RunNightlyAuditCommand
> = async (command, ports) => {
  const { auditDate } = command.payload;

  // In a real system, this would query a read model for expired bookings.
  // For the sample, we log the audit action.
  const { clock } = ports;
  const now = clock.now().toISOString();

  // Example: could query bookings and cancel expired ones
  // const expired = await infrastructure.queryBus.dispatch({
  //   name: "ListExpiredBookings",
  //   payload: { asOf: auditDate },
  // });
  // for (const booking of expired) {
  //   await infrastructure.commandBus.dispatch({
  //     name: "CancelBooking",
  //     targetAggregateId: booking.bookingId,
  //     payload: { reason: `Auto-cancelled: past check-in date ${auditDate}` },
  //   });
  // }

  console.log(`[NightlyAudit] Audit completed for ${auditDate} at ${now}`);
};
