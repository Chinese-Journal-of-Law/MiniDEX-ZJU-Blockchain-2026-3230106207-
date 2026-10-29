import assert from "node:assert/strict";
import { parseUnits, formatUnits } from "ethers";
import hre from "hardhat";

const U = (n) => parseUnits(String(n), 18);
const quote = (input, reserveIn, reserveOut) =>
  (input * 997n * reserveOut) / (reserveIn * 1000n + input * 997n);

describe("Bonus: two DEXes and atomic cross-DEX arbitrage", function () {
  this.timeout(120000);

  it("captures positive profit and reverts both swaps when minProfit is impossible", async function () {
    const { ethers } = await hre.network.create("hardhat");
    assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);
    const [owner] = await ethers.getSigners();

    const tokenA = await ethers.deployContract("MockToken", ["Bonus A", "TKA"]);
    const tokenB = await ethers.deployContract("MockToken", ["Bonus B", "TKB"]);
    const dex1 = await ethers.deployContract("MiniDEX");
    const dex2 = await ethers.deployContract("MiniDEX");
    const arb = await ethers.deployContract("BonusAtomicArbitrage");
    await Promise.all([tokenA, tokenB, dex1, dex2, arb].map(c => c.waitForDeployment()));

    const A = await tokenA.getAddress(), B = await tokenB.getAddress();
    const D1 = await dex1.getAddress(), D2 = await dex2.getAddress();
    const ARB = await arb.getAddress();

    // Fresh isolated tokens: claim once, then fund both pools and arb.
    await (await tokenA.claim()).wait();
    await (await tokenB.claim()).wait();
    await (await dex1.createPool(A, B)).wait();
    await (await dex2.createPool(A, B)).wait();
    await (await tokenA.approve(D1, U(100))).wait();
    await (await tokenB.approve(D1, U(100))).wait();
    await (await dex1.addLiquidity(1n, U(100), U(100))).wait();
    await (await tokenA.approve(D2, U(100))).wait();
    await (await tokenB.approve(D2, U(150))).wait();
    await (await dex2.addLiquidity(1n, U(100), U(150))).wait();

    const p1 = await dex1.pools(1n), p2 = await dex2.pools(1n);
    assert.equal(p1.reserveA, U(100));
    assert.equal(p1.reserveB, U(100));
    assert.equal(p2.reserveA, U(100));
    assert.equal(p2.reserveB, U(150));

    // Route: buy B cheaply on DEX2 (100 A / 150 B), sell B on DEX1.
    const principal = U(10);
    await (await tokenA.transfer(ARB, principal)).wait();
    const intermediate = quote(principal, p2.reserveA, p2.reserveB);
    const returned = quote(intermediate, p1.reserveB, p1.reserveA);
    const expectedProfit = returned - principal;
    assert.ok(expectedProfit > 0n, "Route must be profitable");

    const beforeA = await tokenA.balanceOf(ARB);
    const tx = await arb.execute(
      D2, 1n, D1, 1n, A, B, principal,
      intermediate, returned, U("0.01")
    );
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    const afterA = await tokenA.balanceOf(ARB);
    const actualProfit = afterA - beforeA;
    assert.equal(actualProfit, expectedProfit);
    assert.equal(await tokenB.balanceOf(ARB), 0n);
    console.log(`PASS: 2 DEXes, atomic transaction ${receipt.hash}`);
    console.log(`DEX1 price B/A=1.0; DEX2 price B/A=1.5`);
    console.log(`Principal 10 TKA; returned ${formatUnits(returned,18)} TKA; profit ${formatUnits(actualProfit,18)} TKA`);

    // Failed second attempt: deliberately impossible minProfit.
    // Snapshot balances AND reserves: both swaps must revert together.
    const beforeFailure = {
      a: await tokenA.balanceOf(ARB),
      b: await tokenB.balanceOf(ARB),
      p1: await dex1.pools(1n),
      p2: await dex2.pools(1n),
    };
    await assert.rejects(
      arb.execute(D2, 1n, D1, 1n, A, B, U(1), 0n, 0n, U(100)),
      /ProfitTooLow|revert|execution reverted/
    );
    const afterFailure1 = await dex1.pools(1n);
    const afterFailure2 = await dex2.pools(1n);
    assert.equal(await tokenA.balanceOf(ARB), beforeFailure.a);
    assert.equal(await tokenB.balanceOf(ARB), beforeFailure.b);
    for (const field of ["reserveA", "reserveB", "totalShares"]) {
      assert.equal(afterFailure1[field], beforeFailure.p1[field], `DEX1 ${field} changed`);
      assert.equal(afterFailure2[field], beforeFailure.p2[field], `DEX2 ${field} changed`);
    }
    console.log("PASS: impossible-profit arbitrage reverted atomically; both pool reserves unchanged");
    console.log("PASS: isolated EDR 31337 only; Ganache 1337 untouched");
  });
});
