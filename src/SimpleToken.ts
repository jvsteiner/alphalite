/**
 * Simplified token wrapper for easy access to token properties.
 */

import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate.js";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService.js";
import { TokenCoinData } from "@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData.js";
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token.js";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState.js";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js";
import { MintTransaction } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransaction.js";

import { ICoinBalance } from "./types.js";
import { bytesToHex } from "./utils/crypto.js";

/**
 * Lightweight wrapper around Token providing simplified access to common properties.
 */
export class SimpleToken {
  private constructor(private readonly token: Token<IMintTransactionReason>) {}

  /**
   * Create a SimpleToken from an SDK Token.
   */
  public static fromToken(token: Token<IMintTransactionReason>): SimpleToken {
    return new SimpleToken(token);
  }

  /**
   * Deserialize from JSON string.
   */
  public static async fromJSON(json: string): Promise<SimpleToken> {
    const token = await Token.fromJSON(JSON.parse(json));
    return new SimpleToken(token);
  }

  /**
   * Deserialize from CBOR bytes.
   */
  public static async fromCBOR(bytes: Uint8Array): Promise<SimpleToken> {
    const token = await Token.fromCBOR(bytes);
    return new SimpleToken(token);
  }

  /**
   * Create a token from a split mint transaction.
   * Used when receiving tokens from a split transfer.
   *
   * @param mintTransactionJson JSON string of the mint transaction
   * @param salt Salt provided by the sender (must match what was used in the split)
   * @param signingService Signing service for the recipient
   * @returns The received token
   */
  public static async fromSplitMint(
    mintTransactionJson: string,
    salt: Uint8Array,
    signingService: SigningService,
  ): Promise<SimpleToken> {
    // Parse the mint transaction
    const mintTransaction = await MintTransaction.fromJSON(
      JSON.parse(mintTransactionJson),
    );

    // Extract token info from the mint transaction
    const tokenId = mintTransaction.data.tokenId;
    const tokenType = mintTransaction.data.tokenType;

    // Create predicate using the salt from the sender
    // CRITICAL: Must use the exact salt the sender used for our address
    const predicate = await UnmaskedPredicate.create(
      tokenId,
      tokenType,
      signingService,
      HashAlgorithm.SHA256,
      salt,
    );

    const tokenState = new TokenState(predicate, null);

    // Construct the token using fromJSON to avoid verification issues
    const tokenJson = {
      version: "2.0",
      state: tokenState.toJSON(),
      genesis: mintTransaction.toJSON(),
      transactions: [],
      nametags: [],
    };

    const token = await Token.fromJSON(tokenJson);
    return new SimpleToken(token);
  }

  // ============ Properties ============

  /**
   * Token ID as hex string.
   */
  public get id(): string {
    return bytesToHex(this.token.id.bytes);
  }

  /**
   * Token ID as bytes.
   */
  public get idBytes(): Uint8Array {
    return new Uint8Array(this.token.id.bytes);
  }

  /**
   * Token type as hex string.
   */
  public get type(): string {
    return bytesToHex(this.token.type.bytes);
  }

  /**
   * Token type as bytes.
   */
  public get typeBytes(): Uint8Array {
    return new Uint8Array(this.token.type.bytes);
  }

  /**
   * Token version.
   */
  public get version(): string {
    return this.token.version;
  }

  /**
   * Token data (if any).
   */
  public get data(): Uint8Array | null {
    return this.token.data ? new Uint8Array(this.token.data) : null;
  }

  /**
   * Token data as UTF-8 string (if data exists and is valid UTF-8).
   */
  public get dataString(): string | null {
    if (!this.token.data) {
      return null;
    }
    try {
      return new TextDecoder().decode(this.token.data);
    } catch {
      return null;
    }
  }

  /**
   * Number of transactions in the token's history.
   */
  public get transactionCount(): number {
    return this.token.transactions.length;
  }

  /**
   * Whether this token has any coin balances.
   */
  public get hasCoins(): boolean {
    return this.token.coins !== null && this.token.coins.length > 0;
  }

  /**
   * Get coin balances as a simple array.
   */
  public get coins(): ICoinBalance[] {
    if (!this.token.coins) {
      return [];
    }

    const result: ICoinBalance[] = [];
    for (const [coinId, amount] of this.token.coins.coins) {
      result.push({
        amount,
        name: this.decodeCoinName(coinId.bytes),
      });
    }

    return result;
  }

  /**
   * Get coin balances as a Map.
   */
  public get coinMap(): Map<string, bigint> {
    const map = new Map<string, bigint>();

    if (!this.token.coins) {
      return map;
    }

    for (const [coinId, amount] of this.token.coins.coins) {
      map.set(this.decodeCoinName(coinId.bytes), amount);
    }

    return map;
  }

  /**
   * Get the balance of a specific coin type.
   */
  public getCoinBalance(coinName: string): bigint {
    return this.coinMap.get(coinName) ?? 0n;
  }

  /**
   * Number of nametag tokens associated with this token.
   */
  public get nametagCount(): number {
    return this.token.nametagTokens.length;
  }

  // ============ Serialization ============

  /**
   * Serialize to JSON string.
   */
  public toJSON(): string {
    return JSON.stringify(this.token.toJSON());
  }

  /**
   * Serialize to CBOR bytes.
   */
  public toCBOR(): Uint8Array {
    return this.token.toCBOR();
  }

  /**
   * Get a human-readable summary of the token.
   */
  public toString(): string {
    const parts = [
      `Token[${this.id.slice(0, 8)}...]`,
      `type=${this.type.slice(0, 8)}...`,
      `txns=${this.transactionCount}`,
    ];

    if (this.hasCoins) {
      const coinSummary = this.coins
        .map((c) => `${c.name}:${c.amount}`)
        .join(",");
      parts.push(`coins={${coinSummary}}`);
    }

    if (this.data) {
      parts.push(`data=${this.data.length}bytes`);
    }

    return parts.join(" ");
  }

  // ============ Raw Access ============

  /**
   * Get the underlying SDK Token for advanced operations.
   */
  public get raw(): Token<IMintTransactionReason> {
    return this.token;
  }

  /**
   * Get the raw coin data for SDK operations.
   */
  public get rawCoins(): TokenCoinData | null {
    return this.token.coins;
  }

  // ============ Internal ============

  private decodeCoinName(bytes: Uint8Array): string {
    try {
      return new TextDecoder().decode(bytes);
    } catch {
      return bytesToHex(bytes);
    }
  }
}
