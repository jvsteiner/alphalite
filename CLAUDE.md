# Alphalite

Lightweight wallet and token management library for Unicity Protocol.

## Project Structure

```
src/
├── index.ts          # Public API exports
├── Wallet.ts         # Wallet and Identity classes
├── SimpleToken.ts    # Token wrapper with simplified API
├── AlphaClient.ts    # Network client for mint/send/receive
├── types.ts          # TypeScript interfaces
└── utils/
    └── crypto.ts     # Encryption, hashing, key derivation
tests/
└── Wallet.test.ts    # Jest tests
```

## Tech Stack

- TypeScript with ES modules (`"type": "module"`)
- Node.js 20+
- Jest for testing (with experimental VM modules)
- Dependencies:
  - `@unicitylabs/state-transition-sdk` - Core protocol SDK
  - `@noble/ciphers` - XChaCha20-Poly1305 encryption
  - `@noble/hashes` - SHA-256, scrypt

## Commands

```bash
make install    # Install dependencies
make build      # Build to lib/
make test       # Run tests
make lint       # Run ESLint
make publish    # Build, test, and publish to npm
```

## Architecture

### Core Classes

- **Wallet** - Multi-identity container with encrypted export/import
- **Identity** - Single key pair with signing capabilities
- **SimpleToken** - Wrapper around SDK Token with easy property access
- **AlphaClient** - Network operations (mint, send, receive)

### Key Patterns

- All async operations use Promises
- Secrets encrypted with XChaCha20-Poly1305, keys derived via scrypt
- Token IDs and types are 32-byte Uint8Arrays, often shown as hex strings
- Wallet uses password-based encryption for export

## Testing

Tests use Jest with `--experimental-vm-modules` for ESM support:

```bash
npm test                           # Run all tests
npm run test:single -- Wallet      # Run specific test
```

## Code Style

- 2-space indentation
- Single quotes
- Explicit return types on public methods
- JSDoc comments on public API
