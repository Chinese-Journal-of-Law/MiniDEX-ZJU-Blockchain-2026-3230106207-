// Course Bonus coverage: distinct DEXes, seeded cross-DEX user swaps creating divergence,
// off-chain opportunity detection, single-tx atomic execution, reverted failure, evidence.
// Entire test deploys ONLY to hre.network.create('hardhat') EDR 31337; never RPC Ganache.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseUnits, formatUnits } from 'ethers';
import hre from 'hardhat';

const U = (v) => parseUnits(String(v), 18);
const F = (v) => formatUnits(v, 18);
const FEE_NUM = 997n;
const FEE_DEN = 1000n;
const SEED = 20261028;
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    return (state >>> 0) / 4294967296;
  };
}
function quote(input, rin, rout) {
  return input * FEE_NUM * rout / (rin * FEE_DEN + input * FEE_NUM);
}
function reserves(p) {
  return { reserveA: p.reserveA.toString(), reserveB: p.reserveB.toString(), shares: p.totalShares.toString() };
}
function priceBperA(p) {
  return F(p.reserveB * U(1) / p.reserveA);
}
function findBestRoute(p1, p2, input) {
  const routes = [
    { name: 'DEX1_to_DEX2', first: 1, second: 2, firstPool: p1, secondPool: p2 },
    { name: 'DEX2_to_DEX1', first: 2, second: 1, firstPool: p2, secondPool: p1 },
  ];
  return routes.map((r) => {
    const mid = quote(input, r.firstPool.reserveA, r.firstPool.reserveB);
    const back = quote(mid, r.secondPool.reserveB, r.secondPool.reserveA);
    return { ...r, mid, back, profitable: back > input, profit: back > input ? back - input : 0n };
  }).sort((a,b) => a.profit > b.profit ? -1 : a.profit < b.profit ? 1 : 0)[0];
}

