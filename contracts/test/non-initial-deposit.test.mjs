import assert from "node:assert/strict";
import hre from "hardhat";

// No HTTP RPC and no known Ganache addresses are ever used by these tests.
describe("MiniDEX non-initial 10+10 (isolated EDR 31337)", function () {
  async function setup() {
    const { ethers } = await hre.network.create("hardhat");
    const [owner] = await ethers.getSigners();
    const dex = await ethers.deployContract("MiniDEX");
    const tka = await ethers.deployContract("MockToken", ["Token A", "TKA"]);
    const tkb = await ethers.deployContract("MockToken", ["Token B", "TKB"]);
    const tkc = await ethers.deployContract("MockToken", ["Token C", "TKC"]);
    await Promise.all([dex.waitForDeployment(), tka.waitForDeployment(),
      tkb.waitForDeployment(), tkc.waitForDeployment()]);
    const rpcNetwork = await ethers.provider.getNetwork();
    assert.equal(rpcNetwork.chainId, 31337n, "never run against Ganache");

    for (const token of [tka, tkb, tkc]) {
      await (await token.claim()).wait();
    }
    const dexAddress = await dex.getAddress();
    const unit = ethers.parseUnits("1", 18);
    const hundred = unit * 100n;
    const ten = unit * 10n;
    await (await dex.createPool(await tka.getAddress(), await tkb.getAddress())).wait();
    await (await dex.createPool(await tka.getAddress(), await tkc.getAddress())).wait();
    // Four isolated Pool 1 mints and one Pool 2 mint reproduce the #4/#5 shape,
    // not the real NFT data or history (which remains untouched).
    await (await tka.approve(dexAddress, hundred * 5n)).wait();
    await (await tkb.approve(dexAddress, hundred * 4n)).wait();
    await (await tkc.approve(dexAddress, hundred)).wait();
    for (let i = 0; i < 4; i++) {
      await (await dex.addLiquidity(1n, hundred, hundred)).wait();
    }
    await (await dex.addLiquidity(2n, hundred, hundred)).wait();
    assert.equal(await dex.nextTokenId(), 6n);
    assert.equal(await tka.allowance(await owner.getAddress(), dexAddress), 0n);
    assert.equal(await tkc.allowance(await owner.getAddress(), dexAddress), 0n);
    return { dex, tka, tkb, tkc, owner, hundred, ten, dexAddress };
  }

  it("previews non-initial mint, requires new exact approvals, and preserves #4/#5", async function () {
    const { dex, tka, tkc, owner, ten, dexAddress } = await setup();
    const wallet = await owner.getAddress();
    const owner4Before = await dex.ownerOf(4n);
    const owner5Before = await dex.ownerOf(5n);
    const pool1Before = await dex.pools(1n);
    const beforeA = await tka.balanceOf(wallet);
    const beforeC = await tkc.balanceOf(wallet);
    const initial = await dex.pools(2n);
    assert.equal(initial.reserveA, 100n * 10n ** 18n);
    assert.equal(initial.reserveB, 100n * 10n ** 18n);
    assert.equal(initial.totalShares, 100n * 10n ** 18n);

    await assert.rejects(async () => dex.addLiquidity.staticCall(2n, ten, ten));
    await (await tka.approve(dexAddress, ten)).wait();
    await (await tkc.approve(dexAddress, ten)).wait();
    assert.equal(await dex.addLiquidity.staticCall(2n, ten, ten), ten);
    const tx = await dex.addLiquidity(2n, ten, ten);
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    const minted = receipt.logs
      .filter(log => log.address.toLowerCase() === dexAddress.toLowerCase())
      .map(log => { try { return dex.interface.parseLog(log); } catch { return null; } })
      .filter(parsed => parsed?.name === "LiquidityNFTMinted");
    assert.equal(minted.length, 1);
    const mintedId = minted[0].args.tokenId;
    assert.equal(mintedId, 6n, "only in this deterministic isolated test");
    assert.equal(await dex.ownerOf(mintedId), wallet);
    const position = await dex.positions(mintedId);
    assert.equal(position.poolId, 2n);
    assert.equal(position.shares, ten);
    assert.equal(position.amountA, ten);
    assert.equal(position.amountB, ten);
    assert.ok(position.createdTimestamp > 0n);
    const after = await dex.pools(2n);
    assert.equal(after.reserveA, 110n * 10n ** 18n);
    assert.equal(after.reserveB, 110n * 10n ** 18n);
    assert.equal(after.totalShares, 110n * 10n ** 18n);
    assert.equal(beforeA - await tka.balanceOf(wallet), ten);
    assert.equal(beforeC - await tkc.balanceOf(wallet), ten);
    assert.equal(await tka.allowance(wallet, dexAddress), 0n);
    assert.equal(await tkc.allowance(wallet, dexAddress), 0n);
    assert.equal(await dex.ownerOf(4n), owner4Before);
    assert.equal(await dex.ownerOf(5n), owner5Before);
    const pool1After = await dex.pools(1n);
    assert.equal(pool1After.reserveA, pool1Before.reserveA);
    assert.equal(pool1After.reserveB, pool1Before.reserveB);
    console.log("PASS: isolated 10+10 mint, verified receipts and preserved NFTs");
  });

  it("rejects an imbalanced non-initial contribution", async function () {
    const { dex, tka, tkc, ten, dexAddress } = await setup();
    await (await tka.approve(dexAddress, ten)).wait();
    await (await tkc.approve(dexAddress, ten + 1n)).wait();
    await assert.rejects(async () => dex.addLiquidity.staticCall(2n, ten, ten + 1n),
      /Incorrect token ratio|execution reverted/i);
    const pool = await dex.pools(2n);
    assert.equal(pool.reserveA, 100n * 10n ** 18n);
    assert.equal(pool.reserveB, 100n * 10n ** 18n);
    assert.equal(await dex.nextTokenId(), 6n);
  });
});
