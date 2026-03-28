/** Payload emitted when a purchase attempt is rejected. */
export interface PurchaseRejectedPayload {
  /** Identifier of the buyer whose purchase was rejected. */
  buyerId: string;
  /** Machine-readable reason for rejection (e.g. "out_of_stock"). */
  reason: string;
}
