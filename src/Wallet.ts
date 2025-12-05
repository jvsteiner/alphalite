/**
 * Multi-identity wallet for managing keys and tokens.
 */

import { AddressFactory } from "@unicitylabs/state-transition-sdk/lib/address/AddressFactory.js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference.js";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService.js";
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token.js";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType.js";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js";

import { SimpleToken } from "./SimpleToken.js";
import {
  ICreateIdentityOptions,
  IIdentityJson,
  ITokenEntryJson,
  IWalletCreateOptions,
  IWalletExportOptions,
  IWalletImportOptions,
  IWalletJson,
} from "./types.js";
import {
  bytesToHex,
  decrypt,
  deriveKey,
  encrypt,
  generateNonce,
  generateSalt,
  generateSecret,
  generateUuid,
  hexToBytes,
} from "./utils/crypto.js";

/** Current wallet format version */
export const WALLET_VERSION = "1.0";

/** Default token type (can be overridden) */
const DEFAULT_TOKEN_TYPE = new Uint8Array(32).fill(0x01);

/**
 * Represents a single identity (key pair) within a wallet.
 */
export class Identity {
  public constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly publicKey: Uint8Array,
    private readonly secret: Uint8Array,
    private nonce: Uint8Array,
    public readonly createdAt: Date,
  ) {}

  /**
   * Create a new identity with a fresh key pair.
   */
  public static async create(
    options: ICreateIdentityOptions = {},
  ): Promise<Identity> {
    const secret = options.secret ?? generateSecret();
    const nonce = generateNonce();

    const signingService = await SigningService.createFromSecret(secret, nonce);

    return new Identity(
      generateUuid(),
      options.label ?? "Default",
      signingService.publicKey,
      secret,
      nonce,
      new Date(),
    );
  }

  /**
   * Get the signing service for this identity.
   */
  public async getSigningService(): Promise<SigningService> {
    return SigningService.createFromSecret(this.secret, this.nonce);
  }

  /**
   * Get the address for this identity given a token type.
   */
  public async getAddress(tokenType: TokenType): Promise<string> {
    const signingService = await this.getSigningService();
    const reference = await UnmaskedPredicateReference.createFromSigningService(
      tokenType,
      signingService,
      HashAlgorithm.SHA256,
    );
    const address = await reference.toAddress();
    return address.toString();
  }

  /**
   * Rotate the nonce (for privacy when creating new predicates).
   */
  public rotateNonce(): void {
    this.nonce = generateNonce();
  }

  /**
   * Get the current nonce.
   */
  public getNonce(): Uint8Array {
    return new Uint8Array(this.nonce);
  }

  /**
   * Get the secret (for export/backup purposes only).
   */
  public getSecret(): Uint8Array {
    return new Uint8Array(this.secret);
  }

  /**
   * Serialize to JSON (unencrypted).
   */
  public toJSON(): IIdentityJson {
    return {
      createdAt: this.createdAt.toISOString(),
      id: this.id,
      label: this.label,
      nonce: bytesToHex(this.nonce),
      publicKey: bytesToHex(this.publicKey),
      secret: bytesToHex(this.secret),
    };
  }

  /**
   * Serialize to JSON (encrypted).
   */
  public toEncryptedJSON(encryptionKey: Uint8Array): IIdentityJson {
    return {
      createdAt: this.createdAt.toISOString(),
      encryptedSecret: bytesToHex(encrypt(this.secret, encryptionKey)),
      id: this.id,
      label: this.label,
      nonce: bytesToHex(this.nonce),
      publicKey: bytesToHex(this.publicKey),
    };
  }

  /**
   * Deserialize from JSON.
   */
  public static fromJSON(
    json: IIdentityJson,
    encryptionKey?: Uint8Array,
  ): Identity {
    let secret: Uint8Array;

    if (json.encryptedSecret) {
      if (!encryptionKey) {
        throw new Error("Encryption key required for encrypted identity");
      }
      secret = decrypt(hexToBytes(json.encryptedSecret), encryptionKey);
    } else if (json.secret) {
      secret = hexToBytes(json.secret);
    } else {
      throw new Error(
        "Identity JSON must contain either secret or encryptedSecret",
      );
    }

    return new Identity(
      json.id,
      json.label,
      hexToBytes(json.publicKey),
      secret,
      hexToBytes(json.nonce),
      new Date(json.createdAt),
    );
  }
}

