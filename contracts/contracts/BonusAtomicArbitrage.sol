// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBonusMiniDEX {
    function swap(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut);
}

/// @notice Pre-funded atomic cross-DEX arbitrage demo; NOT a flash loan.
/// @dev Owner deposits tokenA principal; one transaction executes both swaps or reverts.
contract BonusAtomicArbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    event ArbitrageExecuted(
        address indexed firstDex,
        address indexed secondDex,
        address indexed tokenA,
        uint256 amountIn,
        uint256 amountBack,
        uint256 profit
    );

    error OnlyOwner();
    error InvalidRoute();
    error InsufficientPrincipal();
    error ProfitTooLow(uint256 actual, uint256 minimum);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function execute(
        address firstDex,
        uint256 firstPoolId,
        address secondDex,
        uint256 secondPoolId,
        address tokenA,
        address tokenB,
        uint256 amountIn,
        uint256 minIntermediateOut,
        uint256 minFinalOut,
        uint256 minProfit
    ) external onlyOwner nonReentrant returns (uint256 profit) {
        if (
            firstDex == address(0) ||
            secondDex == address(0) ||
            firstDex == secondDex ||
            tokenA == address(0) ||
            tokenB == address(0) ||
            tokenA == tokenB ||
            amountIn == 0
        ) revert InvalidRoute();

        uint256 balanceBefore = IERC20(tokenA).balanceOf(address(this));
        if (balanceBefore < amountIn) revert InsufficientPrincipal();

        IERC20(tokenA).forceApprove(firstDex, amountIn);
        uint256 intermediate = IBonusMiniDEX(firstDex).swap(
            firstPoolId, tokenA, amountIn, minIntermediateOut
        );
        IERC20(tokenA).forceApprove(firstDex, 0);

        IERC20(tokenB).forceApprove(secondDex, intermediate);
        uint256 amountBack = IBonusMiniDEX(secondDex).swap(
            secondPoolId, tokenB, intermediate, minFinalOut
        );
        IERC20(tokenB).forceApprove(secondDex, 0);

        uint256 balanceAfter = IERC20(tokenA).balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert ProfitTooLow(0, minProfit);
        profit = balanceAfter - balanceBefore;
        if (profit < minProfit) revert ProfitTooLow(profit, minProfit);

        emit ArbitrageExecuted(
            firstDex, secondDex, tokenA, amountIn, amountBack, profit
        );
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner, amount);
    }
}
