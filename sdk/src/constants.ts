/** CAIP-2 chain identifiers for Algorand networks */
export const ALGORAND_MAINNET =
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const ALGORAND_TESTNET =
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

/** Genesis hashes (base64) */
export const MAINNET_GENESIS_HASH =
  "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const TESTNET_GENESIS_HASH =
  "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

/** Genesis IDs */
export const MAINNET_GENESIS_ID = "mainnet-v1.0";
export const TESTNET_GENESIS_ID = "testnet-v1.0";

/** Map from CAIP-2 network to genesis ID */
export const NETWORK_GENESIS_ID: Record<string, string> = {
  [ALGORAND_MAINNET]: MAINNET_GENESIS_ID,
  [ALGORAND_TESTNET]: TESTNET_GENESIS_ID,
};

/** Map from CAIP-2 network to genesis hash (base64) */
export const NETWORK_GENESIS_HASH: Record<string, string> = {
  [ALGORAND_MAINNET]: MAINNET_GENESIS_HASH,
  [ALGORAND_TESTNET]: TESTNET_GENESIS_HASH,
};

/** Default algod URLs by CAIP-2 network */
export const DEFAULT_ALGOD_URLS: Record<string, string> = {
  [ALGORAND_MAINNET]: "https://mainnet-api.4160.nodely.dev",
  [ALGORAND_TESTNET]: "https://testnet-api.4160.nodely.dev",
};

/** Default indexer URLs by CAIP-2 network */
export const DEFAULT_INDEXER_URLS: Record<string, string> = {
  [ALGORAND_MAINNET]: "https://mainnet-idx.4160.nodely.dev",
  [ALGORAND_TESTNET]: "https://testnet-idx.4160.nodely.dev",
};

/** Well-known ASA IDs on Algorand MainNet */
export const USDC_MAINNET = 31566704n;
export const USDT_MAINNET = 312769n;

/** Well-known ASA IDs on Algorand TestNet */
export const USDC_TESTNET = 10458941n;

/**
 * Default minimum transaction fee in microalgos.
 * Used ONLY as a fallback when the network's `v2/transactions/params`
 * response is unavailable. Implementations MUST prefer the dynamic
 * `minFee` from network params or `suggestedParams.minFee`.
 */
export const DEFAULT_MIN_FEE = 1000n;