/**
 * Token entry in the wallet.
 */
export class TokenEntry {
  public constructor(
    public readonly identityId: string,
    public readonly token: SimpleToken,
    public readonly salt: Uint8Array,
    public readonly label: string | undefined,
    public readonly addedAt: Date,
  ) {}

  public toJSON(): ITokenEntryJson {
    return {
      addedAt: this.addedAt.toISOString(),
      identityId: this.identityId,
      label: this.label,
      salt: bytesToHex(this.salt),
      token: this.token.toJSON(),
    };
  }

  public static async fromJSON(json: ITokenEntryJson): Promise<TokenEntry> {
    return new TokenEntry(
      json.identityId,
      await SimpleToken.fromJSON(json.token),
      hexToBytes(json.salt),
      json.label,
      new Date(json.addedAt),
    );
  }
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
export class Wallet {
  private identities: Map<string, Identity> = new Map();
  private tokens: TokenEntry[] = [];
  private defaultIdentityId: string;
  private modifiedAt: Date;

  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly defaultTokenType: Uint8Array,
    public readonly createdAt: Date,
  ) {
    this.defaultIdentityId = "";
    this.modifiedAt = createdAt;
  }

  /**
   * Create a new wallet with a fresh identity.
   */
  public static async create(
    options: IWalletCreateOptions = {},
  ): Promise<Wallet> {
    const wallet = new Wallet(
      generateUuid(),
      options.name ?? "My Wallet",
      options.defaultTokenType ?? DEFAULT_TOKEN_TYPE,
      new Date(),
    );

    const identity = await Identity.create({
      label: options.identityLabel ?? "Default",
    });

    wallet.identities.set(identity.id, identity);
    wallet.defaultIdentityId = identity.id;

    return wallet;
  }

  /**
   * Import wallet from JSON.
   */
  public static async fromJSON(
    json: IWalletJson,
    options: IWalletImportOptions = {},
  ): Promise<Wallet> {
    if (json.version !== WALLET_VERSION) {
      throw new Error(`Unsupported wallet version: ${json.version}`);
    }

    let encryptionKey: Uint8Array | undefined;
    if (json.encrypted) {
      if (!options.password) {
        throw new Error("Password required for encrypted wallet");
      }
      if (!json.salt) {
        throw new Error("Salt missing from encrypted wallet");
      }
      encryptionKey = deriveKey(options.password, hexToBytes(json.salt));
    }

    const wallet = new Wallet(
      json.id,
      json.name,
      hexToBytes(json.defaultTokenType),
      new Date(json.createdAt),
    );

    wallet.modifiedAt = new Date(json.modifiedAt);

    // Load identities
    for (const identityJson of json.identities) {
      const identity = Identity.fromJSON(identityJson, encryptionKey);
      wallet.identities.set(identity.id, identity);
    }

    wallet.defaultIdentityId = json.defaultIdentityId;

    // Load tokens
    for (const tokenJson of json.tokens) {
      wallet.tokens.push(await TokenEntry.fromJSON(tokenJson));
    }

    return wallet;
  }

  /**
   * Export wallet to JSON.
   */
  public toJSON(options: IWalletExportOptions = {}): IWalletJson {
    let encryptionKey: Uint8Array | undefined;
    let salt: string | undefined;

    if (options.password) {
      const saltBytes = generateSalt();
      salt = bytesToHex(saltBytes);
      encryptionKey = deriveKey(options.password, saltBytes);
    }

    const identities: IIdentityJson[] = [];
    for (const identity of this.identities.values()) {
      if (encryptionKey) {
        identities.push(identity.toEncryptedJSON(encryptionKey));
      } else {
        identities.push(identity.toJSON());
      }
    }

    const tokens: ITokenEntryJson[] =
      options.includeTokens !== false ? this.tokens.map((t) => t.toJSON()) : [];

    return {
      createdAt: this.createdAt.toISOString(),
      defaultIdentityId: this.defaultIdentityId,
      defaultTokenType: bytesToHex(this.defaultTokenType),
      encrypted: !!options.password,
      id: this.id,
      identities,
      modifiedAt: this.modifiedAt.toISOString(),
      name: this.name,
      salt,
      tokens,
      version: WALLET_VERSION,
    };
  }

