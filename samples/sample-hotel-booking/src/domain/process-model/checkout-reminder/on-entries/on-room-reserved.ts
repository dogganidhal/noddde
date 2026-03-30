import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onRoomReserved: InferSagaOnEntry<
  CheckoutReminderDef,
  "RoomReserved"
> = {
  id: (event) => event.payload.roomId,
  handle: (_event, state) => ({ state }),
};
