/**
 * Cryptographic utilities for wallet encryption and key management.
 */
/**
 * Derive an encryption key from a password using scrypt.
 * @param password User password
 * @param salt Salt bytes (32 bytes)
 * @returns 32-byte derived key
 */
export declare function deriveKey(password: string, salt: Uint8Array): Uint8Array;
/**
 * Encrypt data using XChaCha20-Poly1305.
 * @param plaintext Data to encrypt
 * @param key 32-byte encryption key
 * @returns Encrypted data with nonce prepended (nonce || ciphertext)
 */
export declare function encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array;
/**
 * Decrypt data using XChaCha20-Poly1305.
 * @param encrypted Encrypted data with nonce prepended (nonce || ciphertext)
 * @param key 32-byte encryption key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or corrupted data)
 */
export declare function decrypt(encrypted: Uint8Array, key: Uint8Array): Uint8Array;
/**
 * Generate a random salt for key derivation.
 * @returns 32-byte random salt
 */
export declare function generateSalt(): Uint8Array;
/**
 * Generate a random nonce for predicate derivation.
 * @returns 32-byte random nonce
 */
export declare function generateNonce(): Uint8Array;
/**
 * Generate a random secret for identity creation.
 * @returns 128-byte random secret
 */
export declare function generateSecret(): Uint8Array;
/**
 * Generate a random 32-byte value (for token IDs, types, salts).
 * @returns 32-byte random value
 */
export declare function generateRandom32(): Uint8Array;
/**
 * Generate a UUID v4.
 * @returns UUID string
 */
export declare function generateUuid(): string;
/**
 * Hash data using SHA-256.
 * @param data Data to hash
 * @returns 32-byte hash
 */
export declare function hash(data: Uint8Array): Uint8Array;
/**
 * Convert bytes to hex string.
 * @param bytes Byte array
 * @returns Hex string (lowercase)
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Convert hex string to bytes.
 * @param hex Hex string
 * @returns Byte array
 * @throws Error if hex string is invalid
 */
export declare function hexToBytes(hex: string): Uint8Array;
//# sourceMappingURL=crypto.d.ts.map