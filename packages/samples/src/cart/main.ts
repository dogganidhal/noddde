import { getCommandBus, initV } from "@veliche/core";
import { Cart } from "./aggregate";
import { DemoRepository, DemoInfrastructure } from "./infrastructure";

class InMemoryDemoRepository implements DemoRepository {
  private storage: Record<string, any> = {};

  async save(id: string, state: any) {
    this.storage[id] = state;
  }

  async load(id: string) {
    return Promise.resolve(this.storage[id]);
  }
}

initV<DemoInfrastructure>({
  aggregates: {
    Cart,
  },
  createInfrastructure: () => ({
    cartRepository: new InMemoryDemoRepository(),
  }),
});

if (require.main === module) {
  getCommandBus()
    .dispatch("CreateCart", {})
    .then((id) => {
      console.log("Cart created with id", id);
      getCommandBus().dispatch("AddItemToCart", {
        targetAggregateId: id,
        item: { id: "item_id" },
      });
    });
}
