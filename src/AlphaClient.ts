/**
 * Simplified client for token operations.
 */

import { AddressFactory } from '@unicitylabs/state-transition-sdk/lib/address/AddressFactory.js';
import type { IAddress } from '@unicitylabs/state-transition-sdk/lib/address/IAddress.js';
import { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress.js';
import { AggregatorClient } from '@unicitylabs/state-transition-sdk/lib/api/AggregatorClient.js';
import { SubmitCommitmentStatus } from '@unicitylabs/state-transition-sdk/lib/api/SubmitCommitmentResponse.js';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase.js';
import { DataHash } from '@unicitylabs/state-transition-sdk/lib/hash/DataHash.js';
import { DataHasher } from '@unicitylabs/state-transition-sdk/lib/hash/DataHasher.js';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js';
import { UnmaskedPredicate } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate.js';
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient.js';
import { CoinId } from '@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId.js';
import { TokenCoinData } from '@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData.js';
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token.js';
import { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId.js';
import { TokenState } from '@unicitylabs/state-transition-sdk/lib/token/TokenState.js';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType.js';
import type { IMintTransactionReason } from '@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js';
import { InclusionProof } from '@unicitylabs/state-transition-sdk/lib/transaction/InclusionProof.js';
import { MintCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment.js';
import { MintTransactionData } from '@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData.js';
import { TransferCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment.js';
import { TransferTransaction } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction.js';

import { SimpleToken } from './SimpleToken.js';
import { Wallet } from './Wallet.js';
import { IMintOptions, IReceiveOptions, ISendResult, ITokenStatus, ITransferOptions } from './types.js';
import { generateRandom32 } from './utils/crypto.js';

/** Default gateway URL */
const DEFAULT_GATEWAY = 'https://gateway-test.unicity.network:443';

/** Maximum attempts for polling inclusion proof */
const MAX_INCLUSION_PROOF_ATTEMPTS = 30;

/** Delay between inclusion proof polling attempts (ms) */
const INCLUSION_PROOF_POLL_DELAY = 1000;

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
export class AlphaClient {
  private readonly client: StateTransitionClient;
  private trustBase: RootTrustBase | null;

  public constructor(config: IAlphaClientConfig = {}) {
    const aggregatorClient = new AggregatorClient(config.gatewayUrl ?? DEFAULT_GATEWAY, config.apiKey ?? null);
    this.client = new StateTransitionClient(aggregatorClient);
    this.trustBase = config.trustBase ?? null;
  }

  // ============ Trust Base ============

  /**
   * Set the trust base for verification.
   */
  public setTrustBase(trustBase: RootTrustBase): void {
    this.trustBase = trustBase;
  }

  /**
   * Load trust base from JSON object.
   */
  public static loadTrustBase(json: unknown): RootTrustBase {
    return RootTrustBase.fromJSON(json);
  }

  /**
   * Get the current trust base (throws if not set).
   */
  private getTrustBase(): RootTrustBase {
    if (!this.trustBase) {
      throw new Error('Trust base not configured. Call setTrustBase() first.');
    }
    return this.trustBase;
  }

  // ============ Minting ============

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
  public async mint(wallet: Wallet, options: IMintOptions = {}): Promise<SimpleToken> {
    const trustBase = this.getTrustBase();

    // Get identity
    const identity = options.identityId ? wallet.getIdentity(options.identityId) : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    // Generate token identifiers
    const tokenId = new TokenId(options.tokenId ?? generateRandom32());
    const tokenType = new TokenType(options.tokenType ?? wallet.defaultTokenType);

    // Build coin data if provided
    const coinData = this.buildCoinData(options.coins);

    // Get signing service and create predicate
    const signingService = await identity.getSigningService();
    const salt = generateRandom32();

    const predicate = await UnmaskedPredicate.create(tokenId, tokenType, signingService, HashAlgorithm.SHA256, salt);

    // Generate recipient address
    const predicateReference = await predicate.getReference();
    const recipientAddress = await predicateReference.toAddress();

    // Create mint transaction data
    const mintData = await MintTransactionData.create(
      tokenId,
      tokenType,
      options.data ?? null,
      coinData,
      recipientAddress,
      salt,
      null,
      null,
    );

    // Create and submit commitment
    const commitment = await MintCommitment.create(mintData);
    const response = await this.client.submitMintCommitment(commitment);

    if (response.status !== SubmitCommitmentStatus.SUCCESS) {
      throw new Error(`Mint submission failed: ${response.status}`);
    }

    // Wait for inclusion proof
    const inclusionProof = await this.waitForInclusionProof(commitment);

    // Create token
    const token = await Token.mint(
      trustBase,
      new TokenState(predicate, null),
      commitment.toTransaction(inclusionProof),
    );

    const simpleToken = SimpleToken.fromToken(token);

    // Add to wallet
    wallet.addToken(simpleToken, identity.id, options.label);

    return simpleToken;
  }

  // ============ Transfer ============

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
  public async send(
    wallet: Wallet,
    tokenId: string,
    recipientAddress: string,
    options: ITransferOptions = {},
  ): Promise<ISendResult> {
    // Get token from wallet
    const tokenEntry = wallet.getToken(tokenId);
    if (!tokenEntry) {
      throw new Error(`Token not found in wallet: ${tokenId}`);
    }

    // Get identity that owns this token
    const identity = wallet.getIdentity(tokenEntry.identityId);
    if (!identity) {
      throw new Error(`Identity not found: ${tokenEntry.identityId}`);
    }

    const token = tokenEntry.token.raw;

    // Parse recipient address
    const recipient = await this.parseAddress(recipientAddress);

    // Get signing service
    const signingService = await identity.getSigningService();

    // Create transfer commitment
    const salt = generateRandom32();
    const recipientDataHash = options.recipientData ? await this.hashData(options.recipientData) : null;
    const message = options.message ? new TextEncoder().encode(options.message) : null;

    const commitment = await TransferCommitment.create(
      token,
      recipient,
      salt,
      recipientDataHash,
      message,
      signingService,
    );

    // Submit commitment
    const response = await this.client.submitTransferCommitment(commitment);
    if (response.status !== SubmitCommitmentStatus.SUCCESS) {
      throw new Error(`Transfer submission failed: ${response.status}`);
    }

    // Wait for inclusion proof
    const inclusionProof = await this.waitForInclusionProof(commitment);

    // Create transaction
    const transaction = commitment.toTransaction(inclusionProof);

    // Remove token from wallet (it's been sent)
    wallet.removeToken(tokenId);

    return {
      tokenJson: JSON.stringify(token.toJSON()),
      transactionJson: JSON.stringify(transaction.toJSON()),
    };
  }

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
  public async receive(
    wallet: Wallet,
    tokenJson: string,
    transactionJson: string,
    options: IReceiveOptions = {},
  ): Promise<SimpleToken> {
    const trustBase = this.getTrustBase();

    // Parse token and transaction
    const token = await Token.fromJSON(JSON.parse(tokenJson));
    const transaction = await TransferTransaction.fromJSON(JSON.parse(transactionJson));

    // Get identity
    const identity = options.identityId ? wallet.getIdentity(options.identityId) : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    // Get signing service and create predicate
    const signingService = await identity.getSigningService();
    const salt = transaction.data.salt;

    const predicate = await UnmaskedPredicate.create(token.id, token.type, signingService, HashAlgorithm.SHA256, salt);

    // Finalize transaction
    const finalizedToken = await this.client.finalizeTransaction(
      trustBase,
      token,
      new TokenState(predicate, options.transactionData ?? null),
      transaction,
    );

    const simpleToken = SimpleToken.fromToken(finalizedToken);

    // Add to wallet
    wallet.addToken(simpleToken, identity.id, options.label);

    return simpleToken;
  }

  // ============ Token Status ============

  /**
   * Check if a token has been spent.
   *
   * @param wallet Wallet containing the token
   * @param tokenId Token ID to check
   * @returns Token status information
   */
  public async getTokenStatus(wallet: Wallet, tokenId: string): Promise<ITokenStatus> {
    const trustBase = this.getTrustBase();

    const tokenEntry = wallet.getToken(tokenId);
    if (!tokenEntry) {
      throw new Error(`Token not found in wallet: ${tokenId}`);
    }

    const identity = wallet.getIdentity(tokenEntry.identityId);
    if (!identity) {
      throw new Error(`Identity not found: ${tokenEntry.identityId}`);
    }

    const signingService = await identity.getSigningService();
    const spent = await this.client.isTokenStateSpent(trustBase, tokenEntry.token.raw, signingService.publicKey);

    return {
      spent,
      transactionCount: tokenEntry.token.transactionCount,
    };
  }

  // ============ Address Helpers ============

  /**
   * Get the address for a wallet's default identity with the default token type.
   */
  public async getAddress(wallet: Wallet): Promise<string> {
    return wallet.getDefaultAddress();
  }

  /**
   * Get the address for a specific identity with a specific token type.
   */
  public async getAddressForIdentity(wallet: Wallet, identityId: string, tokenType?: Uint8Array): Promise<string> {
    return wallet.getAddress(identityId, tokenType);
  }

  /**
   * Create a proxy address from a nametag.
   */
  public async createNametag(name: string): Promise<string> {
    const proxyAddress = await ProxyAddress.fromNameTag(name);
    return proxyAddress.toString();
  }

  /**
   * Parse and validate an address string.
   */
  public async parseAddress(address: string): Promise<IAddress> {
    return AddressFactory.createAddress(address);
  }

  // ============ Internal ============

  private buildCoinData(coins?: ReadonlyArray<readonly [string, bigint]>): TokenCoinData | null {
    if (!coins || coins.length === 0) {
      return null;
    }

    const textEncoder = new TextEncoder();
    const coinEntries: Array<[CoinId, bigint]> = coins.map(([name, amount]) => [
      new CoinId(textEncoder.encode(name)),
      amount,
    ]);

    return TokenCoinData.create(coinEntries);
  }

  private async waitForInclusionProof(
    commitment: MintCommitment<IMintTransactionReason> | TransferCommitment,
  ): Promise<InclusionProof> {
    const requestId = commitment.requestId;

    for (let attempt = 0; attempt < MAX_INCLUSION_PROOF_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.getInclusionProof(requestId);
        return response.inclusionProof;
      } catch {
        if (attempt === MAX_INCLUSION_PROOF_ATTEMPTS - 1) {
          throw new Error(`Inclusion proof not found after ${MAX_INCLUSION_PROOF_ATTEMPTS} attempts`);
        }
        await this.delay(INCLUSION_PROOF_POLL_DELAY);
      }
    }

    throw new Error('Inclusion proof polling exhausted');
  }

  private async hashData(data: Uint8Array): Promise<DataHash> {
    const hasher = new DataHasher(HashAlgorithm.SHA256);
    hasher.update(data);
    return hasher.digest();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