// Built-in executable test + independent JSON source of evidence.
describe('Bonus PPT rubric: user-driven divergence and auto-detected atomic arbitrage', function () {
  this.timeout(120000);
  it('runs two DEXes, detects a profitable route and proves full rollback', async function () {
    const { ethers } = await hre.network.create('hardhat');
    const network = await ethers.provider.getNetwork();
    assert.equal(network.chainId, 31337n, 'STRICT: Hardhat isolated EDR 31337 only');
    const [owner, ...others] = await ethers.getSigners();
    const actors = others.slice(0, 8);
    assert.equal(new Set(actors.map(u => u.address.toLowerCase())).size, 8);

    const tokenA = await ethers.deployContract('MockToken', ['Bonus A', 'TKA']);
    const tokenB = await ethers.deployContract('MockToken', ['Bonus B', 'TKB']);
    const dex1 = await ethers.deployContract('MiniDEX');
    const dex2 = await ethers.deployContract('MiniDEX');
    const arb = await ethers.deployContract('BonusAtomicArbitrage');
    for (const c of [tokenA,tokenB,dex1,dex2,arb]) await c.waitForDeployment();
    const A = await tokenA.getAddress(); const B = await tokenB.getAddress();
    const D1 = await dex1.getAddress(); const D2 = await dex2.getAddress();
    const arbAddress = await arb.getAddress();
    assert.notEqual(D1, D2);

    await (await tokenA.claim()).wait(); await (await tokenB.claim()).wait();
    await (await dex1.createPool(A, B)).wait(); await (await dex2.createPool(A, B)).wait();
    for (const [dex, address] of [[dex1, D1], [dex2, D2]]) {
      await (await tokenA.approve(address, U(100))).wait();
      await (await tokenB.approve(address, U(100))).wait();
      await (await dex.addLiquidity(1n, U(100), U(100))).wait();
    }
    const starting1 = await dex1.pools(1n), starting2 = await dex2.pools(1n);
    assert.equal(priceBperA(starting1), '1.0');
    assert.equal(priceBperA(starting2), '1.0');
    assert.equal(findBestRoute(starting1, starting2, U(5)).profit, 0n,
      'Identical initial pool prices must not be a profitable route');

    // Real isolated transactions from distinct simulated users. Seed chooses venue,
    // user and amount; intended trading pressure makes the venue prices diverge.
    for (const user of actors) {
      await (await tokenA.connect(user).claim()).wait();
      await (await tokenB.connect(user).claim()).wait();
      await (await tokenA.connect(user).approve(D1, U(100))).wait();
      await (await tokenB.connect(user).approve(D2, U(100))).wait();
    }
    const rng = seeded(SEED);
    const tradeLogs = [];
    for (let i = 0; i < 20; i++) {
      const user = actors[Math.floor(rng() * actors.length)];
      const dexNo = rng() < 0.55 ? 1 : 2;
      const dex = dexNo === 1 ? dex1 : dex2;
      const tokenIn = dexNo === 1 ? tokenA : tokenB;
      const direction = dexNo === 1 ? 'TKA_to_TKB' : 'TKB_to_TKA';
      const amountIn = U((1 + Math.floor(rng() * 3)).toString());
      const before = await dex.pools(1n);
      const expected = dexNo === 1
        ? quote(amountIn, before.reserveA, before.reserveB)
        : quote(amountIn, before.reserveB, before.reserveA);
      const receipt = await (await dex.connect(user).swap(1n, await tokenIn.getAddress(), amountIn, expected)).wait();
      assert.equal(receipt.status, 1);
      tradeLogs.push({ actor: user.address, dex: `DEX${dexNo}`, direction,
        amountIn: F(amountIn), amountOut: F(expected), txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber });
    }
    assert.ok(tradeLogs.some(t => t.dex === 'DEX1'));
    assert.ok(tradeLogs.some(t => t.dex === 'DEX2'));
    assert.ok(new Set(tradeLogs.map(t => t.actor.toLowerCase())).size >= 4);

    const p1 = await dex1.pools(1n), p2 = await dex2.pools(1n);
    assert.notEqual(priceBperA(p1), priceBperA(p2));
    const principal = U(5);
    const opportunity = findBestRoute(p1, p2, principal);
    assert.ok(opportunity.profitable, 'Seeded user trading must cause a profitable spread');
    const firstDex = opportunity.first === 1 ? dex1 : dex2;
    const secondDex = opportunity.second === 1 ? dex1 : dex2;
    const firstAddress = await firstDex.getAddress();
    const secondAddress = await secondDex.getAddress();
    await (await tokenA.transfer(arbAddress, principal)).wait();
    const balanceBefore = await tokenA.balanceOf(arbAddress);
    const successfulTx = await arb.execute(firstAddress, 1n, secondAddress, 1n,
      A, B, principal, opportunity.mid, opportunity.back, 1n);
    const successfulReceipt = await successfulTx.wait();
    assert.equal(successfulReceipt.status, 1);
    const balanceAfter = await tokenA.balanceOf(arbAddress);
    const profit = balanceAfter - balanceBefore;
    assert.equal(profit, opportunity.profit);
    assert.ok(profit > 0n);
    assert.equal(await tokenB.balanceOf(arbAddress), 0n);

    // The single receipt must contain Swap logs emitted by two distinct DEX contracts.
    const swapsInReceipt = successfulReceipt.logs.filter(l =>
      [D1.toLowerCase(), D2.toLowerCase()].includes(l.address.toLowerCase()) &&
      (() => { try { return firstDex.interface.parseLog(l)?.name === 'Swap'; } catch { return false; } })()
    );
    assert.equal(swapsInReceipt.length, 2);
    assert.equal(new Set(swapsInReceipt.map(l => l.address.toLowerCase())).size, 2);
    const arbEvents = successfulReceipt.logs.filter(l => {
      if (l.address.toLowerCase() !== arbAddress.toLowerCase()) return false;
      try { return arb.interface.parseLog(l)?.name === 'ArbitrageExecuted'; } catch { return false; }
    });
    assert.equal(arbEvents.length, 1);

    const beforeFailed = {
      dex1: reserves(await dex1.pools(1n)), dex2: reserves(await dex2.pools(1n)),
      a: (await tokenA.balanceOf(arbAddress)).toString(),
      b: (await tokenB.balanceOf(arbAddress)).toString(),
    };
    await assert.rejects(arb.execute(firstAddress, 1n, secondAddress, 1n,
      A, B, U(1), 0n, 0n, U(100)), /ProfitTooLow|revert|execution reverted/);
    assert.deepEqual(reserves(await dex1.pools(1n)), beforeFailed.dex1);
    assert.deepEqual(reserves(await dex2.pools(1n)), beforeFailed.dex2);
    assert.equal((await tokenA.balanceOf(arbAddress)).toString(), beforeFailed.a);
    assert.equal((await tokenB.balanceOf(arbAddress)).toString(), beforeFailed.b);

    const gasPrice = successfulReceipt.gasPrice ?? 0n;
    const report = {
      title: 'PPT Bonus rubric evidence: isolated two DEX user-driven price divergence',
      chain: 'Hardhat EDR isolated 31337 (not Ganache 1337)',
      seed: SEED, simulatedTraders: actors.length,
      traderTransactions: tradeLogs.length, tradeLogs,
      initialPrices: {dex1:priceBperA(starting1),dex2:priceBperA(starting2)},
      afterTrading: {
        dex1:reserves(p1),dex2:reserves(p2),
        priceDex1BperA:priceBperA(p1), priceDex2BperA:priceBperA(p2),
      },
      detector: {strategy:'compare both two-swap quotes including the 0.3% fee at given input',
        direction: opportunity.name, amountInTKA:F(principal),
        intermediateTKB:F(opportunity.mid), projectedReturnTKA:F(opportunity.back),
        projectedGrossProfitTKA:F(opportunity.profit)},
      execution: {txHash:successfulReceipt.hash, blockNumber:successfulReceipt.blockNumber,
        numberOfSwapEventsInOneReceipt:swapsInReceipt.length,
        amountReturnedTKA:F(balanceAfter), grossProfitTKA:F(profit),
        gasUsed:successfulReceipt.gasUsed.toString(), gasPriceWei:gasPrice.toString(),
        gasCostWei:(successfulReceipt.gasUsed * gasPrice).toString(),
        gasNote:'Gas is native-token units and NOT subtracted from TKA profit without conversion rate'},
      failure: {forcedMinimumProfitTKA:'100', reverted:true,
        bothDexReservesUnchanged:true, arbBalancesUnchanged:true},
    };
    mkdirSync('simulation/reports', { recursive:true });
    writeFileSync('simulation/reports/bonus-rubric-latest.json', JSON.stringify(report,null,2));
    console.log(`PASS: ${tradeLogs.length} seeded simulated-user trades produced price divergence`);
    console.log(`DETECT: ${opportunity.name}; principal ${F(principal)} TKA; projected profit ${F(opportunity.profit)} TKA`);
    console.log(`PASS: 2 Swap events in one tx; realized gross profit ${F(profit)} TKA`);
    console.log(`PASS: impossible profit -> atomic revert, both DEX reserves and balances unchanged`);
    console.log(`Gas: ${successfulReceipt.gasUsed} units; gas cost ${successfulReceipt.gasUsed * gasPrice} wei (native token)`);
    console.log('Evidence: simulation/reports/bonus-rubric-latest.json');
  });
});
