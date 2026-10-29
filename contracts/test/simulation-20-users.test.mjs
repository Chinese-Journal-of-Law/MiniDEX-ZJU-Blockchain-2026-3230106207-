import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseUnits, formatUnits } from "ethers";
import hre from "hardhat";

const units = (value) => parseUnits(String(value), 18);
const fmt = (value) => formatUnits(value, 18);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("MiniDEX 20-user sustained simulation, fee accounting and LP PnL", function () {
  this.timeout(300000);

  it("runs a timed isolated workload and writes an auditable report", async function () {
    // Hardhat 3 isolated in-memory EDR network only. Never connect to Ganache 1337.
    const { ethers } = await hre.network.create("hardhat");
    const chain = await ethers.provider.getNetwork();
    assert.equal(chain.chainId, 31337n, "Must run on isolated Hardhat EDR 31337");

    const configuredDurationMs = Number(process.env.SIMULATION_DURATION_MS ?? 60000);
    const intervalMs = Number(process.env.SIMULATION_INTERVAL_MS ?? 100);
    if (!Number.isFinite(configuredDurationMs) || configuredDurationMs < 1000 ||
        configuredDurationMs > 300000) {
      throw new Error("SIMULATION_DURATION_MS must be between 1000 and 300000");
    }
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 5000) {
      throw new Error("SIMULATION_INTERVAL_MS must be between 0 and 5000");
    }

    const signers = await ethers.getSigners();
    assert.ok(signers.length >= 20, "EDR must provide at least 20 signers");
    const users = signers.slice(0, 20);
    assert.equal(new Set(users.map((u) => u.address.toLowerCase())).size, 20);

    const dex = await ethers.deployContract("MiniDEX");
    const tokenA = await ethers.deployContract("MockToken", ["Simulation Token A", "TKA"]);
    const tokenB = await ethers.deployContract("MockToken", ["Simulation Token B", "TKB"]);
    await Promise.all([dex.waitForDeployment(), tokenA.waitForDeployment(), tokenB.waitForDeployment()]);
    const dexAddress = await dex.getAddress();
    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();

    const transactions = [];
    const failures = [];
    const counts = { claims: 0, approvals: 0, adds: 0, swaps: 0, removes: 0 };
    let sequence = 0;
    async function record(actor, action, task, extra = {}) {
      try {
        const tx = await task();
        const receipt = await tx.wait();
        assert.equal(receipt.status, 1, `${action} receipt failed`);
        transactions.push({
          sequence: ++sequence, actor: actor.address, action, hash: receipt.hash,
          blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
          status: "success", ...extra,
        });
        counts[action]++;
        return receipt;
      } catch (error) {
        failures.push({ actor: actor.address, action, error: String(error) });
        throw error;
      }
    }

    await (await dex.createPool(tokenAAddress, tokenBAddress)).wait();
    assert.equal(await dex.poolCount(), 1n);

    const positions = [];
    for (const user of users) {
      await record(user, "claims", () => tokenA.connect(user).claim(), { token: "TKA" });
      await record(user, "claims", () => tokenB.connect(user).claim(), { token: "TKB" });
      assert.equal(await tokenA.hasClaimed(user.address), true);
      assert.equal(await tokenB.hasClaimed(user.address), true);
      await record(user, "approvals", () => tokenA.connect(user).approve(dexAddress, units(1000)));
      await record(user, "approvals", () => tokenB.connect(user).approve(dexAddress, units(1000)));
      const tokenId = await dex.nextTokenId();
      await record(user, "adds", () => dex.connect(user).addLiquidity(1n, units(10), units(10)), {
        tokenId: tokenId.toString(),
      });
      const position = await dex.positions(tokenId);
      assert.equal(position.shares, units(10));
      assert.equal((await dex.ownerOf(tokenId)).toLowerCase(), user.address.toLowerCase());
      positions.push({ user, tokenId, initialA: units(10), initialB: units(10) });
    }

    const initialPool = await dex.pools(1n);
    assert.equal(initialPool.reserveA, units(200));
    assert.equal(initialPool.reserveB, units(200));
    assert.equal(initialPool.totalShares, units(200));

    const startedAt = new Date().toISOString();
    const wallStart = performance.now();
    const deadline = wallStart + configuredDurationMs;
    let swapIndex = 0;
    let grossInputA = 0n, grossInputB = 0n, feeA = 0n, feeB = 0n;
    let outputA = 0n, outputB = 0n;

    while (performance.now() < deadline || swapIndex < 60) {
      const user = users[swapIndex % users.length];
      const isAIn = swapIndex % 2 === 0;
      const tokenIn = isAIn ? tokenA : tokenB;
      const amountIn = units("0.1");
      const pool = await dex.pools(1n);
      const reserveIn = isAIn ? pool.reserveA : pool.reserveB;
      const reserveOut = isAIn ? pool.reserveB : pool.reserveA;
      const amountWithFee = amountIn * 997n;
      const expectedOut = amountWithFee * reserveOut / (reserveIn * 1000n + amountWithFee);
      assert.ok(expectedOut > 0n);
      const minOut = expectedOut * 99n / 100n;

      await record(user, "swaps", () =>
        dex.connect(user).swap(1n, tokenIn.target, amountIn, minOut), {
          direction: isAIn ? "TKA->TKB" : "TKB->TKA",
          amountIn: amountIn.toString(), minOut: minOut.toString(),
        });

      if (isAIn) {
        grossInputA += amountIn;
        feeA += amountIn * 3n / 1000n;
        outputB += expectedOut;
      } else {
        grossInputB += amountIn;
        feeB += amountIn * 3n / 1000n;
        outputA += expectedOut;
      }
      swapIndex++;
      if (intervalMs > 0) await sleep(intervalMs);
    }

    const actualDurationMs = Math.round(performance.now() - wallStart);
    const finishedAt = new Date().toISOString();
    const poolBeforeRemove = await dex.pools(1n);
    const lpResults = [];

    for (const { user, tokenId, initialA, initialB } of positions) {
      const position = await dex.positions(tokenId);
      const pool = await dex.pools(1n);
      const expectedA = position.shares * pool.reserveA / pool.totalShares;
      const expectedB = position.shares * pool.reserveB / pool.totalShares;
      const minA = expectedA * 99n / 100n;
      const minB = expectedB * 99n / 100n;
      const beforeA = await tokenA.balanceOf(user.address);
      const beforeB = await tokenB.balanceOf(user.address);

      const receipt = await record(user, "removes", () =>
        dex.connect(user).removeLiquidity(tokenId, minA, minB), {
          tokenId: tokenId.toString(), minA: minA.toString(), minB: minB.toString(),
        });

      const afterA = await tokenA.balanceOf(user.address);
      const afterB = await tokenB.balanceOf(user.address);
      const returnedA = afterA - beforeA;
      const returnedB = afterB - beforeB;
      assert.equal(returnedA, expectedA);
      assert.equal(returnedB, expectedB);
      await assert.rejects(async () => dex.ownerOf(tokenId));
      assert.equal((await dex.positions(tokenId)).shares, 0n);
      lpResults.push({
        user: user.address, tokenId: tokenId.toString(),
        depositedA: initialA.toString(), depositedB: initialB.toString(),
        withdrawnA: returnedA.toString(), withdrawnB: returnedB.toString(),
        pnlA: (returnedA - initialA).toString(), pnlB: (returnedB - initialB).toString(),
        gasUsedRemove: receipt.gasUsed.toString(),
      });
    }

    const finalPool = await dex.pools(1n);
    assert.equal(finalPool.totalShares, 0n);
    assert.equal(counts.claims, 40);
    assert.equal(counts.approvals, 40);
    assert.equal(counts.adds, 20);
    assert.equal(counts.swaps, swapIndex);
    assert.equal(counts.removes, 20);
    assert.equal(failures.length, 0);

    const totalPnlA = lpResults.reduce((sum, lp) => sum + BigInt(lp.pnlA), 0n);
    const totalPnlB = lpResults.reduce((sum, lp) => sum + BigInt(lp.pnlB), 0n);
    const totalGas = transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n);
    const report = {
      schemaVersion: 2,
      chain: "Hardhat EDR isolated chainId 31337; not Ganache 1337",
      userCount: users.length, users: users.map((user) => user.address),
      startedAt, finishedAt, requestedDurationMs: configuredDurationMs,
      actualDurationMs, intervalMs, swapCount: swapIndex, counts,
      transactionCount: transactions.length, successCount: transactions.length,
      failureCount: failures.length,
      feeModel: "Nominal fee estimate floor(amountIn * 3 / 1000), reported separately per input token; swap invariant uses 997/1000.",
      feeA: { grossInput: grossInputA.toString(), estimatedFee: feeA.toString(), humanUnits: fmt(feeA) },
      feeB: { grossInput: grossInputB.toString(), estimatedFee: feeB.toString(), humanUnits: fmt(feeB) },
      swapOutputEstimate: { tokenA: outputA.toString(), tokenB: outputB.toString() },
      lpAccounting: {
        method: "Per-user balance delta immediately around removeLiquidity; PnL = withdrawn minus original deposit. This is net LP outcome, not pure fee attribution.",
        totalWithdrawnA: lpResults.reduce((s, lp) => s + BigInt(lp.withdrawnA), 0n).toString(),
        totalWithdrawnB: lpResults.reduce((s, lp) => s + BigInt(lp.withdrawnB), 0n).toString(),
        totalPnlA: totalPnlA.toString(), totalPnlB: totalPnlB.toString(),
        totalPnlHumanA: fmt(totalPnlA), totalPnlHumanB: fmt(totalPnlB), perUser: lpResults,
      },
      gas: { totalGasUsed: totalGas.toString(), meanGasUsed: (totalGas / BigInt(transactions.length)).toString() },
      initialPool: { reserveA: initialPool.reserveA.toString(), reserveB: initialPool.reserveB.toString(), totalShares: initialPool.totalShares.toString() },
      poolBeforeRemove: { reserveA: poolBeforeRemove.reserveA.toString(), reserveB: poolBeforeRemove.reserveB.toString(), totalShares: poolBeforeRemove.totalShares.toString() },
      finalPool: { reserveA: finalPool.reserveA.toString(), reserveB: finalPool.reserveB.toString(), totalShares: finalPool.totalShares.toString() },
      transactions, failures,
    };
    mkdirSync("simulation/reports", { recursive: true });
    writeFileSync("simulation/reports/20-users-sustained-fees-lp-pnl.json", JSON.stringify(report, null, 2));
    console.log(`PASS: ${users.length} users; ${swapIndex} timed swaps; ${transactions.length} confirmed transactions.`);
    console.log(`Actual duration: ${actualDurationMs} ms; fees TKA=${fmt(feeA)}, TKB=${fmt(feeB)}.`);
    console.log(`Aggregate LP outcome vs deposits: TKA=${fmt(totalPnlA)}, TKB=${fmt(totalPnlB)}.`);
    console.log("Report: simulation/reports/20-users-sustained-fees-lp-pnl.json");
  });
});
