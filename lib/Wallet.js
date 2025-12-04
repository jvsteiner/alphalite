/**
 * Multi-identity wallet for managing keys and tokens.
 */
import { AddressFactory } from '@unicitylabs/state-transition-sdk/lib/address/AddressFactory.js';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js';
import { UnmaskedPredicateReference } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference.js';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService.js';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType.js';
import { SimpleToken } from './SimpleToken.js';
import { bytesToHex, decrypt, deriveKey, encrypt, generateNonce, generateSalt, generateSecret, generateUuid, hexToBytes, } from './utils/crypto.js';
/** Current wallet format version */
export const WALLET_VERSION = '1.0';
/** Default token type (can be overridden) */
const DEFAULT_TOKEN_TYPE = new Uint8Array(32).fill(0x01);
/**
 * Represents a single identity (key pair) within a wallet.
 */
export class Identity {
    id;
    label;
    publicKey;
    secret;
    nonce;
    createdAt;
    constructor(id, label, publicKey, secret, nonce, createdAt) {
        this.id = id;
        this.label = label;
        this.publicKey = publicKey;
        this.secret = secret;
        this.nonce = nonce;
        this.createdAt = createdAt;
    }
    /**
     * Create a new identity with a fresh key pair.
     */
    static async create(options = {}) {
        const secret = options.secret ?? generateSecret();
        const nonce = generateNonce();
        const signingService = await SigningService.createFromSecret(secret, nonce);
        return new Identity(generateUuid(), options.label ?? 'Default', signingService.publicKey, secret, nonce, new Date());
    }
    /**
     * Get the signing service for this identity.
     */
    async getSigningService() {
        return SigningService.createFromSecret(this.secret, this.nonce);
    }
    /**
     * Get the address for this identity given a token type.
     */
    async getAddress(tokenType) {
        const signingService = await this.getSigningService();
        const reference = await UnmaskedPredicateReference.createFromSigningService(tokenType, signingService, HashAlgorithm.SHA256);
        const address = await reference.toAddress();
        return address.toString();
    }
    /**
     * Rotate the nonce (for privacy when creating new predicates).
     */
    rotateNonce() {
        this.nonce = generateNonce();
    }
    /**
     * Get the current nonce.
     */
    getNonce() {
        return new Uint8Array(this.nonce);
    }
    /**
     * Get the secret (for export/backup purposes only).
     */
    getSecret() {
        return new Uint8Array(this.secret);
    }
    /**
     * Serialize to JSON (unencrypted).
     */
    toJSON() {
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
    toEncryptedJSON(encryptionKey) {
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
    static fromJSON(json, encryptionKey) {
        let secret;
        if (json.encryptedSecret) {
            if (!encryptionKey) {
                throw new Error('Encryption key required for encrypted identity');
            }
            secret = decrypt(hexToBytes(json.encryptedSecret), encryptionKey);
        }
        else if (json.secret) {
            secret = hexToBytes(json.secret);
        }
        else {
            throw new Error('Identity JSON must contain either secret or encryptedSecret');
        }
        return new Identity(json.id, json.label, hexToBytes(json.publicKey), secret, hexToBytes(json.nonce), new Date(json.createdAt));
    }
}
/**
 * Token entry in the wallet.
 */
export class TokenEntry {
    identityId;
    token;
    label;
    addedAt;
    constructor(identityId, token, label, addedAt) {
        this.identityId = identityId;
        this.token = token;
        this.label = label;
        this.addedAt = addedAt;
    }
    toJSON() {
        return {
            addedAt: this.addedAt.toISOString(),
            identityId: this.identityId,
            label: this.label,
            token: this.token.toJSON(),
        };
    }
    static async fromJSON(json) {
        return new TokenEntry(json.identityId, await SimpleToken.fromJSON(json.token), json.label, new Date(json.addedAt));
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
    id;
    name;
    defaultTokenType;
    createdAt;
    identities = new Map();
    tokens = [];
    defaultIdentityId;
    modifiedAt;
    constructor(id, name, defaultTokenType, createdAt) {
        this.id = id;
        this.name = name;
        this.defaultTokenType = defaultTokenType;
        this.createdAt = createdAt;
        this.defaultIdentityId = '';
        this.modifiedAt = createdAt;
    }
    /**
     * Create a new wallet with a fresh identity.
     */
    static async create(options = {}) {
        const wallet = new Wallet(generateUuid(), options.name ?? 'My Wallet', options.defaultTokenType ?? DEFAULT_TOKEN_TYPE, new Date());
        const identity = await Identity.create({
            label: options.identityLabel ?? 'Default',
        });
        wallet.identities.set(identity.id, identity);
        wallet.defaultIdentityId = identity.id;
        return wallet;
    }
    /**
     * Import wallet from JSON.
     */
    static async fromJSON(json, options = {}) {
        if (json.version !== WALLET_VERSION) {
            throw new Error(`Unsupported wallet version: ${json.version}`);
        }
        let encryptionKey;
        if (json.encrypted) {
            if (!options.password) {
                throw new Error('Password required for encrypted wallet');
            }
            if (!json.salt) {
                throw new Error('Salt missing from encrypted wallet');
            }
            encryptionKey = deriveKey(options.password, hexToBytes(json.salt));
        }
        const wallet = new Wallet(json.id, json.name, hexToBytes(json.defaultTokenType), new Date(json.createdAt));
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
    toJSON(options = {}) {
        let encryptionKey;
        let salt;
        if (options.password) {
            const saltBytes = generateSalt();
            salt = bytesToHex(saltBytes);
            encryptionKey = deriveKey(options.password, saltBytes);
        }
        const identities = [];
        for (const identity of this.identities.values()) {
            if (encryptionKey) {
                identities.push(identity.toEncryptedJSON(encryptionKey));
            }
            else {
                identities.push(identity.toJSON());
            }
        }
        const tokens = options.includeTokens !== false ? this.tokens.map((t) => t.toJSON()) : [];
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
    async createIdentity(options = {}) {
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
    importIdentity(identity, setAsDefault = false) {
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
    getIdentity(id) {
        return this.identities.get(id);
    }
    /**
     * Get the default identity.
     */
    getDefaultIdentity() {
        const identity = this.identities.get(this.defaultIdentityId);
        if (!identity) {
            throw new Error('No default identity set');
        }
        return identity;
    }
    /**
     * Set the default identity.
     */
    setDefaultIdentity(id) {
        if (!this.identities.has(id)) {
            throw new Error(`Identity with ID ${id} not found`);
        }
        this.defaultIdentityId = id;
        this.touch();
    }
    /**
     * List all identities.
     */
    listIdentities() {
        return Array.from(this.identities.values());
    }
    /**
     * Remove an identity (cannot remove the last identity or the default identity if others exist).
     */
    removeIdentity(id) {
        if (!this.identities.has(id)) {
            throw new Error(`Identity with ID ${id} not found`);
        }
        if (this.identities.size === 1) {
            throw new Error('Cannot remove the last identity');
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
     */
    addToken(token, identityId, label) {
        const id = identityId ?? this.defaultIdentityId;
        if (!this.identities.has(id)) {
            throw new Error(`Identity with ID ${id} not found`);
        }
        this.tokens.push(new TokenEntry(id, token, label, new Date()));
        this.touch();
    }
    /**
     * Import a token from another wallet.
     */
    importToken(entry, targetIdentityId) {
        const identityId = targetIdentityId ?? entry.identityId;
        if (!this.identities.has(identityId)) {
            throw new Error(`Identity with ID ${identityId} not found`);
        }
        this.tokens.push(new TokenEntry(identityId, entry.token, entry.label, new Date()));
        this.touch();
    }
    /**
     * Get a token by its ID.
     */
    getToken(tokenId) {
        return this.tokens.find((e) => e.token.id === tokenId);
    }
    /**
     * List all tokens.
     */
    listTokens() {
        return this.tokens.slice();
    }
    /**
     * List tokens for a specific identity.
     */
    listTokensForIdentity(identityId) {
        return this.tokens.filter((e) => e.identityId === identityId);
    }
    /**
     * Remove a token by its ID.
     */
    removeToken(tokenId) {
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
    updateToken(tokenId, newToken) {
        const index = this.tokens.findIndex((e) => e.token.id === tokenId);
        if (index === -1) {
            throw new Error(`Token with ID ${tokenId} not found`);
        }
        const entry = this.tokens[index];
        this.tokens[index] = new TokenEntry(entry.identityId, newToken, entry.label, entry.addedAt);
        this.touch();
    }
    // ============ Merge Operations ============
    /**
     * Merge another wallet into this one.
     */
    async merge(other) {
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
                const identityId = this.identities.has(entry.identityId) ? entry.identityId : this.defaultIdentityId;
                this.tokens.push(new TokenEntry(identityId, entry.token, entry.label, entry.addedAt));
            }
        }
        this.touch();
    }
    // ============ Address Helpers ============
    /**
     * Get the address for the default identity with the default token type.
     */
    async getDefaultAddress() {
        const identity = this.getDefaultIdentity();
        return identity.getAddress(new TokenType(this.defaultTokenType));
    }
    /**
     * Get the address for a specific identity with a specific token type.
     */
    async getAddress(identityId, tokenType) {
        const identity = this.getIdentity(identityId);
        if (!identity) {
            throw new Error(`Identity with ID ${identityId} not found`);
        }
        return identity.getAddress(new TokenType(tokenType ?? this.defaultTokenType));
    }
    /**
     * Parse and validate an address string.
     */
    static async parseAddress(address) {
        const parsed = await AddressFactory.createAddress(address);
        return parsed.toString();
    }
    // ============ Internal ============
    touch() {
        this.modifiedAt = new Date();
    }
    /**
     * Get the underlying Token object for SDK operations.
     */
    getRawToken(tokenId) {
        const entry = this.getToken(tokenId);
        return entry?.token.raw;
    }
}
//# sourceMappingURL=Wallet.js.map