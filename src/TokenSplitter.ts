/**
 * Token splitting operations for partial transfers.
 */

import { SubmitCommitmentStatus } from "@unicitylabs/state-transition-sdk/lib/api/SubmitCommitmentResponse.js";
import { RootTrustBase } from "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase.js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm.js";
import { UnmaskedPredicate } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate.js";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference.js";
import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService.js";
import { StateTransitionClient } from "@unicitylabs/state-transition-sdk/lib/StateTransitionClient.js";
import { CoinId } from "@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId.js";
import { TokenCoinData } from "@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData.js";
import { Token } from "@unicitylabs/state-transition-sdk/lib/token/Token.js";
import { TokenId } from "@unicitylabs/state-transition-sdk/lib/token/TokenId.js";
import { TokenState } from "@unicitylabs/state-transition-sdk/lib/token/TokenState.js";
import type { IMintTransactionReason } from "@unicitylabs/state-transition-sdk/lib/transaction/IMintTransactionReason.js";
import { TokenSplitBuilder } from "@unicitylabs/state-transition-sdk/lib/transaction/split/TokenSplitBuilder.js";
import { waitInclusionProof } from "@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils.js";
import type { MintCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment.js";
import type { TransferCommitment } from "@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment.js";

import { SimpleToken } from "./SimpleToken.js";
import { bytesToHex, generateRandom32, hexToBytes } from "./utils/crypto.js";

/**
 * Callback invoked immediately after a token is burned on the blockchain
 * but before minting new tokens. This is the critical save point to prevent
 * stale tokens if subsequent operations fail.
 *
 * @param burnedTokenId The hex ID of the token that was just burned
 */
export type OnTokenBurnedCallback = (
  burnedTokenId: string,
) => void | Promise<void>;

/**
 * Result of a split operation.
 */
export interface ISplitResult {
  /** The change token (remaining balance, owned by sender) */
  changeToken: SimpleToken;
  /** Salt for the change token (needed for future spending) */
  changeSalt: Uint8Array;
  /** Payload to send to recipient */
  recipientPayload: IRecipientPayload;
}

/**
 * Payload sent to recipient after a split transfer.
 */
export interface IRecipientPayload {
  /** Type indicator for split transfers */
  type: "split_mint";
  /** Mint transaction JSON for recipient's token */
  mintTransactionJson: string;
  /** Salt for recipient to create their predicate */
  salt: string;
  /** Amount transferred */
  amount: string;
  /** Hex-encoded coin ID */
  coinId: string;
}

/**
 * Result of a full token transfer (no split needed).
 */
export interface IFullTransferResult {
  /** Payload to send to recipient */
  recipientPayload: IRecipientPayload;
}

/**
 * Handles token splitting for partial transfers.
 *
 * When sending an amount less than a token's balance, the token must be
 * burned and two new tokens minted: one for the recipient and one for
 * the sender (change).
 */
export class TokenSplitter {
  public constructor(
    private readonly client: StateTransitionClient,
    private readonly trustBase: RootTrustBase,
    private readonly onTokenBurned?: OnTokenBurnedCallback,
  ) {}

  /**
   * Split a token, sending `amount` to recipient and keeping change.
   *
   * @param token The token to split
   * @param tokenSalt Salt used when the token was created (for signing)
   * @param signingService Signing service for the token owner
   * @param coinId Hex-encoded coin ID
   * @param amount Amount to send to recipient
   * @param recipientPublicKey Recipient's public key (33 bytes compressed secp256k1)
   * @returns Split result with change token and recipient payload
   */
  public async split(
    token: Token<IMintTransactionReason>,
    tokenSalt: Uint8Array,
    signingService: SigningService,
    coinId: string,
    amount: bigint,
    recipientPublicKey: Uint8Array,
  ): Promise<ISplitResult> {
    const coinIdObj = new CoinId(hexToBytes(coinId));
    const tokenBalance = token.coins?.get(coinIdObj) ?? 0n;
    const changeAmount = tokenBalance - amount;

    if (changeAmount < 0n) {
      throw new Error(
        `Insufficient balance: have ${tokenBalance}, need ${amount}`,
      );
    }

    if (changeAmount === 0n) {
      throw new Error("Use splitExact() when sending the full balance");
    }

    // Generate new token IDs and salts
    const recipientTokenId = new TokenId(generateRandom32());
    const changeTokenId = new TokenId(generateRandom32());
    const recipientSalt = generateRandom32();
    const changeSalt = generateRandom32();

    // Create addresses for both output tokens
    const recipientPredicateRef = await UnmaskedPredicateReference.create(
      token.type,
      "secp256k1",
      recipientPublicKey,
      HashAlgorithm.SHA256,
    );
    const recipientAddress = await recipientPredicateRef.toAddress();

    const myPredicateRef =
      await UnmaskedPredicateReference.createFromSigningService(
        token.type,
        signingService,
        HashAlgorithm.SHA256,
      );
    const myAddress = await myPredicateRef.toAddress();

    // Build coin data for each new token
    const recipientCoinData = TokenCoinData.create([[coinIdObj, amount]]);
    const changeCoinData = TokenCoinData.create([[coinIdObj, changeAmount]]);

    // Build the split
    const builder = new TokenSplitBuilder();

    // Add recipient token (index 0)
    builder.createToken(
      recipientTokenId,
      token.type,
      null, // tokenData
      recipientCoinData,
      recipientAddress,
      recipientSalt,
      null, // recipientDataHash
    );

    // Add change token (index 1)
    builder.createToken(
      changeTokenId,
      token.type,
      null,
      changeCoinData,
      myAddress,
      changeSalt,
      null,
    );

    const split = await builder.build(token);

    // Submit burn commitment
    const burnSalt = generateRandom32();
    const burnCommitment = await split.createBurnCommitment(
      burnSalt,
      signingService,
    );

    const burnResponse =
      await this.client.submitTransferCommitment(burnCommitment);
    if (burnResponse.status !== SubmitCommitmentStatus.SUCCESS) {
      throw new Error(`Burn commitment failed: ${burnResponse.status}`);
    }

    // Wait for burn inclusion proof
    const burnProof = await this.waitForInclusionProof(burnCommitment);
    const burnTransaction = burnCommitment.toTransaction(burnProof);

    // CRITICAL SAVE POINT: Token is now burned on blockchain.
    // Notify caller so they can persist wallet state immediately.
    // If any subsequent operations fail, the wallet will be in a consistent
    // state with the burned token already removed.
    if (this.onTokenBurned) {
      await this.onTokenBurned(bytesToHex(token.id.bytes));
    }

    // Submit mint commitments
    const mintCommitments = await split.createSplitMintCommitments(
      this.trustBase,
      burnTransaction,
    );
    const mintTransactions = [];

    for (const mintCommitment of mintCommitments) {
      const mintResponse =
        await this.client.submitMintCommitment(mintCommitment);
      if (mintResponse.status !== SubmitCommitmentStatus.SUCCESS) {
        throw new Error(`Mint commitment failed: ${mintResponse.status}`);
      }

      const mintProof = await this.waitForInclusionProof(mintCommitment);
      mintTransactions.push(mintCommitment.toTransaction(mintProof));
    }

    // Create change token (index 1)
    const changePredicate = await UnmaskedPredicate.create(
      changeTokenId,
      token.type,
      signingService,
      HashAlgorithm.SHA256,
      changeSalt,
    );

    const changeTokenJson = {
      version: "2.0",
      state: new TokenState(changePredicate, null).toJSON(),
      genesis: mintTransactions[1]!.toJSON(),
      transactions: [],
      nametags: [],
    };

    const changeToken = await Token.fromJSON(changeTokenJson);

    return {
      changeToken: SimpleToken.fromToken(changeToken),
      changeSalt,
      recipientPayload: {
        type: "split_mint",
        mintTransactionJson: JSON.stringify(mintTransactions[0]!.toJSON()),
        salt: bytesToHex(recipientSalt),
        amount: amount.toString(),
        coinId,
      },
    };
  }

  /**
   * Transfer full token balance via split (burns original, mints new for recipient).
   * Used when the transfer amount exactly equals the token balance.
   *
   * @param token The token to transfer
   * @param tokenSalt Salt used when the token was created
   * @param signingService Signing service for the token owner
   * @param coinId Hex-encoded coin ID
   * @param recipientPublicKey Recipient's public key (33 bytes compressed secp256k1)
   * @returns Payload for recipient
   */
  public async splitExact(
    token: Token<IMintTransactionReason>,
    tokenSalt: Uint8Array,
    signingService: SigningService,
    coinId: string,
    recipientPublicKey: Uint8Array,
  ): Promise<IRecipientPayload> {
    const coinIdObj = new CoinId(hexToBytes(coinId));
    const amount = token.coins?.get(coinIdObj) ?? 0n;

    if (amount === 0n) {
      throw new Error("Token has no balance for this coin ID");
    }

    // Generate new token ID and salt for recipient
    const recipientTokenId = new TokenId(generateRandom32());
    const recipientSalt = generateRandom32();

    // Create recipient address from public key
    const recipientPredicateRef = await UnmaskedPredicateReference.create(
      token.type,
      "secp256k1",
      recipientPublicKey,
      HashAlgorithm.SHA256,
    );
    const recipientAddress = await recipientPredicateRef.toAddress();

    // Build coin data
    const recipientCoinData = TokenCoinData.create([[coinIdObj, amount]]);

    // Build the split (single output token)
    const builder = new TokenSplitBuilder();

    builder.createToken(
      recipientTokenId,
      token.type,
      null,
      recipientCoinData,
      recipientAddress,
      recipientSalt,
      null,
    );

    const split = await builder.build(token);

    // Submit burn commitment
    const burnSalt = generateRandom32();
    const burnCommitment = await split.createBurnCommitment(
      burnSalt,
      signingService,
    );

    const burnResponse =
      await this.client.submitTransferCommitment(burnCommitment);
    if (burnResponse.status !== SubmitCommitmentStatus.SUCCESS) {
      throw new Error(`Burn commitment failed: ${burnResponse.status}`);
    }

    // Wait for burn inclusion proof
    const burnProof = await this.waitForInclusionProof(burnCommitment);
    const burnTransaction = burnCommitment.toTransaction(burnProof);

    // CRITICAL SAVE POINT: Token is now burned on blockchain.
    // Notify caller so they can persist wallet state immediately.
    // If any subsequent operations fail, the wallet will be in a consistent
    // state with the burned token already removed.
    if (this.onTokenBurned) {
      await this.onTokenBurned(bytesToHex(token.id.bytes));
    }

    // Submit mint commitment
    const mintCommitments = await split.createSplitMintCommitments(
      this.trustBase,
      burnTransaction,
    );
    const mintCommitment = mintCommitments[0]!;

    const mintResponse = await this.client.submitMintCommitment(mintCommitment);
    if (mintResponse.status !== SubmitCommitmentStatus.SUCCESS) {
      throw new Error(`Mint commitment failed: ${mintResponse.status}`);
    }

    const mintProof = await this.waitForInclusionProof(mintCommitment);
    const mintTransaction = mintCommitment.toTransaction(mintProof);

    return {
      type: "split_mint",
      mintTransactionJson: JSON.stringify(mintTransaction.toJSON()),
      salt: bytesToHex(recipientSalt),
      amount: amount.toString(),
      coinId,
    };
  }

  // ============ Internal ============

  private async waitForInclusionProof(
    commitment: MintCommitment<IMintTransactionReason> | TransferCommitment,
  ) {
    const maxAttempts = 30;
    const delayMs = 1000;
    const timeoutMs = maxAttempts * delayMs;

    // Use SDK's utility which verifies the proof against trustBase
    return waitInclusionProof(
      this.trustBase,
      this.client,
      commitment,
      AbortSignal.timeout(timeoutMs),
      delayMs,
    );
  }
}
