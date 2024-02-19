import { Cart } from "./aggregate";
import { CartCreatedEvent, CartItemsAddedEvent } from "./events";
import { CommandHandler, TargetedCommand } from "@veliche/core";

export interface CreateCartCommand {}

export interface AddItemCommand extends TargetedCommand {
  itemId: string;
}

export const createCartCommandHandler: CommandHandler<
  CreateCartCommand,
  typeof Cart
> = (_command, { eventBus }) => {
  eventBus.dispatch<CartCreatedEvent>("CartCreated", {
    aggregateName: "Cart",
    aggregateId: "123",
  });

  return {
    id: "123",
    items: [],
  };
};

export const addItemCommandHandler: CommandHandler<
  AddItemCommand,
  typeof Cart
> = (command, state, { eventBus }) => {
  eventBus.dispatch<CartItemsAddedEvent>("CartItemAdded", {
    aggregateName: "Cart",
    aggregateId: state.id,
    item: {
      id: command.itemId,
    },
  });
};
