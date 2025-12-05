/**
 * CoinManager - Handles token selection and balance aggregation.
 *
 * Since tokens cannot be joined, the selection algorithm must minimize fragmentation.
 * Every split creates permanent fragmentation, so the algorithm prioritizes:
 * 1. Exact matches (no new tokens created)
 * 2. Consuming small tokens first (they can't be merged anyway)
 * 3. Splitting only when necessary, preferring smaller sufficient tokens
 */

import { TokenEntry, Wallet } from "./Wallet.js";

/**
 * Result of token selection for a specific amount.
 */
export interface ITokenSelection {
  /** Tokens to use (in order of consumption) */
  readonly tokens: TokenEntry[];
  /** Total amount from selected tokens */
  readonly totalAmount: bigint;
  /** Whether the last token needs splitting */
  readonly requiresSplit: boolean;
  /** Amount to send from the split token (if splitting) */
  readonly splitAmount?: bigint;
  /** Amount of change returned (if splitting) */
  readonly changeAmount?: bigint;
}

/**
 * Internal representation of a token with its balance for a specific coin type.
 */
interface ITokenWithBalance {
  readonly entry: TokenEntry;
  readonly balance: bigint;
}

/**
 * Manages coin balances and token selection across the wallet.
 */
export class CoinManager {
  /**
   * Get total balance for a specific coin type.
   *
   * @param wallet The wallet to query
   * @param coinType The coin type (e.g., 'ALPHA')
   * @param identityId Optional identity to filter by
   * @returns Total balance for the coin type
   */
  public getBalance(
    wallet: Wallet,
    coinType: string,
    identityId?: string,
  ): bigint {
    const tokens = identityId
      ? wallet.listTokensForIdentity(identityId)
      : wallet.listTokens();

    let total = 0n;
    for (const entry of tokens) {
      total += entry.token.getCoinBalance(coinType);
    }
    return total;
  }

  /**
   * Get balances for all coin types in the wallet.
   *
   * @param wallet The wallet to query
   * @param identityId Optional identity to filter by
   * @returns Map of coin type to total balance
   */
  public getAllBalances(
    wallet: Wallet,
    identityId?: string,
  ): Map<string, bigint> {
    const tokens = identityId
      ? wallet.listTokensForIdentity(identityId)
      : wallet.listTokens();

    const balances = new Map<string, bigint>();

    for (const entry of tokens) {
      for (const coin of entry.token.coins) {
        const current = balances.get(coin.name) ?? 0n;
        balances.set(coin.name, current + coin.amount);
      }
    }

    return balances;
  }

  /**
   * Select tokens to fulfill an amount.
   *
   * Strategy prioritizes minimizing fragmentation:
   * 1. Exact match (no split, no new tokens)
   * 2. Use smallest sufficient token (one split, one new change token)
   * 3. Consume small tokens first, split larger one for remainder
   *
   * @param wallet The wallet to select from
   * @param coinType The coin type to send
   * @param amount The amount to send
   * @param identityId Optional identity to filter by
   * @returns Token selection result
   * @throws Error if insufficient balance
   */
  public selectTokensForAmount(
    wallet: Wallet,
    coinType: string,
    amount: bigint,
    identityId?: string,
  ): ITokenSelection {
    if (amount <= 0n) {
      throw new Error("Amount must be positive");
    }

    // Get all tokens with non-zero balance for this coin type
    const tokensWithBalance = this.getTokensWithBalance(
      wallet,
      coinType,
      identityId,
    );

    if (tokensWithBalance.length === 0) {
      throw new Error(`No tokens with ${coinType} balance`);
    }

    // Calculate total available balance
    const totalBalance = tokensWithBalance.reduce(
      (sum, t) => sum + t.balance,
      0n,
    );

    if (totalBalance < amount) {
      throw new Error(
        `Insufficient ${coinType} balance: have ${totalBalance}, need ${amount}`,
      );
    }

    // Sort by balance ascending (prefer consuming small tokens first)
    const sorted = [...tokensWithBalance].sort((a, b) =>
      a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0,
    );

    // BEST CASE: Exact match - no new tokens created
    const exactMatch = sorted.find((t) => t.balance === amount);
    if (exactMatch) {
      return {
        tokens: [exactMatch.entry],
        totalAmount: amount,
        requiresSplit: false,
      };
    }

    // GOOD CASE: Single token split - find smallest sufficient token
    const smallestSufficient = sorted.find((t) => t.balance >= amount);
    if (smallestSufficient) {
      // If total balance equals amount, we'd need all tokens but last one would need split
      // Check if consuming small tokens + splitting is better
      const consumeSmallResult = this.tryConsumeSmallTokens(
        sorted,
        amount,
        smallestSufficient,
      );

      if (consumeSmallResult) {
        return consumeSmallResult;
      }

      // Just split the smallest sufficient token
      return {
        tokens: [smallestSufficient.entry],
        totalAmount: smallestSufficient.balance,
        requiresSplit: true,
        splitAmount: amount,
        changeAmount: smallestSufficient.balance - amount,
      };
    }

    // MULTI-TOKEN CASE: Need multiple tokens
    // Accumulate small tokens until we have enough
    return this.selectMultipleTokens(sorted, amount);
  }