  // ============ Identity Management ============

  /**
   * Create a new identity in this wallet.
   */
  public async createIdentity(
    options: ICreateIdentityOptions = {},
  ): Promise<Identity> {
    const identity = await Identity.create(options);
    this.identities.set(identity.id, identity);
    this.touch();

    if (options.setAsDefault) {
      this.defaultIdentityId = identity.id;
    }

    return identity;
  }

  /**
   * Import an identity from another wallet.
   */
  public importIdentity(identity: Identity, setAsDefault = false): void {
    if (this.identities.has(identity.id)) {
      throw new Error(`Identity with ID ${identity.id} already exists`);
    }

    this.identities.set(identity.id, identity);
    this.touch();

    if (setAsDefault) {
      this.defaultIdentityId = identity.id;
    }
  }

  /**
   * Get an identity by ID.
   */
  public getIdentity(id: string): Identity | undefined {
    return this.identities.get(id);
  }

  /**
   * Get the default identity.
   */
  public getDefaultIdentity(): Identity {
    const identity = this.identities.get(this.defaultIdentityId);
    if (!identity) {
      throw new Error("No default identity set");
    }
    return identity;
  }

  /**
   * Set the default identity.
   */
  public setDefaultIdentity(id: string): void {
    if (!this.identities.has(id)) {
      throw new Error(`Identity with ID ${id} not found`);
    }
    this.defaultIdentityId = id;
    this.touch();
  }

  /**
   * List all identities.
   */
  public listIdentities(): Identity[] {
    return Array.from(this.identities.values());
  }

  /**
   * Remove an identity (cannot remove the last identity or the default identity if others exist).
   */
  public removeIdentity(id: string): void {
    if (!this.identities.has(id)) {
      throw new Error(`Identity with ID ${id} not found`);
    }

    if (this.identities.size === 1) {
      throw new Error("Cannot remove the last identity");
    }

    if (id === this.defaultIdentityId) {
      // Set a new default
      for (const otherId of this.identities.keys()) {
        if (otherId !== id) {
          this.defaultIdentityId = otherId;
          break;
        }
      }
    }

    this.identities.delete(id);
    this.touch();
  }

  // ============ Token Management ============

  /**
   * Add a token to the wallet.
   * @param token The token to add
   * @param salt The salt used for predicate derivation (required for spending)
   * @param identityId Identity that owns this token (defaults to default identity)
   * @param label Human-readable label for the token
   */
  public addToken(
    token: SimpleToken,
    salt: Uint8Array,
    identityId?: string,
    label?: string,
  ): void {
    const id = identityId ?? this.defaultIdentityId;
    if (!this.identities.has(id)) {
      throw new Error(`Identity with ID ${id} not found`);
    }

    this.tokens.push(new TokenEntry(id, token, salt, label, new Date()));
    this.touch();
  }

  /**
   * Import a token from another wallet.
   */
  public importToken(entry: TokenEntry, targetIdentityId?: string): void {
    const identityId = targetIdentityId ?? entry.identityId;
    if (!this.identities.has(identityId)) {
      throw new Error(`Identity with ID ${identityId} not found`);
    }

    this.tokens.push(
      new TokenEntry(
        identityId,
        entry.token,
        entry.salt,
        entry.label,
        new Date(),
      ),
    );
    this.touch();
  }

  /**
   * Get a token by its ID.
   */
  public getToken(tokenId: string): TokenEntry | undefined {
    return this.tokens.find((e) => e.token.id === tokenId);
  }

  /**
   * List all tokens.
   */
  public listTokens(): TokenEntry[] {
    return this.tokens.slice();
  }

  /**
   * List tokens for a specific identity.
   */
  public listTokensForIdentity(identityId: string): TokenEntry[] {
    return this.tokens.filter((e) => e.identityId === identityId);
  }

  /**
   * Remove a token by its ID.
   */
  public removeToken(tokenId: string): boolean {
    const index = this.tokens.findIndex((e) => e.token.id === tokenId);
    if (index === -1) {
      return false;
    }
    this.tokens.splice(index, 1);
    this.touch();
    return true;
  }

