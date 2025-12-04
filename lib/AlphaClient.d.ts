/**
 * Simplified client for token operations.
 */
import type { IAddress } from '@unicitylabs/state-transition-sdk/lib/address/IAddress.js';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase.js';
import { SimpleToken } from './SimpleToken.js';
import { Wallet } from './Wallet.js';
import { IMintOptions, IReceiveOptions, ISendResult, ITokenStatus, ITransferOptions } from './types.js';
/**
 * Configuration options for AlphaClient.
 */
export interface IAlphaClientConfig {
    /** Gateway URL (defaults to test gateway) */
    readonly gatewayUrl?: string;
    /** Trust base for verification */
    readonly trustBase?: RootTrustBase;
    /** API key for authentication (optional) */
    readonly apiKey?: string;
}
/**
 * Simplified client for common token operations.
 *
 * Wraps StateTransitionClient to provide a higher-level, easier-to-use API.
 */
export declare class AlphaClient {
    private readonly client;
    private trustBase;
    constructor(config?: IAlphaClientConfig);
    /**
     * Set the trust base for verification.
     */
    setTrustBase(trustBase: RootTrustBase): void;
    /**
     * Load trust base from JSON object.
     */
    static loadTrustBase(json: unknown): RootTrustBase;
    /**
     * Get the current trust base (throws if not set).
     */
    private getTrustBase;
    /**
     * Mint a new token.
     *
     * @param wallet Wallet containing the identity to mint with
     * @param options Minting options
     * @returns The minted token
     *
     * @example
     * ```typescript
     * const token = await client.mint(wallet);
     *
     * // With options
     * const token = await client.mint(wallet, {
     *   coins: [['ALPHA', 1000n]],
     *   data: new TextEncoder().encode('My NFT'),
     *   label: 'My First Token'
     * });
     * ```
     */
    mint(wallet: Wallet, options?: IMintOptions): Promise<SimpleToken>;
    /**
     * Send a token to a recipient.
     *
     * @param wallet Wallet containing the token
     * @param tokenId Token ID (hex string) to send
     * @param recipientAddress Recipient address string
     * @param options Transfer options
     * @returns JSON strings for token and transaction to send to recipient
     *
     * @example
     * ```typescript
     * const result = await client.send(wallet, tokenId, recipientAddress);
     * // Send result.tokenJson and result.transactionJson to recipient
     * ```
     */
    send(wallet: Wallet, tokenId: string, recipientAddress: string, options?: ITransferOptions): Promise<ISendResult>;
    /**
     * Receive a token from a sender.
     *
     * @param wallet Wallet to receive into
     * @param tokenJson Token JSON string from sender
     * @param transactionJson Transaction JSON string from sender
     * @param options Receive options
     * @returns The received token
     *
     * @example
     * ```typescript
     * const token = await client.receive(wallet, tokenJson, transactionJson);
     * ```
     */
    receive(wallet: Wallet, tokenJson: string, transactionJson: string, options?: IReceiveOptions): Promise<SimpleToken>;
    /**
     * Check if a token has been spent.
     *
     * @param wallet Wallet containing the token
     * @param tokenId Token ID to check
     * @returns Token status information
     */
    getTokenStatus(wallet: Wallet, tokenId: string): Promise<ITokenStatus>;
    /**
     * Get the address for a wallet's default identity with the default token type.
     */
    getAddress(wallet: Wallet): Promise<string>;
    /**
     * Get the address for a specific identity with a specific token type.
     */
    getAddressForIdentity(wallet: Wallet, identityId: string, tokenType?: Uint8Array): Promise<string>;
    /**
     * Create a proxy address from a nametag.
     */
    createNametag(name: string): Promise<string>;
    /**
     * Parse and validate an address string.
     */
    parseAddress(address: string): Promise<IAddress>;
    private buildCoinData;
    private waitForInclusionProof;
    private hashData;
    private delay;
}
//# sourceMappingURL=AlphaClient.d.ts.map