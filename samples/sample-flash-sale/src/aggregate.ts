import { defineAggregate } from "@noddde/core";
import type { AggregateTypes, Infrastructure } from "@noddde/core";
import type { FlashSaleEvent } from "./events";
import type { FlashSaleCommand } from "./commands";

export type FlashSaleState = {
  stock: number;
  sold: number;
  buyers: string[];
};

type FlashSaleTypes = AggregateTypes & {
  state: FlashSaleState;
  events: FlashSaleEvent;
  commands: FlashSaleCommand;
  infrastructure: Infrastructure;
};

export const FlashSaleItem = defineAggregate<FlashSaleTypes>({
  initialState: { stock: 0, sold: 0, buyers: [] },
  commands: {
    CreateFlashSale: (command) => ({
      name: "FlashSaleCreated",
      payload: {
        itemId: command.targetAggregateId,
        initialStock: command.payload.initialStock,
      },
    }),
    PurchaseItem: (command, state) => {
      if (state.stock <= 0) {
        return {
          name: "PurchaseRejected",
          payload: {
            buyerId: command.payload.buyerId,
            reason: "out_of_stock",
          },
        };
      }
      return {
        name: "ItemPurchased",
        payload: {
          buyerId: command.payload.buyerId,
          quantity: command.payload.quantity,
        },
      };
    },
  },
  apply: {
    FlashSaleCreated: (payload) => ({
      stock: payload.initialStock,
      sold: 0,
      buyers: [],
    }),
    ItemPurchased: (payload, state) => ({
      stock: state.stock - payload.quantity,
      sold: state.sold + payload.quantity,
      buyers: [...state.buyers, payload.buyerId],
    }),
    PurchaseRejected: (_payload, state) => state,
  },
});
