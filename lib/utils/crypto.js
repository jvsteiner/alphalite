/**
 * Cryptographic utilities for wallet encryption and key management.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
/** Salt length for scrypt key derivation */
const SALT_LENGTH = 32;
/** Nonce length for XChaCha20-Poly1305 */
const NONCE_LENGTH = 24;
/** Scrypt parameters (N=2^17, r=8, p=1) - secure but not too slow */
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
/**
 * Derive an encryption key from a password using scrypt.
 * @param password User password
 * @param salt Salt bytes (32 bytes)
 * @returns 32-byte derived key
 */
export function deriveKey(password, salt) {
    const passwordBytes = new TextEncoder().encode(password);
    return scrypt(passwordBytes, salt, { N: SCRYPT_N, p: SCRYPT_P, r: SCRYPT_R, dkLen: 32 });
}
/**
 * Encrypt data using XChaCha20-Poly1305.
 * @param plaintext Data to encrypt
 * @param key 32-byte encryption key
 * @returns Encrypted data with nonce prepended (nonce || ciphertext)
 */
export function encrypt(plaintext, key) {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = xchacha20poly1305(key, nonce);
    const ciphertext = cipher.encrypt(plaintext);
    // Prepend nonce to ciphertext
    const result = new Uint8Array(NONCE_LENGTH + ciphertext.length);
    result.set(nonce, 0);
    result.set(ciphertext, NONCE_LENGTH);
    return result;
}
/**
 * Decrypt data using XChaCha20-Poly1305.
 * @param encrypted Encrypted data with nonce prepended (nonce || ciphertext)
 * @param key 32-byte encryption key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or corrupted data)
 */
export function decrypt(encrypted, key) {
    if (encrypted.length < NONCE_LENGTH + 16) {
        throw new Error('Encrypted data too short');
    }
    const nonce = encrypted.slice(0, NONCE_LENGTH);
    const ciphertext = encrypted.slice(NONCE_LENGTH);
    const cipher = xchacha20poly1305(key, nonce);
    return cipher.decrypt(ciphertext);
}
/**
 * Generate a random salt for key derivation.
 * @returns 32-byte random salt
 */
export function generateSalt() {
    return randomBytes(SALT_LENGTH);
}
/**
 * Generate a random nonce for predicate derivation.
 * @returns 32-byte random nonce
 */
export function generateNonce() {
    return randomBytes(32);
}
/**
 * Generate a random secret for identity creation.
 * @returns 128-byte random secret
 */
export function generateSecret() {
    return randomBytes(128);
}
/**
 * Generate a random 32-byte value (for token IDs, types, salts).
 * @returns 32-byte random value
 */
export function generateRandom32() {
    return randomBytes(32);
}
/**
 * Generate a UUID v4.
 * @returns UUID string
 */
export function generateUuid() {
    const bytes = randomBytes(16);
    // Set version (4) and variant (RFC 4122)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
/**
 * Hash data using SHA-256.
 * @param data Data to hash
 * @returns 32-byte hash
 */
export function hash(data) {
    return sha256(data);
}
/**
 * Convert bytes to hex string.
 * @param bytes Byte array
 * @returns Hex string (lowercase)
 */
export function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Convert hex string to bytes.
 * @param hex Hex string
 * @returns Byte array
 * @throws Error if hex string is invalid
 */
export function hexToBytes(hex) {
    if (hex.length % 2 !== 0) {
        throw new Error('Invalid hex string length');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (isNaN(byte)) {
            throw new Error(`Invalid hex character at position ${i * 2}`);
        }
        bytes[i] = byte;
    }
    return bytes;
}
//# sourceMappingURL=crypto.js.map