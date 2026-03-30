import type { InferCommandHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/**
 * Handles the CreateAuction command by emitting an AuctionCreated event.
 * No validation needed — any valid payload creates an auction.
 */
export const handleCreateAuction: InferCommandHandler<
  AuctionDef,
  "CreateAuction"
> = (command) => ({
  name: "AuctionCreated",
  payload: command.payload,
});
