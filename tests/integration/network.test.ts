/**
 * Integration tests that use the real Unicity network.
 *
 * These tests mint, send, and receive actual tokens on the test network.
 * They are slower than unit tests and require network connectivity.
 *
 * To run:
 *   1. Copy .env.example to .env and add your API key
 *   2. npm run test:integration
 */

import { config } from "dotenv";
import { jest } from "@jest/globals";

// Load environment variables from .env file
config();

import { AlphaClient } from "../../src/AlphaClient.js";
import { Wallet } from "../../src/Wallet.js";
import { TEST_NETWORK_TRUST_BASE } from "../../src/trustbase.js";
import { bytesToHex } from "../../src/utils/crypto.js";
import type { WalletStateChange } from "../../src/types.js";

/**
 * Helper to convert a human-readable name to hex-encoded coin ID.
 * In production, coin IDs are arbitrary bytes - this helper is just for test readability.
 */
function toHexCoinId(name: string): string {
  return bytesToHex(new TextEncoder().encode(name));
}

// Hex-encoded coin IDs for tests
const ALPHA = toHexCoinId("ALPHA");
const BETA = toHexCoinId("BETA");

// Increase timeout for network operations
jest.setTimeout(120000);

// API key from environment variable
const API_KEY = process.env.UNICITY_API_KEY;

if (!API_KEY) {
  throw new Error(
    "UNICITY_API_KEY environment variable is required for integration tests.\n" +
      "Create a .env file with your API key or run:\n" +
      "  UNICITY_API_KEY=your-key npm run test:integration",
  );
}

