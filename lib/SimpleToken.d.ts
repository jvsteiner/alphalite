/**
 * Simplified token wrapper for easy access to token properties.
 */
import type { IMintTransactionReason } from '@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js';
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token.js';
import { TokenCoinData } from '@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData.js';
import { ICoinBalance } from './types.js';
/**
 * Lightweight wrapper around Token providing simplified access to common properties.
 */
export declare class SimpleToken {
    private readonly token;
    private constructor();
    /**
     * Create a SimpleToken from an SDK Token.
     */
    static fromToken(token: Token<IMintTransactionReason>): SimpleToken;
    /**
     * Deserialize from JSON string.
     */
    static fromJSON(json: string): Promise<SimpleToken>;
    /**
     * Deserialize from CBOR bytes.
     */
    static fromCBOR(bytes: Uint8Array): Promise<SimpleToken>;
    /**
     * Token ID as hex string.
     */
    get id(): string;
    /**
     * Token ID as bytes.
     */
    get idBytes(): Uint8Array;
    /**
     * Token type as hex string.
     */
    get type(): string;
    /**
     * Token type as bytes.
     */
    get typeBytes(): Uint8Array;
    /**
     * Token version.
     */
    get version(): string;
    /**
     * Token data (if any).
     */
    get data(): Uint8Array | null;
    /**
     * Token data as UTF-8 string (if data exists and is valid UTF-8).
     */
    get dataString(): string | null;
    /**
     * Number of transactions in the token's history.
     */
    get transactionCount(): number;
    /**
     * Whether this token has any coin balances.
     */
    get hasCoins(): boolean;
    /**
     * Get coin balances as a simple array.
     */
    get coins(): ICoinBalance[];
    /**
     * Get coin balances as a Map.
     */
    get coinMap(): Map<string, bigint>;
    /**
     * Get the balance of a specific coin type.
     */
    getCoinBalance(coinName: string): bigint;
    /**
     * Number of nametag tokens associated with this token.
     */
    get nametagCount(): number;
    /**
     * Serialize to JSON string.
     */
    toJSON(): string;
    /**
     * Serialize to CBOR bytes.
     */
    toCBOR(): Uint8Array;
    /**
     * Get a human-readable summary of the token.
     */
    toString(): string;
    /**
     * Get the underlying SDK Token for advanced operations.
     */
    get raw(): Token<IMintTransactionReason>;
    /**
     * Get the raw coin data for SDK operations.
     */
    get rawCoins(): TokenCoinData | null;
    private decodeCoinName;
}
//# sourceMappingURL=SimpleToken.d.ts.map