import assert from "node:assert/strict";
import hre from "hardhat";

describe("MiniDEX isolated pool creation", function () {
  async function freshContracts() {
    // 使用配置中已有的 EDR 模拟网络，不连接 Ganache。
    const { ethers } = await hre.network.create("hardhat");

    const dex = await ethers.deployContract("MiniDEX");
    await dex.waitForDeployment();

    const tka = await ethers.deployContract(
      "MockToken",
      ["Token A", "TKA"]
    );
    const tkb = await ethers.deployContract(
      "MockToken",
      ["Token B", "TKB"]
    );
    const tkc = await ethers.deployContract(
      "MockToken",
      ["Token C", "TKC"]
    );

    await Promise.all([
      tka.waitForDeployment(),
      tkb.waitForDeployment(),
      tkc.waitForDeployment(),
    ]);

    return { dex, tka, tkb, tkc };
  }

  it("creates two distinct pools in the isolated network", async function () {
    const { dex, tka, tkb, tkc } = await freshContracts();

    const a = await tka.getAddress();
    const b = await tkb.getAddress();
    const c = await tkc.getAddress();

    assert.equal(await dex.poolCount(), 0n);

    assert.equal(await dex.createPool.staticCall(a, b), 1n);
    await (await dex.createPool(a, b)).wait();

    assert.equal(await dex.poolCount(), 1n);

    assert.equal(await dex.createPool.staticCall(a, c), 2n);
    await (await dex.createPool(a, c)).wait();

    assert.equal(await dex.poolCount(), 2n);

    const pool1 = await dex.pools(1n);
    const pool2 = await dex.pools(2n);

    assert.equal(
      pool1.tokenA.toLowerCase(),
      a.toLowerCase()
    );
    assert.equal(
      pool1.tokenB.toLowerCase(),
      b.toLowerCase()
    );
    assert.equal(
      pool2.tokenA.toLowerCase(),
      a.toLowerCase()
    );
    assert.equal(
      pool2.tokenB.toLowerCase(),
      c.toLowerCase()
    );

    assert.equal(pool2.reserveA, 0n);
    assert.equal(pool2.reserveB, 0n);
    assert.equal(pool2.totalShares, 0n);
    assert.equal(await dex.nextTokenId(), 1n);

    console.log("PASS: isolated Pool 1 and Pool 2 created.");
  });

  it("rejects duplicate and invalid pairs", async function () {
    const { dex, tka, tkb } = await freshContracts();

    const a = await tka.getAddress();
    const b = await tkb.getAddress();

    await (await dex.createPool(a, b)).wait();

    await assert.rejects(
      async () => await dex.createPool.staticCall(a, b)
    );

    await assert.rejects(
      async () => await dex.createPool.staticCall(b, a)
    );

    await assert.rejects(
      async () => await dex.createPool.staticCall(a, a)
    );

    await assert.rejects(
      async () => await dex.createPool.staticCall(
        a,
        "0x0000000000000000000000000000000000000001"
      )
    );

    assert.equal(await dex.poolCount(), 1n);

    console.log("PASS: duplicate and invalid pairs rejected.");
  });
});