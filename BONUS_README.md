# MiniDEX Bonus: dual-DEX atomic arbitrage

This is an isolated Bonus demonstration, not a modification to the deployed Ganache DEX.

- `contracts/contracts/BonusAtomicArbitrage.sol`: pre-funded, owner-controlled two-swap atomic arbitrage with minimum profit guard.
- `contracts/test/bonus-atomic-arbitrage.test.mjs`: deploys two distinct MiniDEX contracts and two tokens on isolated Hardhat EDR 31337, creates identical token pair at different prices, demonstrates profitable A -> B -> A trade, then asserts an unprofitable attempt reverts both swaps.

Run in PowerShell from project root:

```powershell
Set-Location .\contracts
npx hardhat test mocha test/bonus-atomic-arbitrage.test.mjs --network hardhat
if ($LASTEXITCODE -ne 0) { throw "Bonus test failed" }
```

Expected: 1 passing; console shows distinct DEX addresses via transaction evidence, calculated profit in TKA, and atomic revert verification. No Ganache writes.

Important: This is NOT flash-loan arbitrage. Capital is prefunded. Gas and opportunity costs are not deducted from the TKA-denominated gross profit. Both DEXs are simulated instances of the same MiniDEX contract, which satisfies the two-DEX demonstration concept but course grading must be checked against the official assignment.