describe("Integration: Network Operations", () => {
  let client: AlphaClient;
  let wallet: Wallet;

  beforeAll(async () => {
    client = new AlphaClient({ apiKey: API_KEY });
    client.setTrustBase(AlphaClient.loadTrustBase(TEST_NETWORK_TRUST_BASE));
    wallet = await Wallet.create({ name: "Integration Test Wallet" });
  });

  describe("minting", () => {
    it("should mint a token without coins", async () => {
      const token = await client.mint(wallet);

      expect(token.id).toBeDefined();
      expect(token.id.length).toBe(64); // 32 bytes hex
      expect(token.hasCoins).toBe(false);

      // Token should be in wallet
      const entry = wallet.getToken(token.id);
      expect(entry).toBeDefined();
      expect(entry!.token.id).toBe(token.id);
    });

    it("should mint a token with coin balance", async () => {
      const token = await client.mint(wallet, {
        coins: [[ALPHA, 1000n]],
        label: "Test Token with Coins",
      });

      expect(token.id).toBeDefined();
      expect(token.hasCoins).toBe(true);
      expect(token.getCoinBalance(ALPHA)).toBe(1000n);

      // Check wallet balance
      expect(wallet.getBalance(ALPHA)).toBeGreaterThanOrEqual(1000n);
    });

    it("should mint a token with data payload", async () => {
      const data = new TextEncoder().encode("Hello, Unicity!");
      const token = await client.mint(wallet, {
        data,
        label: "Token with Data",
      });

      expect(token.data).toBeDefined();
      expect(token.dataString).toBe("Hello, Unicity!");
    });

    it("should mint a token with multiple coin types", async () => {
      const token = await client.mint(wallet, {
        coins: [
          [ALPHA, 500n],
          [BETA, 250n],
        ],
      });

      expect(token.getCoinBalance(ALPHA)).toBe(500n);
      expect(token.getCoinBalance(BETA)).toBe(250n);
    });
  });

  describe("token status", () => {
    it("should report token as unspent after minting", async () => {
      const token = await client.mint(wallet);
      const status = await client.getTokenStatus(wallet, token.id);

      expect(status.spent).toBe(false);
      expect(status.transactionCount).toBe(0);
    });
  });

  describe("transfer (token-based)", () => {
    it("should send and receive a token", async () => {
      // Create sender and recipient wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint a token for sender
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });
      const tokenId = token.id;

      // Get recipient address
      const recipientAddress = await recipientWallet.getDefaultAddress();

      // Send the token
      const sendResult = await client.send(
        senderWallet,
        tokenId,
        recipientAddress,
      );

      expect(sendResult.tokenJson).toBeDefined();
      expect(sendResult.transactionJson).toBeDefined();

      // Token should be removed from sender
      expect(senderWallet.getToken(tokenId)).toBeUndefined();

      // Recipient receives the token
      const receivedToken = await client.receive(
        recipientWallet,
        sendResult.tokenJson,
        sendResult.transactionJson,
      );

      expect(receivedToken.id).toBeDefined();
      expect(receivedToken.getCoinBalance(ALPHA)).toBe(100n);

      // Token should be in recipient wallet
      expect(recipientWallet.listTokens().length).toBe(1);
    });
  });

  describe("amount-based transfer", () => {
    it("should send exact amount (no split needed)", async () => {
      // Create wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint exactly 100 ALPHA
      await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send exactly 100 ALPHA (should not require split)
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        100n,
        recipientPubKey,
      );

      expect(result.sent).toBe(100n);
      expect(result.tokensUsed).toBe(1);
      expect(result.splitPerformed).toBe(false);

      // Sender should have no ALPHA left
      expect(senderWallet.getBalance(ALPHA)).toBe(0n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.getCoinBalance(ALPHA)).toBe(100n);
      expect(recipientWallet.getBalance(ALPHA)).toBe(100n);
    });

    it("should send partial amount (split required)", async () => {
      // Create wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint 1000 ALPHA
      await client.mint(senderWallet, {
        coins: [[ALPHA, 1000n]],
      });

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send 300 ALPHA (requires split, 700 change)
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        300n,
        recipientPubKey,
      );

      expect(result.sent).toBe(300n);
      expect(result.tokensUsed).toBe(1);
      expect(result.splitPerformed).toBe(true);

      // Sender should have 700 ALPHA as change
      expect(senderWallet.getBalance(ALPHA)).toBe(700n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.getCoinBalance(ALPHA)).toBe(300n);
      expect(recipientWallet.getBalance(ALPHA)).toBe(300n);
    });

    it("should handle multi-token send", async () => {
      // Create wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint multiple small tokens
      await client.mint(senderWallet, { coins: [[ALPHA, 50n]] });
      await client.mint(senderWallet, { coins: [[ALPHA, 30n]] });
      await client.mint(senderWallet, { coins: [[ALPHA, 100n]] });

      expect(senderWallet.getBalance(ALPHA)).toBe(180n);

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send 80 ALPHA (should use 30 + 50 = 80 exactly)
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        80n,
        recipientPubKey,
      );

      expect(result.sent).toBe(80n);
      expect(result.tokensUsed).toBe(2);
      expect(result.splitPerformed).toBe(false);

      // Sender should have 100 ALPHA left (the unused token)
      expect(senderWallet.getBalance(ALPHA)).toBe(100n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(2);
      expect(recipientWallet.getBalance(ALPHA)).toBe(80n);
    });
  });

  describe("error handling", () => {
    it("should throw on insufficient balance", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint only 50 ALPHA
      await client.mint(senderWallet, { coins: [[ALPHA, 50n]] });

      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      // Try to send 100 ALPHA
      await expect(
        client.sendAmount(senderWallet, ALPHA, 100n, recipientPubKey),
      ).rejects.toThrow(/Insufficient.*balance/);
    });

    it("should throw on zero amount", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      await client.mint(senderWallet, { coins: [[ALPHA, 100n]] });

      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      await expect(
        client.sendAmount(senderWallet, ALPHA, 0n, recipientPubKey),
      ).rejects.toThrow("Amount must be positive");
    });
  });
});

