/**
 * Simplified token wrapper for easy access to token properties.
 */
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token.js';
import { bytesToHex } from './utils/crypto.js';
/**
 * Lightweight wrapper around Token providing simplified access to common properties.
 */
export class SimpleToken {
    token;
    constructor(token) {
        this.token = token;
    }
    /**
     * Create a SimpleToken from an SDK Token.
     */
    static fromToken(token) {
        return new SimpleToken(token);
    }
    /**
     * Deserialize from JSON string.
     */
    static async fromJSON(json) {
        const token = await Token.fromJSON(JSON.parse(json));
        return new SimpleToken(token);
    }
    /**
     * Deserialize from CBOR bytes.
     */
    static async fromCBOR(bytes) {
        const token = await Token.fromCBOR(bytes);
        return new SimpleToken(token);
    }
    // ============ Properties ============
    /**
     * Token ID as hex string.
     */
    get id() {
        return bytesToHex(this.token.id.bytes);
    }
    /**
     * Token ID as bytes.
     */
    get idBytes() {
        return new Uint8Array(this.token.id.bytes);
    }
    /**
     * Token type as hex string.
     */
    get type() {
        return bytesToHex(this.token.type.bytes);
    }
    /**
     * Token type as bytes.
     */
    get typeBytes() {
        return new Uint8Array(this.token.type.bytes);
    }
    /**
     * Token version.
     */
    get version() {
        return this.token.version;
    }
    /**
     * Token data (if any).
     */
    get data() {
        return this.token.data ? new Uint8Array(this.token.data) : null;
    }
    /**
     * Token data as UTF-8 string (if data exists and is valid UTF-8).
     */
    get dataString() {
        if (!this.token.data) {
            return null;
        }
        try {
            return new TextDecoder().decode(this.token.data);
        }
        catch {
            return null;
        }
    }
    /**
     * Number of transactions in the token's history.
     */
    get transactionCount() {
        return this.token.transactions.length;
    }
    /**
     * Whether this token has any coin balances.
     */
    get hasCoins() {
        return this.token.coins !== null && this.token.coins.length > 0;
    }
    /**
     * Get coin balances as a simple array.
     */
    get coins() {
        if (!this.token.coins) {
            return [];
        }
        const result = [];
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
    get coinMap() {
        const map = new Map();
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
    getCoinBalance(coinName) {
        return this.coinMap.get(coinName) ?? 0n;
    }
    /**
     * Number of nametag tokens associated with this token.
     */
    get nametagCount() {
        return this.token.nametagTokens.length;
    }
    // ============ Serialization ============
    /**
     * Serialize to JSON string.
     */
    toJSON() {
        return JSON.stringify(this.token.toJSON());
    }
    /**
     * Serialize to CBOR bytes.
     */
    toCBOR() {
        return this.token.toCBOR();
    }
    /**
     * Get a human-readable summary of the token.
     */
    toString() {
        const parts = [
            `Token[${this.id.slice(0, 8)}...]`,
            `type=${this.type.slice(0, 8)}...`,
            `txns=${this.transactionCount}`,
        ];
        if (this.hasCoins) {
            const coinSummary = this.coins.map((c) => `${c.name}:${c.amount}`).join(',');
            parts.push(`coins={${coinSummary}}`);
        }
        if (this.data) {
            parts.push(`data=${this.data.length}bytes`);
        }
        return parts.join(' ');
    }
    // ============ Raw Access ============
    /**
     * Get the underlying SDK Token for advanced operations.
     */
    get raw() {
        return this.token;
    }
    /**
     * Get the raw coin data for SDK operations.
     */
    get rawCoins() {
        return this.token.coins;
    }
    // ============ Internal ============
    decodeCoinName(bytes) {
        try {
            return new TextDecoder().decode(bytes);
        }
        catch {
            return bytesToHex(bytes);
        }
    }
}
//# sourceMappingURL=SimpleToken.js.map