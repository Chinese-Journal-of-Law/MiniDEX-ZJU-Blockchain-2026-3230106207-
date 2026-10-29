// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ========== 事件 ==========

    event PoolCreated(
        uint256 indexed poolId,
        address tokenA,
        address tokenB
    );

    event LiquidityAdded(
        uint256 indexed poolId,
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 shares
    );

    event LiquidityNFTMinted(
        uint256 indexed tokenId,
        uint256 indexed poolId,
        address indexed owner,
        uint256 shares
    );

    event LiquidityRemoved(
        uint256 indexed poolId,
        uint256 indexed tokenId,
        address indexed owner,
        uint256 amountA,
        uint256 amountB
    );

    event Swap(
        uint256 indexed poolId,
        address indexed user,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );

    // ========== 数据结构 ==========

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 createdTimestamp;
        uint256 totalShares;
    }

    struct LiquidityPosition {
        uint256 poolId;
        uint256 shares;
        uint256 amountA;
        uint256 amountB;
        uint256 createdTimestamp;
    }

    // 交易池编号 => 交易池信息
    mapping(uint256 => Pool) public pools;

    // 代币对 => 交易池编号
    mapping(bytes32 => uint256) public poolIdByPair;

    // NFT 编号 => 流动性仓位
    mapping(uint256 => LiquidityPosition) public positions;

    uint256 public poolCount;
    uint256 public nextTokenId = 1;

    // ========== 构造函数 ==========

    constructor()
        ERC721("MiniDEX Liquidity Position", "MLP")
    {}

    function helloworld()
        external
        pure
        returns (string memory)
    {
        return "hello world";
    }

    // ========== 创建交易池 ==========

    function createPool(
        address tokenA,
        address tokenB
    ) external returns (uint256 poolId) {

        require(
            tokenA != address(0) && tokenB != address(0),
            "Zero token address"
        );

        require(
            tokenA != tokenB,
            "Identical tokens"
        );

        require(
            _isERC20(tokenA) && _isERC20(tokenB),
            "Invalid ERC20 token"
        );

        // 将代币地址排序，防止重复创建反向交易池
        (address token0, address token1) =
            tokenA < tokenB
                ? (tokenA, tokenB)
                : (tokenB, tokenA);

        bytes32 pairKey = keccak256(
            abi.encode(token0, token1)
        );

        require(
            poolIdByPair[pairKey] == 0,
            "Pool already exists"
        );

        poolId = ++poolCount;

        poolIdByPair[pairKey] = poolId;

        pools[poolId] = Pool(
            tokenA,
            tokenB,
            0,
            0,
            block.timestamp,
            0
        );

        emit PoolCreated(
            poolId,
            tokenA,
            tokenB
        );
    }

    // ========== 添加流动性并铸造 NFT ==========

    function addLiquidity(
        uint256 poolId,
        uint256 amountA,
        uint256 amountB
    )
        external
        nonReentrant
        returns (uint256 shares)
    {
        Pool storage pool = pools[poolId];

        require(
            pool.tokenA != address(0),
            "Pool does not exist"
        );

        require(
            amountA > 0 && amountB > 0,
            "Zero amount"
        );

        if (pool.totalShares == 0) {
            require(
                pool.reserveA == 0 && pool.reserveB == 0,
                "Invalid initial reserves"
            );

            shares = _sqrt(amountA * amountB);
        } else {
            require(
                pool.reserveA > 0 && pool.reserveB > 0,
                "Invalid reserves"
            );

            require(
                amountA * pool.reserveB
                    == amountB * pool.reserveA,
                "Incorrect token ratio"
            );

            shares =
                amountA * pool.totalShares
                / pool.reserveA;
        }

        require(
            shares > 0,
            "Shares are zero"
        );

        // 更新交易池储备和总份额
        pool.reserveA += amountA;
        pool.reserveB += amountB;
        pool.totalShares += shares;

        // 创建独立的流动性 NFT 仓位
        uint256 tokenId = nextTokenId++;

        positions[tokenId] = LiquidityPosition(
            poolId,
            shares,
            amountA,
            amountB,
            block.timestamp
        );

        // 将两种 ERC20 代币转入交易池
        IERC20(pool.tokenA).safeTransferFrom(
            msg.sender,
            address(this),
            amountA
        );

        IERC20(pool.tokenB).safeTransferFrom(
            msg.sender,
            address(this),
            amountB
        );

        // 铸造 ERC721 NFT
        _safeMint(msg.sender, tokenId);

        emit LiquidityNFTMinted(
            tokenId,
            poolId,
            msg.sender,
            shares
        );

        emit LiquidityAdded(
            poolId,
            msg.sender,
            amountA,
            amountB,
            shares
        );
    }

    // ========== 销毁 NFT 并移除流动性 ==========

    function removeLiquidity(
        uint256 tokenId,
        uint256 minAmountA,
        uint256 minAmountB
    )
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        // 1. 只有 NFT 当前持有人可以赎回
        require(
            ownerOf(tokenId) == msg.sender,
            "Not NFT owner"
        );

        // 2. 读取 NFT 记录的流动性份额
        LiquidityPosition memory position =
            positions[tokenId];

        Pool storage pool =
            pools[position.poolId];

        require(
            position.shares > 0 &&
                pool.totalShares >= position.shares,
            "Invalid shares"
        );

        // 3. 按当前储备及份额计算赎回数量
        amountA =
            position.shares * pool.reserveA
            / pool.totalShares;

        amountB =
            position.shares * pool.reserveB
            / pool.totalShares;

        require(
            amountA > 0 && amountB > 0,
            "Zero redemption"
        );

        // 4. 防止实际赎回数量低于用户要求
        require(
            amountA >= minAmountA &&
                amountB >= minAmountB,
            "Slippage too high"
        );

        // 5. 更新池子储备和总份额
        pool.reserveA -= amountA;
        pool.reserveB -= amountB;
        pool.totalShares -= position.shares;

        // 6. 删除仓位记录
        delete positions[tokenId];

        // 7. 销毁 NFT
        _burn(tokenId);

        // 8. 把代币返还给 NFT 持有人
        IERC20(pool.tokenA).safeTransfer(
            msg.sender,
            amountA
        );

        IERC20(pool.tokenB).safeTransfer(
            msg.sender,
            amountB
        );

        emit LiquidityRemoved(
            position.poolId,
            tokenId,
            msg.sender,
            amountA,
            amountB
        );
    }

    // ========== AMM 代币兑换 ==========

    function swap(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    )
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        Pool storage pool = pools[poolId];

        require(
            pool.tokenA != address(0),
            "Pool does not exist"
        );

        require(
            amountIn > 0,
            "Amount is zero"
        );

        require(
            pool.reserveA > 0 && pool.reserveB > 0,
            "Pool has no liquidity"
        );

        bool isA = tokenIn == pool.tokenA;

        require(
            isA || tokenIn == pool.tokenB,
            "Invalid input token"
        );

        uint256 reserveIn = isA
            ? pool.reserveA
            : pool.reserveB;

        uint256 reserveOut = isA
            ? pool.reserveB
            : pool.reserveA;

        // 0.3% 手续费
        uint256 amountInWithFee = amountIn * 997;

        amountOut =
            amountInWithFee * reserveOut
            / (reserveIn * 1000 + amountInWithFee);

        require(
            amountOut > 0 && amountOut < reserveOut,
            "Invalid output"
        );

        require(
            amountOut >= minAmountOut,
            "Slippage too high"
        );

        // 更新储备
        if (isA) {
            pool.reserveA += amountIn;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += amountIn;
            pool.reserveA -= amountOut;
        }

        // 收取输入代币
        IERC20(tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            amountIn
        );

        // 发放输出代币
        IERC20(
            isA ? pool.tokenB : pool.tokenA
        ).safeTransfer(
            msg.sender,
            amountOut
        );

        emit Swap(
            poolId,
            msg.sender,
            tokenIn,
            amountIn,
            amountOut
        );
    }

    // ========== 内部辅助函数 ==========

    function _isERC20(
        address token
    ) private view returns (bool) {

        if (token.code.length == 0) {
            return false;
        }

        try IERC20(token).totalSupply()
            returns (uint256)
        {
            return true;
        } catch {
            return false;
        }
    }

    function _sqrt(
        uint256 y
    ) private pure returns (uint256 z) {

        if (y == 0) {
            return 0;
        }

        if (y <= 3) {
            return 1;
        }

        z = y;

        uint256 x = y / 2 + 1;

        while (x < z) {
            z = x;
            x = (y / x + x) / 2;
        }
    }
}