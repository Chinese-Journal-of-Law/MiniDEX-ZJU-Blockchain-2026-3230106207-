/** The existing aware-coil deployment. Never deploy or reset from the frontend. */
import { DEX_ADDRESS, TKA_ADDRESS, TKB_ADDRESS, TKC_ADDRESS } from "../contracts";

export const AWARE_COIL = {
  chainId: 1337n,
  account0: "0xa9256D5500Dbd83C84eFa948039089Ec95d02795",
  dex: DEX_ADDRESS,
  tokenA: TKA_ADDRESS,
  tokenB: TKB_ADDRESS,
  tokenC: TKC_ADDRESS,
  existingPool1: 1n,
  existingPool2: 2n,
  protectedNfts: [4n, 5n] as const,
  // Known successful *100+100* Pool 2 receipt; read-only workspace fingerprint.
  pool2SeedTx:
    "0xcb8d2dd8149d917ca4a44bf89844fac14965b078d72542ea0275d80f6b0e440a",
  // A historical observation, not proof that #6 currently exists.
  archivedNextTokenId: 6n,
  depositAmount: "10",
} as const;
