/**
 * Alphalite - Lightweight wallet and token management for Unicity Protocol.
 *
 * @packageDocumentation
 */

// Core classes
export { AlphaClient, IAlphaClientConfig } from "./AlphaClient.js";
export { Identity, TokenEntry, Wallet, WALLET_VERSION } from "./Wallet.js";
export { SimpleToken } from "./SimpleToken.js";
export { CoinManager, ITokenSelection } from "./CoinManager.js";
export {
  TokenSplitter,
  ISplitResult,
  IRecipientPayload,
} from "./TokenSplitter.js";

// Types
export {
  ICoinBalance,
  ICreateIdentityOptions,
  IIdentityJson,
  IMintOptions,
  IReceiveOptions,
  ISendAmountOptions,
  ISendAmountResult,
  ISendResult,
  ITokenEntryJson,
  ITokenStatus,
  ITransferOptions,
  IWalletCreateOptions,
  IWalletExportOptions,
  IWalletImportOptions,
  IWalletJson,
} from "./types.js";

// Utilities
export {
  bytesToHex,
  generateRandom32,
  generateSecret,
  hexToBytes,
} from "./utils/crypto.js";

// Re-export commonly used SDK types for convenience
export { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js";
export { RootTrustBase } from "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase.js";
export { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token.js";
export { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId.js";
export { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType.js";
export type { VerificationResult } from "@unicitylabs/state-transition-sdk/lib/verification/VerificationResult.js";
