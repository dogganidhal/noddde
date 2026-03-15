import { DefineEvents } from "@noddde/core";

export type AuctionEvent = DefineEvents<{
  AuctionCreated: { item: string; startingPrice: number; endsAt: Date };
  BidPlaced: { bidderId: string; amount: number; timestamp: Date };
  BidRejected: { bidderId: string; amount: number; reason: string };
  AuctionClosed: { winnerId: string | null; winningBid: number | null };
}>;
