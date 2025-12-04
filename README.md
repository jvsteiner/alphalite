# Alphalite

Lightweight wallet and token management library for the Unicity Protocol.

Alphalite provides a simplified, high-level API on top of the [State Transition SDK](https://github.com/unicitynetwork/state-transition-sdk), making it easy to:

- Create and manage multi-identity wallets
- Mint, send, and receive tokens in just a few lines of code
- Securely store and export wallet data with encryption

## Installation

```bash
npm install @jvsteiner/alphalite
```

## Quick Start

### Create a Wallet

```typescript
import { Wallet, AlphaClient } from '@jvsteiner/alphalite';

// Create a new wallet with a default identity
const wallet = await Wallet.create({ name: 'My Wallet' });

// Get the wallet's default address
const address = await wallet.getDefaultAddress();
console.log('Address:', address);
```

### Mint a Token

```typescript
import { Wallet, AlphaClient } from '@jvsteiner/alphalite';

const wallet = await Wallet.create();
const client = new AlphaClient();

// Load trust base (required for verification)
client.setTrustBase(AlphaClient.loadTrustBase(trustBaseJson));

// Mint a simple token
const token = await client.mint(wallet);
console.log('Minted token:', token.id);

// Mint with coins
const tokenWithCoins = await client.mint(wallet, {
  coins: [
    ['ALPHA', 1000n],
    ['BETA', 500n]
  ],
  data: new TextEncoder().encode('My NFT metadata'),
  label: 'My First Token'
});
```

### Transfer a Token

```typescript
// Sender side
const result = await client.send(wallet, tokenId, recipientAddress);

// Send these to the recipient:
// - result.tokenJson
// - result.transactionJson

// Recipient side
const receivedToken = await client.receive(
  recipientWallet,
  result.tokenJson,
  result.transactionJson
);
```

## Multi-Identity Support

Wallets support multiple identities (key pairs):

```typescript
const wallet = await Wallet.create();

// Create additional identities
const tradingIdentity = await wallet.createIdentity({ label: 'Trading' });
const savingsIdentity = await wallet.createIdentity({ label: 'Savings' });

// List all identities
const identities = wallet.listIdentities();

// Get address for specific identity
const tradingAddress = await wallet.getAddress(tradingIdentity.id);

// Mint with specific identity
const token = await client.mint(wallet, {
  identityId: tradingIdentity.id
});
```

## Wallet Persistence

### Unencrypted Export (Development Only)

```typescript
// Export
const json = wallet.toJSON();
localStorage.setItem('wallet', JSON.stringify(json));

// Import
const saved = JSON.parse(localStorage.getItem('wallet'));
const wallet = await Wallet.fromJSON(saved);
```

### Encrypted Export (Recommended)

```typescript
// Export with password
const json = wallet.toJSON({ password: 'user-password' });
localStorage.setItem('wallet', JSON.stringify(json));

// Import with password
const saved = JSON.parse(localStorage.getItem('wallet'));
const wallet = await Wallet.fromJSON(saved, { password: 'user-password' });
```

### Merging Wallets

Import identities and tokens from another wallet:

```typescript
const backupWallet = await Wallet.fromJSON(backupJson, { password: 'backup-pw' });
await mainWallet.merge(backupWallet);
```

## Token Management

Tokens are automatically added to the wallet when minted or received:

```typescript
// List all tokens
const tokens = wallet.listTokens();

// List tokens for specific identity
const tradingTokens = wallet.listTokensForIdentity(tradingIdentity.id);

// Get specific token
const token = wallet.getToken(tokenId);

// Remove token from wallet
wallet.removeToken(tokenId);
```

## API Reference

### Wallet

| Method | Description |
|--------|-------------|
| `Wallet.create(options?)` | Create a new wallet |
| `Wallet.fromJSON(json, options?)` | Import from JSON |
| `wallet.toJSON(options?)` | Export to JSON |
| `wallet.createIdentity(options?)` | Create new identity |
| `wallet.getIdentity(id)` | Get identity by ID |
| `wallet.getDefaultIdentity()` | Get default identity |
| `wallet.setDefaultIdentity(id)` | Set default identity |
| `wallet.listIdentities()` | List all identities |
| `wallet.removeIdentity(id)` | Remove an identity |
| `wallet.addToken(token, identityId?, label?)` | Add token to wallet |
| `wallet.getToken(tokenId)` | Get token by ID |
| `wallet.listTokens()` | List all tokens |
| `wallet.removeToken(tokenId)` | Remove token |
| `wallet.getDefaultAddress()` | Get default address |
| `wallet.getAddress(identityId, tokenType?)` | Get address for identity |
| `wallet.merge(other)` | Merge another wallet |

### AlphaClient

| Method | Description |
|--------|-------------|
| `new AlphaClient(config?)` | Create client |
| `client.setTrustBase(trustBase)` | Set trust base |
| `AlphaClient.loadTrustBase(json)` | Load trust base from JSON |
| `client.mint(wallet, options?)` | Mint a new token |
| `client.send(wallet, tokenId, address, options?)` | Send a token |
| `client.receive(wallet, tokenJson, txJson, options?)` | Receive a token |
| `client.getTokenStatus(wallet, tokenId)` | Check token status |
| `client.getAddress(wallet)` | Get default address |
| `client.createNametag(name)` | Create proxy address |

### SimpleToken

| Property | Description |
|----------|-------------|
| `token.id` | Token ID (hex string) |
| `token.type` | Token type (hex string) |
| `token.data` | Token data (Uint8Array) |
| `token.coins` | Coin balances array |
| `token.transactionCount` | Number of transactions |
| `token.toJSON()` | Serialize to JSON |
| `token.raw` | Access underlying SDK Token |

## Configuration

### Client Options

```typescript
const client = new AlphaClient({
  gatewayUrl: 'https://gateway-test.unicity.network:443',
  trustBase: RootTrustBase.fromJSON(trustBaseJson),
  apiKey: 'optional-api-key'
});
```

### Wallet Creation Options

```typescript
const wallet = await Wallet.create({
  name: 'My Wallet',
  defaultTokenType: new Uint8Array(32).fill(0x01),
  identityLabel: 'Primary'
});
```

## Security

- **Secrets**: Each identity stores a 128-byte secret used to derive the private key
- **Encryption**: Uses XChaCha20-Poly1305 with scrypt key derivation (N=2^17, r=8, p=1)
- **Key Derivation**: Private keys are derived from `SHA256(secret || nonce)`
- **Nonces**: Automatically managed for predicate derivation

**Important**: Never store unencrypted wallets in production. Always use password encryption.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT
