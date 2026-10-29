import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.create();

  const tokenA = await ethers.deployContract(
    "MockToken",
    ["Token A", "TKA"]
  );

  await tokenA.waitForDeployment();

  console.log(
    "Token A deployed to:",
    await tokenA.getAddress()
  );

  const tokenB = await ethers.deployContract(
    "MockToken",
    ["Token B", "TKB"]
  );

  await tokenB.waitForDeployment();

  console.log(
    "Token B deployed to:",
    await tokenB.getAddress()
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});