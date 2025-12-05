/**
 * Tests for CoinManager - token selection and balance aggregation.
 */

import { CoinManager } from "../src/CoinManager.js";
import { SimpleToken } from "../src/SimpleToken.js";
import { Wallet } from "../src/Wallet.js";

// Mock SimpleToken for testing
function createMockToken(
  id: string,
  coins: Array<[string, bigint]>,
): SimpleToken {
  return {
    id,
    coins: coins.map(([name, amount]) => ({ name, amount })),
    getCoinBalance: (coinType: string) => {
      const coin = coins.find(([name]) => name === coinType);
      return coin ? coin[1] : 0n;
    },
    raw: {} as unknown,
    toJSON: () => JSON.stringify({ id, coins }),
  } as unknown as SimpleToken;
}

describe("CoinManager", () => {
  let coinManager: CoinManager;
  let wallet: Wallet;

  beforeEach(async () => {
    coinManager = new CoinManager();
    wallet = await Wallet.create({ name: "Test Wallet" });
  });

  describe("getBalance", () => {
    it("should return 0 for empty wallet", () => {
      const balance = coinManager.getBalance(wallet, "ALPHA");
      expect(balance).toBe(0n);
    });

    it("should sum balances across multiple tokens", () => {
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);

      wallet.addToken(createMockToken("token1", [["ALPHA", 100n]]), salt1);
      wallet.addToken(createMockToken("token2", [["ALPHA", 250n]]), salt2);

      const balance = coinManager.getBalance(wallet, "ALPHA");
      expect(balance).toBe(350n);
    });

    it("should only count specified coin type", () => {
      const salt = new Uint8Array(32).fill(1);

      wallet.addToken(
        createMockToken("token1", [
          ["ALPHA", 100n],
          ["BETA", 500n],
        ]),
        salt,
      );

      expect(coinManager.getBalance(wallet, "ALPHA")).toBe(100n);
      expect(coinManager.getBalance(wallet, "BETA")).toBe(500n);
      expect(coinManager.getBalance(wallet, "GAMMA")).toBe(0n);
    });
  });

  describe("getAllBalances", () => {
    it("should return empty map for empty wallet", () => {
      const balances = coinManager.getAllBalances(wallet);
      expect(balances.size).toBe(0);
    });

    it("should aggregate all coin types", () => {
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);

      wallet.addToken(
        createMockToken("token1", [
          ["ALPHA", 100n],
          ["BETA", 200n],
        ]),
        salt1,
      );
      wallet.addToken(
        createMockToken("token2", [
          ["ALPHA", 50n],
          ["GAMMA", 300n],
        ]),
        salt2,
      );

      const balances = coinManager.getAllBalances(wallet);

      expect(balances.get("ALPHA")).toBe(150n);
      expect(balances.get("BETA")).toBe(200n);
      expect(balances.get("GAMMA")).toBe(300n);
    });
  });

  describe("selectTokensForAmount", () => {
    it("should throw for non-positive amount", () => {
      expect(() =>
        coinManager.selectTokensForAmount(wallet, "ALPHA", 0n),
      ).toThrow("Amount must be positive");

      expect(() =>
        coinManager.selectTokensForAmount(wallet, "ALPHA", -10n),
      ).toThrow("Amount must be positive");
    });

    it("should throw for insufficient balance", () => {
      const salt = new Uint8Array(32).fill(1);
      wallet.addToken(createMockToken("token1", [["ALPHA", 100n]]), salt);

      expect(() =>
        coinManager.selectTokensForAmount(wallet, "ALPHA", 200n),
      ).toThrow("Insufficient ALPHA balance: have 100, need 200");
    });

    it("should throw when no tokens have the coin type", () => {
      const salt = new Uint8Array(32).fill(1);
      wallet.addToken(createMockToken("token1", [["BETA", 100n]]), salt);

      expect(() =>
        coinManager.selectTokensForAmount(wallet, "ALPHA", 50n),
      ).toThrow("No tokens with ALPHA balance");
    });

    describe("exact match selection", () => {
      it("should prefer exact match over split", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);
        const salt3 = new Uint8Array(32).fill(3);

        wallet.addToken(createMockToken("token1", [["ALPHA", 50n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 100n]]), salt2);
        wallet.addToken(createMockToken("token3", [["ALPHA", 200n]]), salt3);

        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          100n,
        );

        expect(selection.tokens.length).toBe(1);
        expect(selection.tokens[0]!.token.id).toBe("token2");
        expect(selection.requiresSplit).toBe(false);
        expect(selection.totalAmount).toBe(100n);
      });
    });

    describe("single token split", () => {
      it("should split smallest sufficient token when no small tokens help", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);

        // Only tokens larger than amount - must split one
        wallet.addToken(createMockToken("token1", [["ALPHA", 150n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 500n]]), salt2);

        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          100n,
        );

        expect(selection.tokens.length).toBe(1);
        expect(selection.tokens[0]!.token.id).toBe("token1");
        expect(selection.requiresSplit).toBe(true);
        expect(selection.splitAmount).toBe(100n);
        expect(selection.changeAmount).toBe(50n);
      });

      it("should consume small token then split next sufficient token", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);
        const salt3 = new Uint8Array(32).fill(3);

        wallet.addToken(createMockToken("token1", [["ALPHA", 50n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 150n]]), salt2);
        wallet.addToken(createMockToken("token3", [["ALPHA", 500n]]), salt3);

        // 50 is too small, so we use 50 + split of 150 for remaining 50
        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          100n,
        );

        // Algorithm prefers consuming 50 + splitting 150 for 50
        expect(selection.tokens.length).toBe(2);
        expect(selection.requiresSplit).toBe(true);
        expect(selection.splitAmount).toBe(50n);
        expect(selection.changeAmount).toBe(100n);
      });
    });

    describe("multi-token selection", () => {
      it("should consume small tokens to reach exact amount", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);

        wallet.addToken(createMockToken("token1", [["ALPHA", 10n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 25n]]), salt2);

        // Request exact sum of both tokens
        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          35n,
        );

        expect(selection.tokens.length).toBe(2);
        expect(selection.requiresSplit).toBe(false);
        expect(selection.totalAmount).toBe(35n);
      });

      it("should consume small tokens and split last if needed", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);
        const salt3 = new Uint8Array(32).fill(3);

        wallet.addToken(createMockToken("token1", [["ALPHA", 10n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 25n]]), salt2);
        wallet.addToken(createMockToken("token3", [["ALPHA", 100n]]), salt3);

        // 10 + 25 = 35, need 45 more from 100-token
        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          80n,
        );

        expect(selection.tokens.length).toBe(3);
        expect(selection.requiresSplit).toBe(true);
        expect(selection.splitAmount).toBe(45n);
        expect(selection.changeAmount).toBe(55n);
      });

      it("should prefer consuming small tokens over splitting large one", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);
        const salt3 = new Uint8Array(32).fill(3);

        wallet.addToken(createMockToken("token1", [["ALPHA", 10n]]), salt1);
        wallet.addToken(createMockToken("token2", [["ALPHA", 25n]]), salt2);
        wallet.addToken(createMockToken("token3", [["ALPHA", 100n]]), salt3);

        // 10 + 25 = 35 exactly - should prefer this over splitting 100
        const selection = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          35n,
        );

        expect(selection.tokens.length).toBe(2);
        expect(selection.requiresSplit).toBe(false);
        expect(selection.totalAmount).toBe(35n);
      });
    });

    describe("fragmentation minimization", () => {
      it("should minimize number of new tokens created", () => {
        const salt1 = new Uint8Array(32).fill(1);
        const salt2 = new Uint8Array(32).fill(2);
        const salt3 = new Uint8Array(32).fill(3);
        const salt4 = new Uint8Array(32).fill(4);
        const salt5 = new Uint8Array(32).fill(5);

        // Tokens: [10, 25, 50, 100, 500]
        wallet.addToken(createMockToken("t10", [["ALPHA", 10n]]), salt1);
        wallet.addToken(createMockToken("t25", [["ALPHA", 25n]]), salt2);
        wallet.addToken(createMockToken("t50", [["ALPHA", 50n]]), salt3);
        wallet.addToken(createMockToken("t100", [["ALPHA", 100n]]), salt4);
        wallet.addToken(createMockToken("t500", [["ALPHA", 500n]]), salt5);

        // Send 35: should use 10 + 25 = 35 exactly (no split, no new tokens)
        const selection35 = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          35n,
        );
        expect(selection35.requiresSplit).toBe(false);

        // Send 50: exact match exists
        const selection50 = coinManager.selectTokensForAmount(
          wallet,
          "ALPHA",
          50n,
        );
        expect(selection50.tokens.length).toBe(1);
        expect(selection50.requiresSplit).toBe(false);
      });
    });
  });
});
