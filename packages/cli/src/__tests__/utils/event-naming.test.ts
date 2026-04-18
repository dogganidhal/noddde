import { describe, it, expect } from "vitest";
import { deriveEventName, eventKebab } from "../../utils/event-naming.js";

describe("deriveEventName", () => {
  it("converts PlaceBid → BidPlaced", () => {
    expect(deriveEventName("PlaceBid")).toBe("BidPlaced");
  });

  it("converts CreateAuction → AuctionCreated", () => {
    expect(deriveEventName("CreateAuction")).toBe("AuctionCreated");
  });

  it("converts CloseAuction → AuctionClosed", () => {
    expect(deriveEventName("CloseAuction")).toBe("AuctionClosed");
  });

  it("handles single-word commands", () => {
    expect(deriveEventName("Submit")).toBe("Submitted");
  });

  it("handles verbs ending in e", () => {
    expect(deriveEventName("CloseAccount")).toBe("AccountClosed");
  });

  it("handles kebab-case input", () => {
    expect(deriveEventName("place-bid")).toBe("BidPlaced");
  });
});

describe("eventKebab", () => {
  it("converts PascalCase to kebab-case", () => {
    expect(eventKebab("BidPlaced")).toBe("bid-placed");
  });

  it("converts AuctionCreated to kebab-case", () => {
    expect(eventKebab("AuctionCreated")).toBe("auction-created");
  });
});
