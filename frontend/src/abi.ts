
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function claim()",
  "function hasClaimed(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export const MINIDEX_ABI = [
  // Pool creation and discovery
  "function createPool(address tokenA,address tokenB) returns (uint256 poolId)",
  "function poolCount() view returns (uint256)",
  "function poolIdByPair(bytes32) view returns (uint256)",

  // Pool information
  "function pools(uint256) view returns (address tokenA,address tokenB,uint256 reserveA,uint256 reserveB,uint256 createdTimestamp,uint256 totalShares)",

  // Liquidity and NFT positions
  "function addLiquidity(uint256 poolId,uint256 amountA,uint256 amountB) returns (uint256 shares)",
  "function removeLiquidity(uint256 tokenId,uint256 minAmountA,uint256 minAmountB) returns (uint256 amountA,uint256 amountB)",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint256 poolId,uint256 shares,uint256 amountA,uint256 amountB,uint256 createdTimestamp)",

  // Swap
  "function swap(uint256 poolId,address tokenIn,uint256 amountIn,uint256 minAmountOut) returns (uint256 amountOut)",

  // Events
  "event PoolCreated(uint256 indexed poolId,address tokenA,address tokenB)",
  "event LiquidityAdded(uint256 indexed poolId,address indexed provider,uint256 amountA,uint256 amountB,uint256 shares)",
  "event LiquidityNFTMinted(uint256 indexed tokenId,uint256 indexed poolId,address indexed owner,uint256 shares)",
  "event LiquidityRemoved(uint256 indexed poolId,uint256 indexed tokenId,address indexed owner,uint256 amountA,uint256 amountB)",
  "event Swap(uint256 indexed poolId,address indexed user,address tokenIn,uint256 amountIn,uint256 amountOut)",
];