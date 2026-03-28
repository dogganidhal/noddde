import type { DefineCommands } from "@noddde/core";
import type { CreateRoomPayload } from "./create-room";
import type { MakeRoomAvailablePayload } from "./make-room-available";
import type { ReserveRoomPayload } from "./reserve-room";
import type { CheckInGuestPayload } from "./check-in-guest";
import type { CheckOutGuestPayload } from "./check-out-guest";
import type { PutUnderMaintenancePayload } from "./put-under-maintenance";

export type { CreateRoomPayload } from "./create-room";
export type { MakeRoomAvailablePayload } from "./make-room-available";
export type { ReserveRoomPayload } from "./reserve-room";
export type { CheckInGuestPayload } from "./check-in-guest";
export type { CheckOutGuestPayload } from "./check-out-guest";
export type { PutUnderMaintenancePayload } from "./put-under-maintenance";

/** Discriminated union of all room commands. */
export type RoomCommand = DefineCommands<{
  CreateRoom: CreateRoomPayload;
  MakeRoomAvailable: MakeRoomAvailablePayload;
  ReserveRoom: ReserveRoomPayload;
  CheckInGuest: CheckInGuestPayload;
  CheckOutGuest: CheckOutGuestPayload;
  PutUnderMaintenance: PutUnderMaintenancePayload;
}>;
