import { defineAggregate } from "@noddde/core";
import { AuctionInfrastructure } from "./infrastructure";
import { AuctionCommand } from "./commands";
import { AuctionEvent } from "./events";

export interface AuctionState {
  item: string;
  startingPrice: number;
  endsAt: Date;
  status: "open" | "closed";
  highestBid: { bidderId: string; amount: number } | null;
  bidCount: number;
}

type AuctionDef = {
  state: AuctionState;
  events: AuctionEvent;
  commands: AuctionCommand;
  infrastructure: AuctionInfrastructure;
};

export const Auction = defineAggregate<AuctionDef>({
  initialState: {
    item: "",
    startingPrice: 0,
    endsAt: new Date(0),
    status: "open",
    highestBid: null,
    bidCount: 0,
  },

  commands: {
    CreateAuction: (command) => ({
      name: "AuctionCreated",
      payload: command.payload,
    }),

    PlaceBid: (command, state, { clock }) => {
      const { bidderId, amount } = command.payload;
      const now = clock.now();

      if (state.status === "closed") {
        return {
          name: "BidRejected",
          payload: { bidderId, amount, reason: "Auction is closed" },
        };
      }

      if (now > state.endsAt) {
        return {
          name: "BidRejected",
          payload: { bidderId, amount, reason: "Auction has ended" },
        };
      }

      const minimumBid = state.highestBid?.amount ?? state.startingPrice;
      if (amount <= minimumBid) {
        return {
          name: "BidRejected",
          payload: {
            bidderId,
            amount,
            reason: `Bid must exceed ${minimumBid}`,
          },
        };
      }

      return {
        name: "BidPlaced",
        payload: { bidderId, amount, timestamp: now },
      };
    },

    CloseAuction: (_command, state) => ({
      name: "AuctionClosed",
      payload: {
        winnerId: state.highestBid?.bidderId ?? null,
        winningBid: state.highestBid?.amount ?? null,
      },
    }),
  },

  apply: {
    AuctionCreated: (event) => ({
      item: event.item,
      startingPrice: event.startingPrice,
      endsAt: event.endsAt,
      status: "open" as const,
      highestBid: null,
      bidCount: 0,
    }),

    BidPlaced: (event, state) => ({
      ...state,
      highestBid: { bidderId: event.bidderId, amount: event.amount },
      bidCount: state.bidCount + 1,
    }),

    BidRejected: (_event, state) => state,

    AuctionClosed: (_event, state) => ({
      ...state,
      status: "closed" as const,
    }),
  },
});
