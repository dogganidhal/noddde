import type { Command } from "@noddde/core";
import type { AuctionEvent } from "../../../../event-model";
import type { CreateAuctionPayload } from "../commands/create-auction";

/**
 * Handles the CreateAuction command by emitting an AuctionCreated event.
 * No validation needed — any valid payload creates an auction.
 */
export const handleCreateAuction = (
  command: Command & { name: "CreateAuction"; payload: CreateAuctionPayload },
): AuctionEvent => ({
  name: "AuctionCreated",
  payload: command.payload,
});
