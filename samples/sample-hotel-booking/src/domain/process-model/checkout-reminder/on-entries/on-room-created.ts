import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onRoomCreated: InferSagaOnEntry<
  CheckoutReminderDef,
  "RoomCreated"
> = {
  id: (event) => event.payload.roomId,
  handle: (_event, state) => ({ state }),
};
