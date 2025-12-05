# Token Splitting Implementation Plan

## Goal

Transform Alphalite from a token-centric API to an amount-centric API. Users should be able to send amounts without thinking about individual tokens:

```typescript
// Current API (token-centric)
const result = await client.send(wallet, tokenId, recipientAddress);

// New API (amount-centric)
const result = await client.send(wallet, 'ALPHA', 500n, recipientAddress);
```

The wallet handles all internal complexity: selecting tokens, splitting when necessary, and managing change tokens.

---

## Design Principles

1. **User simplicity** - Users think in amounts, not tokens
2. **Minimal token fragmentation** - Avoid creating many small tokens
3. **Automatic consolidation** - Combine small tokens when beneficial
4. **Backward compatibility** - Keep token-level API for advanced use cases
5. **Transaction atomicity** - Split operations are atomic (burn + mints)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      AlphaClient                            │
│  send(wallet, coinType, amount, recipient)                  │
│  sendToken(wallet, tokenId, recipient)  // existing         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    CoinManager                              │
│  - selectTokensForAmount(wallet, coinType, amount)          │
│  - consolidateTokens(wallet, coinType)                      │
│  - getBalance(wallet, coinType)                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   TokenSplitter                             │
│  - split(token, recipientAmount, recipientAddress)          │
│  - merge(tokens, recipientAddress)  // future               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Phase 1: Core Splitting Infrastructure

#### Task 1.1: Add Salt/Nonce Storage to Wallet

The wallet must store the salt used when creating each token. Without this, tokens cannot be spent.

**File:** `src/Wallet.ts`

**Changes:**
- Add `salt: Uint8Array` to `TokenEntry` class
- Update `ITokenEntryJson` to include `salt: string` (hex)
- Modify `addToken()` to require salt parameter
- Update serialization/deserialization

```typescript
export class TokenEntry {
  public constructor(
    public readonly identityId: string,
    public readonly token: SimpleToken,
    public readonly salt: Uint8Array,  // NEW
    public readonly label: string | undefined,
    public readonly addedAt: Date,
  ) {}
}
```

#### Task 1.2: Create TokenSplitter Class

Low-level class handling the SDK split mechanics.

**File:** `src/TokenSplitter.ts` (new)

```typescript
export interface ISplitResult {
  changeToken: SimpleToken;
  changeSalt: Uint8Array;
  recipientPayload: IRecipientPayload;
}

export interface IRecipientPayload {
  type: 'split_mint';
  tokenJson: string;
  transactionJson: string;
  salt: string;  // hex
  amount: string;
  coinType: string;
}

export class TokenSplitter {
  constructor(
    private readonly client: StateTransitionClient,
    private readonly trustBase: RootTrustBase,
  ) {}

  /**
   * Split a token, sending `amount` to recipient and keeping change.
   */
  async split(
    token: Token,
    tokenSalt: Uint8Array,
    signingService: SigningService,
    coinType: string,
    amount: bigint,
    recipientAddress: IAddress,
  ): Promise<ISplitResult>;

  /**
   * Split for exact amount (no change token created).
   * Used when token balance exactly equals amount.
   */
  async splitExact(
    token: Token,
    tokenSalt: Uint8Array,
    signingService: SigningService,
    coinType: string,
    recipientAddress: IAddress,
  ): Promise<IRecipientPayload>;
}
```

**Implementation details:**
- Use `TokenSplitBuilder` from SDK
- Submit burn commitment, wait for proof
- Submit mint commitments (recipient + change), wait for proofs
- Construct change token with `Token.fromJSON`
- Return recipient payload with salt

#### Task 1.3: Update SimpleToken for Split Reception

**File:** `src/SimpleToken.ts`

Add factory method for receiving split tokens:

```typescript
export class SimpleToken {
  /**
   * Create token from a split mint transaction.
   */
  static async fromSplitMint(
    mintTransactionJson: string,
    salt: Uint8Array,
    signingService: SigningService,
  ): Promise<SimpleToken>;
}
```

---

### Phase 2: Coin Management Layer

#### Task 2.1: Create CoinManager Class

Handles token selection and balance aggregation. Since tokens **cannot be joined**, the selection algorithm must minimize fragmentation.

**File:** `src/CoinManager.ts` (new)

```typescript
export interface ITokenSelection {
  /** Tokens to use (in order) */
  tokens: TokenEntry[];
  /** Total amount from selected tokens */
  totalAmount: bigint;
  /** Whether the last token needs splitting */
  requiresSplit: boolean;
  /** Amount to send from the split token (if splitting) */
  splitAmount?: bigint;
}

export class CoinManager {
  /**
   * Get total balance for a coin type across all tokens.
   */
  getBalance(wallet: Wallet, coinType: string, identityId?: string): bigint;

  /**
   * Get balances for all coin types.
   */
  getAllBalances(wallet: Wallet, identityId?: string): Map<string, bigint>;

  /**
   * Select tokens to fulfill an amount.
   * 
   * Strategy prioritizes minimizing fragmentation:
   * 1. Exact match (no split, no new tokens)
   * 2. Use smallest sufficient token (one split, one new change token)
   * 3. Consume small tokens first, split larger one for remainder
   */
  selectTokensForAmount(
    wallet: Wallet,
    coinType: string,
    amount: bigint,
    identityId?: string,
  ): ITokenSelection;
}
```