describe("Integration: Token Security", () => {
  let client: AlphaClient;

  beforeAll(() => {
    client = new AlphaClient({ apiKey: API_KEY });
    client.setTrustBase(AlphaClient.loadTrustBase(TEST_NETWORK_TRUST_BASE));
  });

  describe("duplicate token prevention", () => {
    it("should not accept the same token twice", async () => {
      const wallet = await Wallet.create({ name: "Duplicate Test" });

      // Mint a token
      const token = await client.mint(wallet, {
        coins: [[ALPHA, 100n]],
      });

      // Get the token entry including the salt
      const tokenEntry = wallet.getToken(token.id);
      expect(tokenEntry).toBeDefined();

      // Wallet should have 100 ALPHA
      expect(wallet.getBalance(ALPHA)).toBe(100n);

      // Trying to add the same token again should fail
      // BUG: Currently this will succeed and double the balance!
      expect(() =>
        wallet.addToken(token, tokenEntry!.salt, tokenEntry!.identityId),
      ).toThrow(/already exists|duplicate/i);

      // Balance should still be 100n, not 200n
      expect(wallet.getBalance(ALPHA)).toBe(100n);
      expect(wallet.listTokens()).toHaveLength(1);
    });

    it("should not accept a received token twice", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint and send a token
      await client.mint(senderWallet, { coins: [[ALPHA, 100n]] });
      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        100n,
        recipientPubKey,
      );

      // First receive should work
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );
      expect(tokens.length).toBe(1);
      expect(recipientWallet.getBalance(ALPHA)).toBe(100n);

      // Second receive of the same payload should fail
      // BUG: Currently this might succeed and double the balance!
      await expect(
        client.receiveAmount(recipientWallet, result.recipientPayload),
      ).rejects.toThrow(/already exists|duplicate/i);

      // Balance should still be 100n
      expect(recipientWallet.getBalance(ALPHA)).toBe(100n);
    });
  });

  describe("wrong wallet prevention", () => {
    it("should not accept tokens meant for a different wallet", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const intendedRecipient = await Wallet.create({
        name: "Intended Recipient",
      });
      const attackerWallet = await Wallet.create({ name: "Attacker" });

      // Mint a token
      await client.mint(senderWallet, { coins: [[ALPHA, 100n]] });

      // Send to the intended recipient
      const recipientPubKey = bytesToHex(
        intendedRecipient.getDefaultIdentity().publicKey,
      );
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        100n,
        recipientPubKey,
      );

      // Attacker tries to receive the token meant for someone else
      // BUG: This should fail but might succeed!
      await expect(
        client.receiveAmount(attackerWallet, result.recipientPayload),
      ).rejects.toThrow();

      // Attacker should have no tokens
      expect(attackerWallet.getBalance(ALPHA)).toBe(0n);
      expect(attackerWallet.listTokens()).toHaveLength(0);

      // Intended recipient should still be able to receive
      const tokens = await client.receiveAmount(
        intendedRecipient,
        result.recipientPayload,
      );
      expect(tokens.length).toBe(1);
      expect(intendedRecipient.getBalance(ALPHA)).toBe(100n);
    });

    it("should not accept token-based transfer meant for different address", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const intendedRecipient = await Wallet.create({
        name: "Intended Recipient",
      });
      const attackerWallet = await Wallet.create({ name: "Attacker" });

      // Mint a token
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });

      // Send to the intended recipient's address
      const recipientAddress = await intendedRecipient.getDefaultAddress();
      const sendResult = await client.send(
        senderWallet,
        token.id,
        recipientAddress,
      );

      // Attacker intercepts and tries to receive
      // BUG: This should fail but might succeed!
      await expect(
        client.receive(
          attackerWallet,
          sendResult.tokenJson,
          sendResult.transactionJson,
        ),
      ).rejects.toThrow();

      // Attacker should have no tokens
      expect(attackerWallet.listTokens()).toHaveLength(0);
    });
  });
});

