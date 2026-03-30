import type { InferDecideHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/**
 * Decides the CreateAuction command by emitting an AuctionCreated event.
 * No validation needed — any valid payload creates an auction.
 */
export const decideCreateAuction: InferDecideHandler<
  AuctionDef,
  "CreateAuction"
> = (command) => ({
  name: "AuctionCreated",
  payload: command.payload,
});
