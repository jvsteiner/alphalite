/**
 * Alphalite type definitions.
 */

/**
 * Serialized identity (key) within a wallet.
 */
export interface IIdentityJson {
  /** Unique identifier for this identity within the wallet */
  readonly id: string;
  /** Human-readable label for this identity */
  readonly label: string;
  /** Hex-encoded public key (33 bytes compressed secp256k1) */
  readonly publicKey: string;
  /** Hex-encoded encrypted secret (when wallet is encrypted) */
  readonly encryptedSecret?: string;
  /** Hex-encoded secret (when wallet is not encrypted) - NEVER store unencrypted in production */
  readonly secret?: string;
  /** Hex-encoded current nonce for address derivation */
  readonly nonce: string;
  /** ISO timestamp when this identity was created */
  readonly createdAt: string;
}

/**
 * Serialized token reference within a wallet.
 */
export interface ITokenEntryJson {
  /** Identity ID that owns this token */
  readonly identityId: string;
  /** Serialized SimpleToken JSON */
  readonly token: string;
  /** Hex-encoded salt used for predicate derivation (required for spending) */
  readonly salt: string;
  /** Human-readable label for this token */
  readonly label?: string;
  /** ISO timestamp when token was added to wallet */
  readonly addedAt: string;
}

/**
 * Serialized wallet structure.
 */
export interface IWalletJson {
  /** Wallet format version */
  readonly version: string;
  /** Unique wallet identifier */
  readonly id: string;
  /** Human-readable wallet name */
  readonly name: string;
  /** Whether the wallet secrets are encrypted */
  readonly encrypted: boolean;
  /** Hex-encoded salt for key derivation (when encrypted) */
  readonly salt?: string;
  /** All identities (keys) in this wallet */
  readonly identities: IIdentityJson[];
  /** ID of the default/active identity */
  readonly defaultIdentityId: string;
  /** All tokens owned by this wallet */
  readonly tokens: ITokenEntryJson[];
  /** Hex-encoded default token type */
  readonly defaultTokenType: string;
  /** ISO timestamp when wallet was created */
  readonly createdAt: string;
  /** ISO timestamp when wallet was last modified */
  readonly modifiedAt: string;
}

/**
 * Options for minting a new token.
 */
export interface IMintOptions {
  /** Token ID (32 bytes) - auto-generated if not provided */
  readonly tokenId?: Uint8Array;
  /** Token type (32 bytes) - uses wallet default if not provided */
  readonly tokenType?: Uint8Array;
  /** Token data payload */
  readonly data?: Uint8Array;
  /** Coin balances as [coinName, amount] pairs */
  readonly coins?: ReadonlyArray<readonly [string, bigint]>;
  /** Identity ID to mint with - uses default if not provided */
  readonly identityId?: string;
  /** Human-readable label for the token */
  readonly label?: string;
}

/**
 * Options for transferring a token.
 */
export interface ITransferOptions {
  /** Optional message to include in transaction */
  readonly message?: string;
  /** Optional data for recipient */
  readonly recipientData?: Uint8Array;
}

/**
 * Result of a send operation.
 */
export interface ISendResult {
  /** The token (for recipient) */
  readonly tokenJson: string;
  /** The transaction (for recipient) */
  readonly transactionJson: string;
}

/**
 * Options for receiving a token.
 */
export interface IReceiveOptions {
  /** Identity ID to receive with - uses default if not provided */
  readonly identityId?: string;
  /** Human-readable label for the token */
  readonly label?: string;
  /** Transaction data that matches recipientDataHash */
  readonly transactionData?: Uint8Array;
}

/**
 * Options for creating a new identity.
 */
export interface ICreateIdentityOptions {
  /** Human-readable label */
  readonly label?: string;
  /** Import existing secret instead of generating */
  readonly secret?: Uint8Array;
  /** Set as default identity */
  readonly setAsDefault?: boolean;
}

/**
 * Options for wallet creation.
 */
export interface IWalletCreateOptions {
  /** Wallet name */
  readonly name?: string;
  /** Default token type (32 bytes) */
  readonly defaultTokenType?: Uint8Array;
  /** Initial identity label */
  readonly identityLabel?: string;
}

/**
 * Options for importing wallet from JSON.
 */
export interface IWalletImportOptions {
  /** Password for decryption (required if wallet is encrypted) */
  readonly password?: string;
  /** Merge into existing wallet instead of replacing */
  readonly merge?: boolean;
}

/**
 * Options for exporting wallet to JSON.
 */
export interface IWalletExportOptions {
  /** Password for encryption (if provided, wallet will be encrypted) */
  readonly password?: string;
  /** Include tokens in export */
  readonly includeTokens?: boolean;
}

/**
 * Simplified coin balance representation.
 */
export interface ICoinBalance {
  readonly name: string;
  readonly amount: bigint;
}

/**
 * Token status information.
 */
export interface ITokenStatus {
  readonly spent: boolean;
  readonly transactionCount: number;
}

/**
 * Options for amount-based transfers.
 */
export interface ISendAmountOptions {
  /** Identity ID to send from - uses default if not provided */
  readonly identityId?: string;
}

/**
 * Result of an amount-based send operation.
 */
export interface ISendAmountResult {
  /** Amount sent */
  readonly sent: bigint;
  /** JSON payload to send to recipient (they call receiveAmount with this) */
  readonly recipientPayload: string;
  /** Number of tokens consumed in this transfer */
  readonly tokensUsed: number;
  /** Whether a split was performed (true if change was created) */
  readonly splitPerformed: boolean;
}