describe("Integration: onWalletStateChange callback", () => {
  let stateChanges: Array<{ wallet: Wallet; change: WalletStateChange }>;
  let client: AlphaClient;

  beforeEach(() => {
    stateChanges = [];
    client = new AlphaClient({
      apiKey: API_KEY,
      onWalletStateChange: (wallet, change) => {
        stateChanges.push({ wallet, change });
      },
    });
    client.setTrustBase(AlphaClient.loadTrustBase(TEST_NETWORK_TRUST_BASE));
  });

  describe("mint operations", () => {
    it("should call callback after minting a token", async () => {
      const wallet = await Wallet.create({ name: "Callback Test" });

      const token = await client.mint(wallet, {
        coins: [[ALPHA, 100n]],
      });

      expect(stateChanges.length).toBe(1);
      expect(stateChanges[0]!.change.type).toBe("token_added");
      expect(stateChanges[0]!.change.tokenIds).toContain(token.id);
      expect(stateChanges[0]!.change.description).toContain("Minted");
      expect(stateChanges[0]!.wallet).toBe(wallet);
    });
  });

  describe("send operations", () => {
    it("should call callback after sending a token", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint first (this will trigger one callback)
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });
      const mintCallbackCount = stateChanges.length;

      // Get recipient address
      const recipientAddress = await recipientWallet.getDefaultAddress();

      // Send the token
      await client.send(senderWallet, token.id, recipientAddress);

      // Should have one more callback for the send
      expect(stateChanges.length).toBe(mintCallbackCount + 1);
      const sendChange = stateChanges[stateChanges.length - 1]!;
      expect(sendChange.change.type).toBe("token_removed");
      expect(sendChange.change.tokenIds).toContain(token.id);
      expect(sendChange.change.description).toContain("Sent");
    });
  });

  describe("sendAmount operations", () => {
    it("should call callback for exact match send (no split)", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint exactly 100 ALPHA
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });
      const mintCallbackCount = stateChanges.length;

      // Get recipient public key
      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      // Send exactly 100 ALPHA (no split)
      await client.sendAmount(senderWallet, ALPHA, 100n, recipientPubKey);

      // Should have one callback for the send
      expect(stateChanges.length).toBe(mintCallbackCount + 1);
      const sendChange = stateChanges[stateChanges.length - 1]!;
      expect(sendChange.change.type).toBe("token_removed");
      expect(sendChange.change.tokenIds).toContain(token.id);
    });

    it("should call callback for split send with change", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint 1000 ALPHA
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 1000n]],
      });
      const mintCallbackCount = stateChanges.length;

      // Get recipient public key
      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      // Send 300 ALPHA (requires split, 700 change)
      await client.sendAmount(senderWallet, ALPHA, 300n, recipientPubKey);

      // Should have one callback for the split (token_replaced)
      expect(stateChanges.length).toBe(mintCallbackCount + 1);
      const splitChange = stateChanges[stateChanges.length - 1]!;
      expect(splitChange.change.type).toBe("token_replaced");
      expect(splitChange.change.tokenIds.length).toBe(2);
      expect(splitChange.change.tokenIds).toContain(token.id); // Original token
      expect(splitChange.change.description).toContain("Split");
    });

    it("should call callback for each token in multi-token send", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint multiple small tokens
      await client.mint(senderWallet, { coins: [[ALPHA, 50n]] });
      await client.mint(senderWallet, { coins: [[ALPHA, 30n]] });
      await client.mint(senderWallet, { coins: [[ALPHA, 100n]] });
      const mintCallbackCount = stateChanges.length;

      // Get recipient public key
      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      // Send 80 ALPHA (uses 30 + 50, no split needed)
      await client.sendAmount(senderWallet, ALPHA, 80n, recipientPubKey);

      // Should have 2 callbacks (one for each consumed token)
      expect(stateChanges.length).toBe(mintCallbackCount + 2);

      // Both should be token_removed
      const change1 = stateChanges[mintCallbackCount]!;
      const change2 = stateChanges[mintCallbackCount + 1]!;
      expect(change1.change.type).toBe("token_removed");
      expect(change2.change.type).toBe("token_removed");
    });
  });

  describe("receive operations", () => {
    it("should call callback after receiving a token", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint and send a token
      const token = await client.mint(senderWallet, {
        coins: [[ALPHA, 100n]],
      });
      const recipientAddress = await recipientWallet.getDefaultAddress();
      const sendResult = await client.send(
        senderWallet,
        token.id,
        recipientAddress,
      );

      // Clear state changes to focus on receive
      stateChanges = [];

      // Receive the token
      const receivedToken = await client.receive(
        recipientWallet,
        sendResult.tokenJson,
        sendResult.transactionJson,
      );

      expect(stateChanges.length).toBe(1);
      expect(stateChanges[0]!.change.type).toBe("token_added");
      expect(stateChanges[0]!.change.tokenIds).toContain(receivedToken.id);
      expect(stateChanges[0]!.change.description).toContain("Received");
      expect(stateChanges[0]!.wallet).toBe(recipientWallet);
    });

    it("should call callback for each token in receiveAmount", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint multiple tokens and send them
      await client.mint(senderWallet, { coins: [[ALPHA, 50n]] });
      await client.mint(senderWallet, { coins: [[ALPHA, 30n]] });
      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );
      const result = await client.sendAmount(
        senderWallet,
        ALPHA,
        80n,
        recipientPubKey,
      );

      // Clear state changes to focus on receive
      stateChanges = [];

      // Receive the tokens
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      // Should have callback for each received token
      expect(stateChanges.length).toBe(tokens.length);
      for (const change of stateChanges) {
        expect(change.change.type).toBe("token_added");
        expect(change.wallet).toBe(recipientWallet);
      }
    });
  });

  describe("async callback support", () => {
    it("should wait for async callback to complete", async () => {
      const saveOrder: string[] = [];

      const asyncClient = new AlphaClient({
        apiKey: API_KEY,
        onWalletStateChange: async (wallet, change) => {
          // Simulate async save with delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          saveOrder.push(change.type);
        },
      });
      asyncClient.setTrustBase(
        AlphaClient.loadTrustBase(TEST_NETWORK_TRUST_BASE),
      );

      const wallet = await Wallet.create({ name: "Async Test" });

      // Mint a token
      await asyncClient.mint(wallet, { coins: [[ALPHA, 100n]] });

      // The async callback should have completed
      expect(saveOrder).toContain("token_added");
    });
  });
});
