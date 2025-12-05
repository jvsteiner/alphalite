/**
 * Simplified client for token operations.
 */

import { AddressFactory } from "@unicitylabs/state-transition-sdk/lib/address/AddressFactory.js";
import type { IAddress } from "@unicitylabs/state-transition-sdk/lib/address/IAddress.js";
import { ProxyAddress } from "@unicitylabs/state-transition-sdk/lib/address/ProxyAddress.js";
import { AggregatorClient } from "@unicitylabs/state-transition-sdk/lib/api/AggregatorClient.js";
import { SubmitCommitmentStatus } from "@unicitylabs/state-transition-sdk/lib/api/SubmitCommitmentResponse.js";
import { RootTrustBase } from "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase.js";
import { DataHash } from "@unicitylabs/state-transition-sdk/lib/hash/DataHash.js";
import { DataHasher } from "@unicitylabs/state-transition-sdk/lib/hash/DataHasher.js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate.js";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService.js";
import { StateTransitionClient } from "@unicitylabs/state-transition-sdk/lib/StateTransitionClient.js";
import { CoinId } from "@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId.js";
import { TokenCoinData } from "@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData.js";
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token.js";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId.js";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState.js";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType.js";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js";
import { InclusionProof } from "@unicitylabs/state-transition-sdk/lib/transaction/InclusionProof.js";
import { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment.js";
import { MintTransactionData } from "@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData.js";
import { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment.js";
import { TransferTransaction } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction.js";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils.js";

import { CoinManager } from "./CoinManager.js";
import { SimpleToken } from "./SimpleToken.js";
import { TokenSplitter, IRecipientPayload } from "./TokenSplitter.js";
import { Wallet } from "./Wallet.js";
import {
  IMintOptions,
  IReceiveOptions,
  ISendAmountOptions,
  ISendAmountResult,
  ISendResult,
  ITokenStatus,
  ITransferOptions,
} from "./types.js";
import { generateRandom32, hexToBytes } from "./utils/crypto.js";

/** Default gateway URL */
const DEFAULT_GATEWAY = "https://goggregator-test.unicity.network";

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
  private readonly coinManager: CoinManager;
  private trustBase: RootTrustBase | null;

  public constructor(config: IAlphaClientConfig = {}) {
    const aggregatorClient = new AggregatorClient(
      config.gatewayUrl ?? DEFAULT_GATEWAY,
      config.apiKey ?? null,
    );
    this.client = new StateTransitionClient(aggregatorClient);
    this.coinManager = new CoinManager();
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
      throw new Error("Trust base not configured. Call setTrustBase() first.");
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
  public async mint(
    wallet: Wallet,
    options: IMintOptions = {},
  ): Promise<SimpleToken> {
    const trustBase = this.getTrustBase();

    // Get identity
    const identity = options.identityId
      ? wallet.getIdentity(options.identityId)
      : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    // Generate token identifiers
    const tokenId = new TokenId(options.tokenId ?? generateRandom32());
    const tokenType = new TokenType(
      options.tokenType ?? wallet.defaultTokenType,
    );

    // Build coin data if provided
    const coinData = this.buildCoinData(options.coins);

    // Get signing service and create predicate
    const signingService = await identity.getSigningService();
    const salt = generateRandom32();

    const predicate = await UnmaskedPredicate.create(
      tokenId,
      tokenType,
      signingService,
      HashAlgorithm.SHA256,
      salt,
    );

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

    // Add to wallet with salt (needed for future spending)
    wallet.addToken(simpleToken, salt, identity.id, options.label);

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
    const recipientDataHash = options.recipientData
      ? await this.hashData(options.recipientData)
      : null;
    const message = options.message
      ? new TextEncoder().encode(options.message)
      : null;

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
   * Send an amount of a coin type to a recipient.
   *
   * This is the recommended way to send tokens. The wallet automatically
   * selects tokens and performs splits as needed to fulfill the amount.
   *
   * @param wallet Wallet to send from
   * @param coinType Coin type to send (e.g., 'ALPHA')
   * @param amount Amount to send
   * @param recipientPublicKey Recipient's public key (hex string, 33 bytes compressed secp256k1)
   * @param options Send options
   * @returns Result containing payload to send to recipient
   *
   * @example
   * ```typescript
   * const result = await client.sendAmount(wallet, 'ALPHA', 500n, recipientPubKeyHex);
   * // Send result.recipientPayload to recipient
   * // Recipient calls: await client.receiveAmount(wallet, result.recipientPayload);
   * ```
   */
  public async sendAmount(
    wallet: Wallet,
    coinType: string,
    amount: bigint,
    recipientPublicKey: string,
    options: ISendAmountOptions = {},
  ): Promise<ISendAmountResult> {
    const trustBase = this.getTrustBase();

    // Validate amount
    if (amount <= 0n) {
      throw new Error("Amount must be positive");
    }

    // Get identity
    const identity = options.identityId
      ? wallet.getIdentity(options.identityId)
      : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    // Select tokens using CoinManager's fragmentation-aware algorithm
    const selection = this.coinManager.selectTokensForAmount(
      wallet,
      coinType,
      amount,
      options.identityId,
    );

    // Get signing service
    const signingService = await identity.getSigningService();

    // Parse recipient public key
    const recipientPubKeyBytes = hexToBytes(recipientPublicKey);

    // Create token splitter
    const splitter = new TokenSplitter(this.client, trustBase);

    // Handle based on selection
    if (selection.tokens.length === 1) {
      const tokenEntry = selection.tokens[0]!;
      const token = tokenEntry.token.raw;

      if (!selection.requiresSplit) {
        // Exact match - transfer full token via splitExact
        const recipientPayload = await splitter.splitExact(
          token,
          tokenEntry.salt,
          signingService,
          coinType,
          recipientPubKeyBytes,
        );

        // Remove the consumed token from wallet
        wallet.removeToken(tokenEntry.token.id);

        return {
          sent: amount,
          recipientPayload: JSON.stringify(recipientPayload),
          tokensUsed: 1,
          splitPerformed: false,
        };
      } else {
        // Need to split - sends amount, keeps change
        const splitResult = await splitter.split(
          token,
          tokenEntry.salt,
          signingService,
          coinType,
          selection.splitAmount!,
          recipientPubKeyBytes,
        );

        // Remove the original token and add the change token
        wallet.removeToken(tokenEntry.token.id);
        wallet.addToken(
          splitResult.changeToken,
          splitResult.changeSalt,
          identity.id,
          tokenEntry.label ? `${tokenEntry.label} (change)` : undefined,
        );

        return {
          sent: amount,
          recipientPayload: JSON.stringify(splitResult.recipientPayload),
          tokensUsed: 1,
          splitPerformed: true,
        };
      }
    }

    // Multiple tokens case
    // Consume all but the last token fully, split the last one if needed
    const tokensToConsume = selection.tokens.slice(0, -1);
    const lastToken = selection.tokens[selection.tokens.length - 1]!;

    // For multi-token transfers, we need to handle this differently.
    // The current implementation supports single token splits.
    // For now, we'll consume small tokens first and split the last one.

    // First, consume all the smaller tokens by transferring them fully
    // This is done via splitExact for each
    const payloads: IRecipientPayload[] = [];
    let totalSent = 0n;

    for (const tokenEntry of tokensToConsume) {
      const token = tokenEntry.token.raw;
      const tokenBalance = tokenEntry.token.getCoinBalance(coinType);

      const recipientPayload = await splitter.splitExact(
        token,
        tokenEntry.salt,
        signingService,
        coinType,
        recipientPubKeyBytes,
      );

      payloads.push(recipientPayload);
      totalSent += tokenBalance;

      // Remove the consumed token
      wallet.removeToken(tokenEntry.token.id);
    }

    // Handle the last token
    if (selection.requiresSplit) {
      // Split the last token for the remaining amount
      const splitResult = await splitter.split(
        lastToken.token.raw,
        lastToken.salt,
        signingService,
        coinType,
        selection.splitAmount!,
        recipientPubKeyBytes,
      );

      payloads.push(splitResult.recipientPayload);
      totalSent += selection.splitAmount!;

      // Remove original and add change
      wallet.removeToken(lastToken.token.id);
      wallet.addToken(
        splitResult.changeToken,
        splitResult.changeSalt,
        identity.id,
        lastToken.label ? `${lastToken.label} (change)` : undefined,
      );
    } else {
      // Full transfer of last token
      const lastTokenBalance = lastToken.token.getCoinBalance(coinType);

      const recipientPayload = await splitter.splitExact(
        lastToken.token.raw,
        lastToken.salt,
        signingService,
        coinType,
        recipientPubKeyBytes,
      );

      payloads.push(recipientPayload);
      totalSent += lastTokenBalance;

      wallet.removeToken(lastToken.token.id);
    }

    // For multi-token transfers, wrap all payloads together
    const combinedPayload = {
      type: "multi_split" as const,
      payloads,
      totalAmount: totalSent.toString(),
      coinType,
    };

    return {
      sent: totalSent,
      recipientPayload: JSON.stringify(combinedPayload),
      tokensUsed: selection.tokens.length,
      splitPerformed: selection.requiresSplit,
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
    const transaction = await TransferTransaction.fromJSON(
      JSON.parse(transactionJson),
    );

    // Get identity
    const identity = options.identityId
      ? wallet.getIdentity(options.identityId)
      : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    // Get signing service and create predicate
    const signingService = await identity.getSigningService();
    const salt = transaction.data.salt;

    const predicate = await UnmaskedPredicate.create(
      token.id,
      token.type,
      signingService,
      HashAlgorithm.SHA256,
      salt,
    );

    // Finalize transaction
    const finalizedToken = await this.client.finalizeTransaction(
      trustBase,
      token,
      new TokenState(predicate, options.transactionData ?? null),
      transaction,
    );

    const simpleToken = SimpleToken.fromToken(finalizedToken);

    // Add to wallet with salt (needed for future spending)
    wallet.addToken(simpleToken, salt, identity.id, options.label);

    return simpleToken;
  }

  /**
   * Receive tokens from an amount-based transfer.
   *
   * This handles payloads from `sendAmount()`, including both single
   * and multi-token transfers.
   *
   * @param wallet Wallet to receive into
   * @param payloadJson JSON string from sender (result.recipientPayload from sendAmount)
   * @param options Receive options
   * @returns Array of received tokens
   *
   * @example
   * ```typescript
   * const tokens = await client.receiveAmount(wallet, recipientPayload);
   * console.log(`Received ${tokens.length} token(s)`);
   * ```
   */
  public async receiveAmount(
    wallet: Wallet,
    payloadJson: string,
    options: IReceiveOptions = {},
  ): Promise<SimpleToken[]> {
    const payload = JSON.parse(payloadJson);

    // Get identity
    const identity = options.identityId
      ? wallet.getIdentity(options.identityId)
      : wallet.getDefaultIdentity();
    if (!identity) {
      throw new Error(`Identity not found: ${options.identityId}`);
    }

    const signingService = await identity.getSigningService();
    const receivedTokens: SimpleToken[] = [];

    if (payload.type === "split_mint") {
      // Single token transfer
      const token = await this.receiveSplitToken(
        wallet,
        payload as IRecipientPayload,
        identity.id,
        signingService,
        options.label,
      );
      receivedTokens.push(token);
    } else if (payload.type === "multi_split") {
      // Multiple token transfer
      for (let i = 0; i < payload.payloads.length; i++) {
        const splitPayload = payload.payloads[i] as IRecipientPayload;
        const label = options.label
          ? `${options.label} (${i + 1}/${payload.payloads.length})`
          : undefined;

        const token = await this.receiveSplitToken(
          wallet,
          splitPayload,
          identity.id,
          signingService,
          label,
        );
        receivedTokens.push(token);
      }
    } else {
      throw new Error(`Unknown payload type: ${payload.type}`);
    }

    return receivedTokens;
  }

  /**
   * Internal helper to receive a single split token.
   */
  private async receiveSplitToken(
    wallet: Wallet,
    payload: IRecipientPayload,
    identityId: string,
    signingService: SigningService,
    label?: string,
  ): Promise<SimpleToken> {
    const salt = hexToBytes(payload.salt);

    const token = await SimpleToken.fromSplitMint(
      payload.mintTransactionJson,
      salt,
      signingService,
    );

    wallet.addToken(token, salt, identityId, label);

    return token;
  }

  // ============ Token Status ============

  /**
   * Check if a token has been spent.
   *
   * @param wallet Wallet containing the token
   * @param tokenId Token ID to check
   * @returns Token status information
   */
  public async getTokenStatus(
    wallet: Wallet,
    tokenId: string,
  ): Promise<ITokenStatus> {
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
    const spent = await this.client.isTokenStateSpent(
      trustBase,
      tokenEntry.token.raw,
      signingService.publicKey,
    );

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
  public async getAddressForIdentity(
    wallet: Wallet,
    identityId: string,
    tokenType?: Uint8Array,
  ): Promise<string> {
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

  private buildCoinData(
    coins?: ReadonlyArray<readonly [string, bigint]>,
  ): TokenCoinData | null {
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
    const trustBase = this.getTrustBase();
    const timeoutMs = MAX_INCLUSION_PROOF_ATTEMPTS * INCLUSION_PROOF_POLL_DELAY;

    // Use SDK's utility which verifies the proof against trustBase
    return waitInclusionProof(
      trustBase,
      this.client,
      commitment,
      AbortSignal.timeout(timeoutMs),
      INCLUSION_PROOF_POLL_DELAY,
    );
  }

  private async hashData(data: Uint8Array): Promise<DataHash> {
    const hasher = new DataHasher(HashAlgorithm.SHA256);
    hasher.update(data);
    return hasher.digest();
  }
}