  /**
   * Get tokens that have a non-zero balance for the specified coin type.
   */
  private getTokensWithBalance(
    wallet: Wallet,
    coinType: string,
    identityId?: string,
  ): ITokenWithBalance[] {
    const entries = identityId
      ? wallet.listTokensForIdentity(identityId)
      : wallet.listTokens();

    const result: ITokenWithBalance[] = [];

    for (const entry of entries) {
      const balance = entry.token.getCoinBalance(coinType);
      if (balance > 0n) {
        result.push({ entry, balance });
      }
    }

    return result;
  }

  /**
   * Try to consume small tokens before splitting a larger one.
   * Returns null if this strategy isn't beneficial.
   */
  private tryConsumeSmallTokens(
    sortedTokens: ITokenWithBalance[],
    amount: bigint,
    smallestSufficient: ITokenWithBalance,
  ): ITokenSelection | null {
    // Find tokens smaller than the smallestSufficient
    const smallerTokens = sortedTokens.filter(
      (t) => t.balance < smallestSufficient.balance,
    );

    if (smallerTokens.length === 0) {
      return null;
    }

    // Accumulate smaller tokens
    let accumulated = 0n;
    const consumed: ITokenWithBalance[] = [];

    for (const token of smallerTokens) {
      consumed.push(token);
      accumulated += token.balance;

      // Perfect match with small tokens only!
      if (accumulated === amount) {
        return {
          tokens: consumed.map((t) => t.entry),
          totalAmount: amount,
          requiresSplit: false,
        };
      }

      // Over-accumulated - check if we need to split
      if (accumulated > amount) {
        // Remove the last token and see if we can use smallestSufficient to fill the gap
        const lastToken = consumed.pop()!;
        accumulated -= lastToken.balance;

        const remaining = amount - accumulated;

        // If remaining > 0, we need to split smallestSufficient for the remainder
        if (remaining > 0n && remaining < smallestSufficient.balance) {
          return {
            tokens: [...consumed.map((t) => t.entry), smallestSufficient.entry],
            totalAmount: accumulated + smallestSufficient.balance,
            requiresSplit: true,
            splitAmount: remaining,
            changeAmount: smallestSufficient.balance - remaining,
          };
        }

        // Put it back and continue accumulating
        consumed.push(lastToken);
        accumulated += lastToken.balance;
      }
    }

    // All smaller tokens don't add up to amount
    // See if smaller tokens + part of smallestSufficient works
    const remaining = amount - accumulated;
    if (remaining > 0n && remaining < smallestSufficient.balance) {
      return {
        tokens: [...consumed.map((t) => t.entry), smallestSufficient.entry],
        totalAmount: accumulated + smallestSufficient.balance,
        requiresSplit: true,
        splitAmount: remaining,
        changeAmount: smallestSufficient.balance - remaining,
      };
    }

    return null;
  }

  /**
   * Select multiple tokens when no single token is sufficient.
   */
  private selectMultipleTokens(
    sortedTokens: ITokenWithBalance[],
    amount: bigint,
  ): ITokenSelection {
    // Accumulate from smallest to largest
    let accumulated = 0n;
    const selected: ITokenWithBalance[] = [];

    for (const token of sortedTokens) {
      selected.push(token);
      accumulated += token.balance;

      // Perfect match!
      if (accumulated === amount) {
        return {
          tokens: selected.map((t) => t.entry),
          totalAmount: amount,
          requiresSplit: false,
        };
      }

      // Over-accumulated - we have enough with last token needing split
      if (accumulated > amount) {
        const lastToken = selected[selected.length - 1]!;

        // Calculate how much we need from the last token
        const neededFromLast = amount - (accumulated - lastToken.balance);

        return {
          tokens: selected.map((t) => t.entry),
          totalAmount: accumulated,
          requiresSplit: true,
          splitAmount: neededFromLast,
          changeAmount: lastToken.balance - neededFromLast,
        };
      }
    }

    // Should not reach here if balance check passed
    throw new Error("Unexpected: could not select sufficient tokens");
  }
}
