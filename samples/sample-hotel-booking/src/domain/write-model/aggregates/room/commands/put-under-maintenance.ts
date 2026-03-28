/** Payload for putting a room under maintenance. */
export interface PutUnderMaintenancePayload {
  reason: string;
  estimatedUntil: string;
}
