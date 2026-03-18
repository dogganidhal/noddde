import { DefineCommands } from "@noddde/core";

export type AuctionCommand = DefineCommands<{
  CreateAuction: { item: string; startingPrice: number; endsAt: Date };
  PlaceBid: { bidderId: string; amount: number };
  CloseAuction: void;
}>;
