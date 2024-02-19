import { Cart } from "./aggregate";
import { Event, EventHandler } from "@veliche/core";

export interface CartCreatedEvent extends Event {}

export interface CartItemsAddedEvent extends Event {
  item: {
    id: string;
  };
}

export const cartCreatedEventHandler: EventHandler<
  CartCreatedEvent,
  typeof Cart
> = (event, state) => state;

export const cartItemsAddedEventHandler: EventHandler<
  CartItemsAddedEvent,
  typeof Cart
> = (event, state) => ({
  ...state,
  items: [...state.items, event.item.id],
});