**Token Selection Algorithm (Fragmentation-Aware):**

Since tokens cannot be joined, every split creates permanent fragmentation. The algorithm minimizes this:

```
1. Get all tokens with coinType balance for identity
2. Sort by balance ascending

3. BEST CASE: Exact match
   - If any token.balance === amount → use it
   - Result: 0 new tokens (token transferred whole)

4. GOOD CASE: Single token split
   - Find smallest token where balance >= amount
   - Result: 1 new token (change)

5. MULTI-TOKEN CASE: Use multiple tokens
   - Goal: Consume small tokens entirely, split only if necessary
   - Strategy:
     a. Accumulate smallest tokens until sum >= amount
     b. If sum === amount → perfect, no split needed
     c. If sum > amount → we over-collected
        - Remove last token from selection
        - If remaining sum < amount:
          - Add back last token, split it for exact remainder
        - Else: try different combination
   
   - Result: At most 1 new token (change from final split)

6. OPTIMIZATION: Prefer consuming small tokens
   - Small tokens are "dead weight" (can't be joined)
   - Better to use them up than leave them
   - Only split larger tokens when necessary
```

**Example:**

```
Tokens: [10, 25, 50, 100, 500]
Send: 80

Option A: Split 100 → sends 80, keeps 20 (1 new small token)
Option B: Use 10 + 25 + 50 = 85, split 50 for 45 → sends 80, keeps 5 (1 new tiny token)
Option C: Use 10 + 25 = 35, split 50 for 45 → sends 80, keeps 5 (1 new tiny token, consumed 2 smalls)

Best: Option C - consumed 2 small tokens, only 1 new token created

Tokens: [10, 25, 50, 100, 500]  
Send: 35

Option A: Split 50 → sends 35, keeps 15 (1 new token)
Option B: Use 10 + 25 = 35 exactly (0 new tokens, consumed 2 smalls)

Best: Option B - exact match with small tokens
```

#### Task 2.2: Add Balance Methods to Wallet

**File:** `src/Wallet.ts`

```typescript
export class Wallet {
  /**
   * Get total balance for a coin type.
   */
  getBalance(coinType: string, identityId?: string): bigint;

  /**
   * Get all coin balances.
   */
  getBalances(identityId?: string): Map<string, bigint>;
}
```

---

### Phase 3: Updated AlphaClient API

#### Task 3.1: Add Amount-Based Send Method

**File:** `src/AlphaClient.ts`

```typescript
export interface ISendAmountOptions {
  identityId?: string;
  message?: string;
  recipientData?: Uint8Array;
}

export interface ISendAmountResult {
  sent: bigint;
  recipientPayload: string;  // JSON to send to recipient
  tokensUsed: number;
  splitPerformed: boolean;
}

export class AlphaClient {
  /**
   * Send an amount of a coin type to a recipient.
   * Automatically selects and splits tokens as needed.
   */
  async send(
    wallet: Wallet,
    coinType: string,
    amount: bigint,
    recipientAddress: string,
    options?: ISendAmountOptions,
  ): Promise<ISendAmountResult>;

  /**
   * Send an entire token (existing API, renamed).
   */
  async sendToken(
    wallet: Wallet,
    tokenId: string,
    recipientAddress: string,
    options?: ITransferOptions,
  ): Promise<ISendResult>;
}
```

**Implementation:**

```typescript
async send(wallet, coinType, amount, recipientAddress, options = {}) {
  // 1. Validate
  const balance = wallet.getBalance(coinType, options.identityId);
  if (balance < amount) {
    throw new Error(`Insufficient ${coinType} balance: have ${balance}, need ${amount}`);
  }

  // 2. Select tokens
  const selection = this.coinManager.selectTokensForAmount(
    wallet, coinType, amount, options.identityId
  );

  // 3. Get identity and signing service
  const identity = options.identityId 
    ? wallet.getIdentity(options.identityId) 
    : wallet.getDefaultIdentity();
  const signingService = await identity.getSigningService();

  // 4. Parse recipient address
  const recipient = await this.parseAddress(recipientAddress);

  // 5. Handle based on selection
  if (selection.tokens.length === 1 && !selection.requiresSplit) {
    // Exact match - full token transfer
    return this.sendFullToken(wallet, selection.tokens[0], recipient, signingService);
  }

  if (selection.tokens.length === 1 && selection.requiresSplit) {
    // Single token split
    return this.sendWithSplit(
      wallet, selection.tokens[0], coinType, amount, recipient, signingService
    );
  }

  // Multiple tokens - complex case
  return this.sendMultipleTokens(
    wallet, selection, coinType, amount, recipient, signingService
  );
}
```

#### Task 3.2: Update Receive for Split Tokens

**File:** `src/AlphaClient.ts`

