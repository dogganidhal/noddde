import { DemoInfrastructure } from "./infrastructure";
import { addItemCommandHandler, createCartCommandHandler } from "./commands";
import { cartCreatedEventHandler, cartItemsAddedEventHandler } from "./events";
import { AggregateRoot } from "@veliche/core";

export interface CartState {
  id: string;
  items: string[];
}

export const Cart: AggregateRoot<CartState, DemoInfrastructure> = {
  initialState: () => ({
    id: "generate_random_id_here",
    items: [],
  }),
  commandHandlers: {
    CreateCart: createCartCommandHandler,
    AddItem: addItemCommandHandler,
  },
  eventHandlers: {
    CartCreated: cartCreatedEventHandler,
    CartItemAdded: cartItemsAddedEventHandler,
  },
};
