import { describe, expect, it } from "vitest";
import {
  assertTarget, ENABLE_NFT6_REAL_REDEEM, NFT6_REDEEM_ATTEMPT_KEY,
} from "./redeemWrite";

describe("NFT #6 historical redemption write gate", () => {
  it("keeps all live redemption writes locked after the one-time redemption", () => {
    expect(ENABLE_NFT6_REAL_REDEEM).toBe(false);
    expect(() => assertTarget(6n)).toThrow();
    for (const id of [0n, 4n, 5n, 7n]) expect(() => assertTarget(id)).toThrow();
  });
  it("retains the stable historical attempt key for audit", () => {
    expect(NFT6_REDEEM_ATTEMPT_KEY).toContain("1337:nft6:redeem:");
  });
});
