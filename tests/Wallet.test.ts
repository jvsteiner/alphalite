import { Identity, Wallet, WALLET_VERSION } from "../src/Wallet.js";

describe("Wallet", () => {
  describe("creation", () => {
    it("should create a new wallet with default options", async () => {
      const wallet = await Wallet.create();

      expect(wallet.id).toBeDefined();
      expect(wallet.name).toBe("My Wallet");
      expect(wallet.defaultTokenType).toHaveLength(32);
      expect(wallet.listIdentities()).toHaveLength(1);
    });

    it("should create a wallet with custom options", async () => {
      const customTokenType = new Uint8Array(32).fill(0x42);
      const wallet = await Wallet.create({
        defaultTokenType: customTokenType,
        identityLabel: "Primary Key",
        name: "Test Wallet",
      });

      expect(wallet.name).toBe("Test Wallet");
      expect(wallet.defaultTokenType).toEqual(customTokenType);

      const identity = wallet.getDefaultIdentity();
      expect(identity.label).toBe("Primary Key");
    });
  });

  describe("identity management", () => {
    it("should create multiple identities", async () => {
      const wallet = await Wallet.create();

      await wallet.createIdentity({ label: "Second" });
      await wallet.createIdentity({ label: "Third" });

      expect(wallet.listIdentities()).toHaveLength(3);
    });

    it("should set default identity", async () => {
      const wallet = await Wallet.create();
      const secondIdentity = await wallet.createIdentity({ label: "Second" });

      wallet.setDefaultIdentity(secondIdentity.id);

      expect(wallet.getDefaultIdentity().id).toBe(secondIdentity.id);
    });

    it("should remove identity", async () => {
      const wallet = await Wallet.create();
      const secondIdentity = await wallet.createIdentity({ label: "Second" });

      wallet.removeIdentity(secondIdentity.id);

      expect(wallet.listIdentities()).toHaveLength(1);
      expect(wallet.getIdentity(secondIdentity.id)).toBeUndefined();
    });

    it("should not remove the last identity", async () => {
      const wallet = await Wallet.create();
      const identity = wallet.getDefaultIdentity();

      expect(() => wallet.removeIdentity(identity.id)).toThrow(
        "Cannot remove the last identity",
      );
    });

    it("should import identity from secret", async () => {
      const secret = new Uint8Array(128).fill(0x01);
      const wallet = await Wallet.create();

      const imported = await wallet.createIdentity({
        label: "Imported",
        secret,
      });

      expect(imported.getSecret()).toEqual(secret);
    });
  });

  describe("serialization", () => {
    it("should export and import wallet unencrypted", async () => {
      const wallet = await Wallet.create({ name: "Export Test" });
      await wallet.createIdentity({ label: "Second" });

      const json = wallet.toJSON();

      expect(json.version).toBe(WALLET_VERSION);
      expect(json.encrypted).toBe(false);
      expect(json.identities).toHaveLength(2);

      const imported = await Wallet.fromJSON(json);

      expect(imported.name).toBe("Export Test");
      expect(imported.listIdentities()).toHaveLength(2);
    });

    it("should export and import wallet encrypted", async () => {
      const wallet = await Wallet.create({ name: "Encrypted Test" });
      const identity = wallet.getDefaultIdentity();
      const originalSecret = identity.getSecret();

      const json = wallet.toJSON({ password: "test-password-123" });

      expect(json.encrypted).toBe(true);
      expect(json.salt).toBeDefined();
      expect(json.identities[0]?.encryptedSecret).toBeDefined();
      expect(json.identities[0]?.secret).toBeUndefined();

      const imported = await Wallet.fromJSON(json, {
        password: "test-password-123",
      });
      const importedIdentity = imported.getDefaultIdentity();

      expect(importedIdentity.getSecret()).toEqual(originalSecret);
    });

    it("should fail to import encrypted wallet without password", async () => {
      const wallet = await Wallet.create();
      const json = wallet.toJSON({ password: "secret" });

      await expect(Wallet.fromJSON(json)).rejects.toThrow("Password required");
    });

    it("should fail to import encrypted wallet with wrong password", async () => {
      const wallet = await Wallet.create();
      const json = wallet.toJSON({ password: "correct" });

      await expect(
        Wallet.fromJSON(json, { password: "wrong" }),
      ).rejects.toThrow();
    });
  });

  describe("token management", () => {
    it("should list tokens for specific identity", async () => {
      const wallet = await Wallet.create();
      const second = await wallet.createIdentity({ label: "Second" });

      // We can't add real tokens without SDK integration, but we can test the structure
      expect(wallet.listTokens()).toHaveLength(0);
      expect(wallet.listTokensForIdentity(second.id)).toHaveLength(0);
    });
  });

  describe("merge", () => {
    it("should merge two wallets", async () => {
      const wallet1 = await Wallet.create({ name: "Wallet 1" });
      const wallet2 = await Wallet.create({ name: "Wallet 2" });

      await wallet2.createIdentity({ label: "Extra" });

      const originalCount = wallet1.listIdentities().length;
      await wallet1.merge(wallet2);

      // Should have merged identities (2 from wallet2 + 1 original)
      expect(wallet1.listIdentities().length).toBe(originalCount + 2);
    });
  });
});

describe("Identity", () => {
  describe("creation", () => {
    it("should create identity with generated secret", async () => {
      const identity = await Identity.create({ label: "Test" });

      expect(identity.id).toBeDefined();
      expect(identity.label).toBe("Test");
      expect(identity.publicKey).toHaveLength(33); // Compressed secp256k1
      expect(identity.getSecret()).toHaveLength(128);
      expect(identity.getNonce()).toHaveLength(32);
    });

    it("should create identity with provided secret", async () => {
      const secret = new Uint8Array(128).fill(0xab);
      const identity = await Identity.create({ label: "Custom", secret });

      expect(identity.getSecret()).toEqual(secret);
    });

    it("should rotate nonce", async () => {
      const identity = await Identity.create();
      const originalNonce = identity.getNonce();

      identity.rotateNonce();
      const newNonce = identity.getNonce();

      expect(newNonce).not.toEqual(originalNonce);
    });
  });

  describe("signing service", () => {
    it("should return consistent signing service", async () => {
      const identity = await Identity.create();

      const service1 = await identity.getSigningService();
      const service2 = await identity.getSigningService();

      expect(service1.publicKey).toEqual(service2.publicKey);
    });
  });

  describe("serialization", () => {
    it("should serialize and deserialize unencrypted", async () => {
      const identity = await Identity.create({ label: "Serialize Test" });
      const json = identity.toJSON();

      expect(json.secret).toBeDefined();
      expect(json.encryptedSecret).toBeUndefined();

      const restored = Identity.fromJSON(json);

      expect(restored.id).toBe(identity.id);
      expect(restored.label).toBe(identity.label);
      expect(restored.publicKey).toEqual(identity.publicKey);
      expect(restored.getSecret()).toEqual(identity.getSecret());
    });

    it("should serialize and deserialize encrypted", async () => {
      const identity = await Identity.create({ label: "Encrypted Test" });
      const key = new Uint8Array(32).fill(0x42);

      const json = identity.toEncryptedJSON(key);

      expect(json.encryptedSecret).toBeDefined();
      expect(json.secret).toBeUndefined();

      const restored = Identity.fromJSON(json, key);

      expect(restored.getSecret()).toEqual(identity.getSecret());
    });
  });
});
