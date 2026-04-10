import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

const HERO_CODE = `import { defineAggregate } from "@noddde/core";

const Auction = defineAggregate<AuctionDef>({
  initialState: { status: "pending", bids: [] },

  decide: {
    CreateAuction: (command, state) => ({
      type: "AuctionCreated",
      payload: { title: command.payload.title },
    }),
    PlaceBid: (command, state) => ({
      type: "BidPlaced",
      payload: { amount: command.payload.amount },
    }),
  },

  evolve: {
    AuctionCreated: (_, state) => ({ ...state, status: "active" }),
    BidPlaced: (payload, state) => ({
      ...state,
      bids: [...state.bids, payload],
    }),
  },
});`;

export async function HeroCode() {
  const highlighted = await highlight(HERO_CODE, {
    lang: "typescript",
    themes: { light: "github-light", dark: "github-dark" },
  });

  return (
    <CodeBlock title="auction.ts" keepBackground>
      <Pre>{highlighted}</Pre>
    </CodeBlock>
  );
}
