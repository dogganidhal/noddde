import { DefineCommands } from "@noddde/core";
import type { CreateAuctionPayload } from "./create-auction";
import type { PlaceBidPayload } from "./place-bid";

export type { CreateAuctionPayload } from "./create-auction";
export type { PlaceBidPayload } from "./place-bid";
export type { CloseAuctionPayload } from "./close-auction";

/** Discriminated union of all auction aggregate commands. */
export type AuctionCommand = DefineCommands<{
  CreateAuction: CreateAuctionPayload;
  PlaceBid: PlaceBidPayload;
  CloseAuction: void;
}>;
