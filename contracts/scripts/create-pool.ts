import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  const dexAddress =
    "0x14c9500A454aBE10F12c3f0FA571c84823650982";

  const tokenAAddress =
    "0x1B484d1856213BC74dDC546C6D7CC3354d69564c";

  const tokenBAddress =
    "0x8848A080616E8661Bdb08C5517495f8eb8ABa8a3";

  const dex = await ethers.getContractAt(
    "MiniDEX",
    dexAddress
  );
  
  console.log("DEX address:", dexAddress);
  console.log("TKA address:", tokenAAddress);
  console.log("TKB address:", tokenBAddress);

  console.log("Creating TKA/TKB pool...");

  const tx = await dex.createPool(
    tokenAAddress,
    tokenBAddress
  );

  await tx.wait();

  console.log("Pool created successfully!");

  const count = await dex.poolCount();
  console.log("Total pools:", count.toString());

  const pool = await dex.pools(1);

  console.log("Pool ID: 1");
  console.log("Token A:", pool.tokenA);
  console.log("Token B:", pool.tokenB);
  console.log("Reserve A:", pool.reserveA.toString());
  console.log("Reserve B:", pool.reserveB.toString());
  console.log(
    "Created timestamp:",
    pool.createdTimestamp.toString()
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});