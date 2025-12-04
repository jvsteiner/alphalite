/**
 * Multi-identity wallet for managing keys and tokens.
 */
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService.js';
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token.js';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType.js';
import type { IMintTransactionReason } from '@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js';
import { SimpleToken } from './SimpleToken.js';
import { ICreateIdentityOptions, IIdentityJson, ITokenEntryJson, IWalletCreateOptions, IWalletExportOptions, IWalletImportOptions, IWalletJson } from './types.js';
/** Current wallet format version */
export declare const WALLET_VERSION = "1.0";
/**
 * Represents a single identity (key pair) within a wallet.
 */
export declare class Identity {
    readonly id: string;
    readonly label: string;
    readonly publicKey: Uint8Array;
    private readonly secret;
    private nonce;
    readonly createdAt: Date;
    constructor(id: string, label: string, publicKey: Uint8Array, secret: Uint8Array, nonce: Uint8Array, createdAt: Date);
    /**
     * Create a new identity with a fresh key pair.
     */
    static create(options?: ICreateIdentityOptions): Promise<Identity>;
    /**
     * Get the signing service for this identity.
     */
    getSigningService(): Promise<SigningService>;
    /**
     * Get the address for this identity given a token type.
     */
    getAddress(tokenType: TokenType): Promise<string>;
    /**
     * Rotate the nonce (for privacy when creating new predicates).
     */
    rotateNonce(): void;
    /**
     * Get the current nonce.
     */
    getNonce(): Uint8Array;
    /**
     * Get the secret (for export/backup purposes only).
     */
    getSecret(): Uint8Array;
    /**
     * Serialize to JSON (unencrypted).
     */
    toJSON(): IIdentityJson;
    /**
     * Serialize to JSON (encrypted).
     */
    toEncryptedJSON(encryptionKey: Uint8Array): IIdentityJson;
    /**
     * Deserialize from JSON.
     */
    static fromJSON(json: IIdentityJson, encryptionKey?: Uint8Array): Identity;
}
/**
 * Token entry in the wallet.
 */
export declare class TokenEntry {
    readonly identityId: string;
    readonly token: SimpleToken;
    readonly label: string | undefined;
    readonly addedAt: Date;
    constructor(identityId: string, token: SimpleToken, label: string | undefined, addedAt: Date);
    toJSON(): ITokenEntryJson;
    static fromJSON(json: ITokenEntryJson): Promise<TokenEntry>;
}
/**
 * Multi-identity wallet for managing keys and tokens.
 *
 * Features:
 * - Multiple identities (key pairs) per wallet
 * - Token storage and management
 * - Encrypted export/import
 * - Mergeable with other wallets
 */
export declare class Wallet {
    readonly id: string;
    readonly name: string;
    readonly defaultTokenType: Uint8Array;
    readonly createdAt: Date;
    private identities;
    private tokens;
    private defaultIdentityId;
    private modifiedAt;
    private constructor();
    /**
     * Create a new wallet with a fresh identity.
     */
    static create(options?: IWalletCreateOptions): Promise<Wallet>;
    /**
     * Import wallet from JSON.
     */
    static fromJSON(json: IWalletJson, options?: IWalletImportOptions): Promise<Wallet>;
    /**
     * Export wallet to JSON.
     */
    toJSON(options?: IWalletExportOptions): IWalletJson;
    /**
     * Create a new identity in this wallet.
     */
    createIdentity(options?: ICreateIdentityOptions): Promise<Identity>;
    /**
     * Import an identity from another wallet.
     */
    importIdentity(identity: Identity, setAsDefault?: boolean): void;
    /**
     * Get an identity by ID.
     */
    getIdentity(id: string): Identity | undefined;
    /**
     * Get the default identity.
     */
    getDefaultIdentity(): Identity;
    /**
     * Set the default identity.
     */
    setDefaultIdentity(id: string): void;
    /**
     * List all identities.
     */
    listIdentities(): Identity[];
    /**
     * Remove an identity (cannot remove the last identity or the default identity if others exist).
     */
    removeIdentity(id: string): void;
    /**
     * Add a token to the wallet.
     */
    addToken(token: SimpleToken, identityId?: string, label?: string): void;
    /**
     * Import a token from another wallet.
     */
    importToken(entry: TokenEntry, targetIdentityId?: string): void;
    /**
     * Get a token by its ID.
     */
    getToken(tokenId: string): TokenEntry | undefined;
    /**
     * List all tokens.
     */
    listTokens(): TokenEntry[];
    /**
     * List tokens for a specific identity.
     */
    listTokensForIdentity(identityId: string): TokenEntry[];
    /**
     * Remove a token by its ID.
     */
    removeToken(tokenId: string): boolean;
    /**
     * Update a token (e.g., after receiving a transfer).
     */
    updateToken(tokenId: string, newToken: SimpleToken): void;
    /**
     * Merge another wallet into this one.
     */
    merge(other: Wallet): Promise<void>;
    /**
     * Get the address for the default identity with the default token type.
     */
    getDefaultAddress(): Promise<string>;
    /**
     * Get the address for a specific identity with a specific token type.
     */
    getAddress(identityId: string, tokenType?: Uint8Array): Promise<string>;
    /**
     * Parse and validate an address string.
     */
    static parseAddress(address: string): Promise<string>;
    private touch;
    /**
     * Get the underlying Token object for SDK operations.
     */
    getRawToken(tokenId: string): Token<IMintTransactionReason> | undefined;
}
//# sourceMappingURL=Wallet.d.ts.map