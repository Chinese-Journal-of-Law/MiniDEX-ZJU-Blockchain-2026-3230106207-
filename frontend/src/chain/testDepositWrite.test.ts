import { describe, expect, it } from "vitest";
import {
  ENABLE_TEST_DEPOSIT_WRITES,
  requireSeparateAuthorization,
} from "./testDepositWrite";

describe("historical 10+10 deposit write gate", () => {
  it("keeps future real deposit transactions locked", () => {
    expect(ENABLE_TEST_DEPOSIT_WRITES).toBe(false);
    expect(() => requireSeparateAuthorization()).toThrow(/LOCKED/);
  });
});