  /**
   * Update a token (e.g., after receiving a transfer).
   */
  public updateToken(
    tokenId: string,
    newToken: SimpleToken,
    newSalt?: Uint8Array,
  ): void {
    const index = this.tokens.findIndex((e) => e.token.id === tokenId);
    if (index === -1) {
      throw new Error(`Token with ID ${tokenId} not found`);
    }

    const entry = this.tokens[index]!;
    this.tokens[index] = new TokenEntry(
      entry.identityId,
      newToken,
      newSalt ?? entry.salt,
      entry.label,
      entry.addedAt,
    );
    this.touch();
  }

  // ============ Balance Methods ============

  /**
   * Get total balance for a specific coin ID.
   *
   * @param coinId Hex-encoded coin ID
   * @param identityId Optional identity to filter by
   * @returns Total balance for the coin ID
   */
  public getBalance(coinId: string, identityId?: string): bigint {
    const tokens = identityId
      ? this.listTokensForIdentity(identityId)
      : this.tokens;

    let total = 0n;
    for (const entry of tokens) {
      total += entry.token.getCoinBalance(coinId);
    }
    return total;
  }

  /**
   * Get balances for all coin IDs in the wallet.
   *
   * @param identityId Optional identity to filter by
   * @returns Map of hex-encoded coin ID to total balance
   */
  public getBalances(identityId?: string): Map<string, bigint> {
    const tokens = identityId
      ? this.listTokensForIdentity(identityId)
      : this.tokens;

    const balances = new Map<string, bigint>();

    for (const entry of tokens) {
      for (const coin of entry.token.coins) {
        const current = balances.get(coin.coinId) ?? 0n;
        balances.set(coin.coinId, current + coin.amount);
      }
    }

    return balances;
  }

  /**
   * Check if wallet can afford an amount.
   *
   * @param coinId Hex-encoded coin ID
   * @param amount The amount needed
   * @param identityId Optional identity to filter by
   * @returns True if balance >= amount
   */
  public canAfford(
    coinId: string,
    amount: bigint,
    identityId?: string,
  ): boolean {
    return this.getBalance(coinId, identityId) >= amount;
  }

  // ============ Merge Operations ============

  /**
   * Merge another wallet into this one.
   */
  public async merge(other: Wallet): Promise<void> {
    // Merge identities
    for (const identity of other.identities.values()) {
      if (!this.identities.has(identity.id)) {
        this.identities.set(identity.id, identity);
      }
    }

    // Merge tokens (avoid duplicates by token ID)
    const existingTokenIds = new Set(this.tokens.map((e) => e.token.id));
    for (const entry of other.tokens) {
      if (!existingTokenIds.has(entry.token.id)) {
        // Map to existing identity or keep original if it was merged
        const identityId = this.identities.has(entry.identityId)
          ? entry.identityId
          : this.defaultIdentityId;
        this.tokens.push(
          new TokenEntry(
            identityId,
            entry.token,
            entry.salt,
            entry.label,
            entry.addedAt,
          ),
        );
      }
    }

    this.touch();
  }

  // ============ Address Helpers ============

  /**
   * Get the address for the default identity with the default token type.
   */
  public async getDefaultAddress(): Promise<string> {
    const identity = this.getDefaultIdentity();
    return identity.getAddress(new TokenType(this.defaultTokenType));
  }

  /**
   * Get the address for a specific identity with a specific token type.
   */
  public async getAddress(
    identityId: string,
    tokenType?: Uint8Array,
  ): Promise<string> {
    const identity = this.getIdentity(identityId);
    if (!identity) {
      throw new Error(`Identity with ID ${identityId} not found`);
    }
    return identity.getAddress(
      new TokenType(tokenType ?? this.defaultTokenType),
    );
  }

  /**
   * Parse and validate an address string.
   */
  public static async parseAddress(address: string): Promise<string> {
    const parsed = await AddressFactory.createAddress(address);
    return parsed.toString();
  }

  // ============ Internal ============

  private touch(): void {
    this.modifiedAt = new Date();
  }

  /**
   * Get the underlying Token object for SDK operations.
   */
  public getRawToken(
    tokenId: string,
  ): Token<IMintTransactionReason> | undefined {
    const entry = this.getToken(tokenId);
    return entry?.token.raw;
  }
}
