
import assert from "node:assert/strict";
import hre from "hardhat";

// 只允许使用 Hardhat 内存模拟链。
const simulation = hre.config.networks.hardhatMainnet;

if (!simulation || simulation.type !== "edr-simulated") {
  throw new Error(
    "安全停止：hardhatMainnet 必须是 edr-simulated"
  );
}

describe("MiniDEX isolated pool creation", function () {
  async function freshContracts() {
    // 这里才异步创建隔离链，避免顶层 await。
    const { ethers } =
      await hre.network.create("hardhatMainnet");

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

  it("creates Pool 1 and Pool 2", async function () {
    const { dex, tka, tkb, tkc } =
      await freshContracts();

    const a = await tka.getAddress();
    const b = await tkb.getAddress();
    const c = await tkc.getAddress();

    assert.equal(
      await dex.createPool.staticCall(a, b),
      1n
    );

    assert.equal(await dex.poolCount(), 0n);

    await (await dex.createPool(a, b)).wait();

    assert.equal(await dex.poolCount(), 1n);

    assert.equal(
      await dex.createPool.staticCall(a, c),
      2n
    );

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

    console.log(
      "ISOLATED TEST: Pool 1 and Pool 2 created successfully."
    );
  });

  it("rejects invalid and duplicate pairs", async function () {
    const { dex, tka, tkb } =
      await freshContracts();

    const a = await tka.getAddress();
    const b = await tkb.getAddress();

    await (await dex.createPool(a, b)).wait();

    await assert.rejects(
      () => dex.createPool.staticCall(a, b),
      /Pool already exists/
    );

    await assert.rejects(
      () => dex.createPool.staticCall(b, a),
      /Pool already exists/
    );

    await assert.rejects(
      () => dex.createPool.staticCall(a, a),
      /Identical tokens/
    );

    await assert.rejects(
      () => dex.createPool.staticCall(
        a,
        "0x0000000000000000000000000000000000000001"
      ),
      /Invalid ERC20 token/
    );

    assert.equal(await dex.poolCount(), 1n);

    console.log(
      "ISOLATED TEST: invalid and duplicate pairs rejected."
    );
  });
});