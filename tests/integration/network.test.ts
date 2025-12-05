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
        coins: [["ALPHA", 1000n]],
        label: "Test Token with Coins",
      });

      expect(token.id).toBeDefined();
      expect(token.hasCoins).toBe(true);
      expect(token.getCoinBalance("ALPHA")).toBe(1000n);

      // Check wallet balance
      expect(wallet.getBalance("ALPHA")).toBeGreaterThanOrEqual(1000n);
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
          ["ALPHA", 500n],
          ["BETA", 250n],
        ],
      });

      expect(token.getCoinBalance("ALPHA")).toBe(500n);
      expect(token.getCoinBalance("BETA")).toBe(250n);
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
        coins: [["ALPHA", 100n]],
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
      expect(receivedToken.getCoinBalance("ALPHA")).toBe(100n);

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
        coins: [["ALPHA", 100n]],
      });

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send exactly 100 ALPHA (should not require split)
      const result = await client.sendAmount(
        senderWallet,
        "ALPHA",
        100n,
        recipientPubKey,
      );

      expect(result.sent).toBe(100n);
      expect(result.tokensUsed).toBe(1);
      expect(result.splitPerformed).toBe(false);

      // Sender should have no ALPHA left
      expect(senderWallet.getBalance("ALPHA")).toBe(0n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.getCoinBalance("ALPHA")).toBe(100n);
      expect(recipientWallet.getBalance("ALPHA")).toBe(100n);
    });

    it("should send partial amount (split required)", async () => {
      // Create wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint 1000 ALPHA
      await client.mint(senderWallet, {
        coins: [["ALPHA", 1000n]],
      });

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send 300 ALPHA (requires split, 700 change)
      const result = await client.sendAmount(
        senderWallet,
        "ALPHA",
        300n,
        recipientPubKey,
      );

      expect(result.sent).toBe(300n);
      expect(result.tokensUsed).toBe(1);
      expect(result.splitPerformed).toBe(true);

      // Sender should have 700 ALPHA as change
      expect(senderWallet.getBalance("ALPHA")).toBe(700n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.getCoinBalance("ALPHA")).toBe(300n);
      expect(recipientWallet.getBalance("ALPHA")).toBe(300n);
    });

    it("should handle multi-token send", async () => {
      // Create wallets
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint multiple small tokens
      await client.mint(senderWallet, { coins: [["ALPHA", 50n]] });
      await client.mint(senderWallet, { coins: [["ALPHA", 30n]] });
      await client.mint(senderWallet, { coins: [["ALPHA", 100n]] });

      expect(senderWallet.getBalance("ALPHA")).toBe(180n);

      // Get recipient public key
      const recipientIdentity = recipientWallet.getDefaultIdentity();
      const recipientPubKey = bytesToHex(recipientIdentity.publicKey);

      // Send 80 ALPHA (should use 30 + 50 = 80 exactly)
      const result = await client.sendAmount(
        senderWallet,
        "ALPHA",
        80n,
        recipientPubKey,
      );

      expect(result.sent).toBe(80n);
      expect(result.tokensUsed).toBe(2);
      expect(result.splitPerformed).toBe(false);

      // Sender should have 100 ALPHA left (the unused token)
      expect(senderWallet.getBalance("ALPHA")).toBe(100n);

      // Recipient receives
      const tokens = await client.receiveAmount(
        recipientWallet,
        result.recipientPayload,
      );

      expect(tokens.length).toBe(2);
      expect(recipientWallet.getBalance("ALPHA")).toBe(80n);
    });
  });

  describe("error handling", () => {
    it("should throw on insufficient balance", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      // Mint only 50 ALPHA
      await client.mint(senderWallet, { coins: [["ALPHA", 50n]] });

      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      // Try to send 100 ALPHA
      await expect(
        client.sendAmount(senderWallet, "ALPHA", 100n, recipientPubKey),
      ).rejects.toThrow(/Insufficient.*balance/);
    });

    it("should throw on zero amount", async () => {
      const senderWallet = await Wallet.create({ name: "Sender" });
      const recipientWallet = await Wallet.create({ name: "Recipient" });

      await client.mint(senderWallet, { coins: [["ALPHA", 100n]] });

      const recipientPubKey = bytesToHex(
        recipientWallet.getDefaultIdentity().publicKey,
      );

      await expect(
        client.sendAmount(senderWallet, "ALPHA", 0n, recipientPubKey),
      ).rejects.toThrow("Amount must be positive");
    });
  });
});
