import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onRoomUnderMaintenance: InferSagaOnEntry<
  CheckoutReminderDef,
  "RoomUnderMaintenance"
> = {
  id: (event) => event.payload.roomId,
  handle: (_event, state) => ({ state }),
};