```typescript
export class AlphaClient {
  /**
   * Receive a token (handles both full transfers and splits).
   */
  async receive(
    wallet: Wallet,
    payload: string,  // JSON string from sender
    options?: IReceiveOptions,
  ): Promise<SimpleToken>;
}
```

**Implementation:**

```typescript
async receive(wallet, payloadJson, options = {}) {
  const payload = JSON.parse(payloadJson);

  if (payload.type === 'split_mint') {
    return this.receiveSplitToken(wallet, payload, options);
  } else {
    return this.receiveFullToken(wallet, payload, options);
  }
}

private async receiveSplitToken(wallet, payload, options) {
  const identity = options.identityId 
    ? wallet.getIdentity(options.identityId) 
    : wallet.getDefaultIdentity();
  const signingService = await identity.getSigningService();
  const salt = hexToBytes(payload.salt);

  const token = await SimpleToken.fromSplitMint(
    payload.tokenJson,
    salt,
    signingService,
  );

  wallet.addToken(token, identity.id, salt, options.label);
  return token;
}
```

---

### Phase 4: Wallet Convenience Methods

#### Task 4.1: High-Level Wallet Methods

**File:** `src/Wallet.ts`

```typescript
export class Wallet {
  /**
   * Check if wallet can afford an amount.
   */
  canAfford(coinType: string, amount: bigint, identityId?: string): boolean;

  /**
   * Get a summary of token holdings.
   */
  getSummary(identityId?: string): IWalletSummary;
}

export interface IWalletSummary {
  identityId: string;
  balances: Map<string, bigint>;
  tokenCount: number;
  tokens: Array<{
    id: string;
    coins: ICoinBalance[];
    label?: string;
  }>;
}
```

---

### Phase 5: Testing

#### Task 5.1: Unit Tests for CoinManager

**File:** `tests/CoinManager.test.ts`

- Test token selection with exact match
- Test token selection requiring split
- Test token selection with multiple tokens
- Test insufficient balance handling
- Test consolidation logic

#### Task 5.2: Unit Tests for TokenSplitter

**File:** `tests/TokenSplitter.test.ts`

- Test split with change
- Test split exact (no change)
- Test salt handling
- Test error cases

#### Task 5.3: Integration Tests

**File:** `tests/integration/send.test.ts`

- End-to-end send with split
- End-to-end receive split token
- Multi-token send scenario

---

## Migration Guide

### Breaking Changes

1. `TokenEntry` now requires `salt` parameter
2. `wallet.addToken()` signature changes to include salt
3. `client.send()` signature changes (amount-based)

### Deprecations

- `client.send(wallet, tokenId, address)` → `client.sendToken(wallet, tokenId, address)`

### Upgrade Path

```typescript
// Old code
const result = await client.send(wallet, tokenId, recipientAddress);

// New code - for sending specific token
const result = await client.sendToken(wallet, tokenId, recipientAddress);

// New code - for sending amount (recommended)
const result = await client.send(wallet, 'ALPHA', 500n, recipientAddress);
```

---

## File Summary

| File | Status | Description |
|------|--------|-------------|
| `src/Wallet.ts` | Modify | Add salt storage, balance methods |
| `src/TokenSplitter.ts` | New | Low-level split operations |
| `src/CoinManager.ts` | New | Token selection and consolidation |
| `src/SimpleToken.ts` | Modify | Add `fromSplitMint` factory |
| `src/AlphaClient.ts` | Modify | Amount-based send/receive |
| `src/types.ts` | Modify | New interfaces |
| `tests/CoinManager.test.ts` | New | CoinManager tests |
| `tests/TokenSplitter.test.ts` | New | TokenSplitter tests |
| `tests/integration/send.test.ts` | New | Integration tests |

---

## Implementation Order

1. **Task 1.1** - Salt storage (foundation for everything)
2. **Task 1.2** - TokenSplitter (core split logic)
3. **Task 1.3** - SimpleToken.fromSplitMint
4. **Task 2.1** - CoinManager (token selection)
5. **Task 2.2** - Wallet balance methods
6. **Task 3.1** - AlphaClient.send (amount-based)
7. **Task 3.2** - AlphaClient.receive (split-aware)
8. **Task 4.1** - Wallet convenience methods
9. **Task 5.x** - Tests

---

## Design Constraints

1. **No token joining** - Tokens cannot be merged/consolidated. Once split, they stay separate. This means the token selection algorithm must be smart about minimizing fragmentation.
2. **Single coin type per token** - Tokens have one coin type, simplifying the send logic.
3. **No network fees** - Aggregator API key covers costs.
4. **Sequential operations** - User should complete one send before starting another (wallet state must be consistent).

---

## Estimated Complexity

- Phase 1: High (core SDK integration, most error-prone)
- Phase 2: Medium (algorithm design)
- Phase 3: Medium (API design, backward compat)
- Phase 4: Low (convenience wrappers)
- Phase 5: Medium (comprehensive testing needed)

---

## References

- [SPLIT.md](./SPLIT.md) - Detailed SDK splitting guide
- [@unicitylabs/state-transition-sdk](https://github.com/unicitylabs/state-transition-sdk)
- [bounty-net implementation](https://github.com/unicitylabs/bounty-net) - Production reference
