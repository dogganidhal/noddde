import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onRoomMadeAvailable: InferSagaOnEntry<
  CheckoutReminderDef,
  "RoomMadeAvailable"
> = {
  id: (event) => event.payload.roomId,
  handle: (_event, state) => ({ state }),
};
