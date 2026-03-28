/** Payload for when a room is put under maintenance. */
export interface RoomUnderMaintenancePayload {
  roomId: string;
  reason: string;
  estimatedUntil: string;
}
