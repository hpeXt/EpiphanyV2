"use client";

/**
 * Withdraw All - Batch withdrawal with concurrency control
 * Step 17: One-click withdrawal for all stakes in a topic
 *
 * @see docs/stage01/steps/step17.md
 * @see docs/stage01/core-flows.md#5
 */

import { apiClient } from "@/lib/apiClient";
import type { LedgerMe } from "@epiphany/shared-contracts";

export type StakeToWithdraw = {
  argumentId: string;
  votes: number;
  cost: number;
};

export type WithdrawSuccessItem = {
  argumentId: string;
  previousVotes: number;
  refundedCost: number;
};

export type WithdrawFailedItem = {
  argumentId: string;
  votes: number;
  cost: number;
  error: { code?: string; message: string };
};

export type WithdrawProgress = {
  completed: number;
  total: number;
  successCount: number;
  failCount: number;
  currentArgumentId?: string;
};

export type WithdrawResult = {
  successful: WithdrawSuccessItem[];
  failed: WithdrawFailedItem[];
  finalLedger: LedgerMe | null;
};

export type WithdrawOptions = {
  /** Maximum concurrent requests (default: 2) */
  concurrencyLimit?: number;
  /** Progress callback */
  onProgress?: (progress: WithdrawProgress) => void;
};

/**
 * Limit concurrency using a simple semaphore pattern
 */
async function limitConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then(() => {
      executing.splice(executing.indexOf(promise), 1);
    });
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

/**
 * Withdraw all stakes for a topic by calling setVotes(0) for each stake
 *
 * Features:
 * - Limits concurrent requests to avoid overloading the API
 * - Continues processing even if some withdrawals fail
 * - Returns both successful and failed items for retry
 * - Reports progress via callback
 *
 * @param topicId - The topic to withdraw from
 * @param stakes - List of stakes to withdraw
 * @param options - Concurrency limit and progress callback
 */
export async function withdrawAll(
  topicId: string,
  stakes: StakeToWithdraw[],
  options: WithdrawOptions = {},
): Promise<WithdrawResult> {
  const { concurrencyLimit = 2, onProgress } = options;

  // Filter out stakes with zero votes (nothing to withdraw)
  const stakesToProcess = stakes.filter((s) => s.votes > 0);

  if (stakesToProcess.length === 0) {
    return { successful: [], failed: [], finalLedger: null };
  }

  const successful: WithdrawSuccessItem[] = [];
  const failed: WithdrawFailedItem[] = [];
  let finalLedger: LedgerMe | null = null;
  let completed = 0;

  const reportProgress = () => {
    onProgress?.({
      completed,
      total: stakesToProcess.length,
      successCount: successful.length,
      failCount: failed.length,
    });
  };

  await limitConcurrency(stakesToProcess, concurrencyLimit, async (stake) => {
    try {
      const result = await apiClient.setVotes(topicId, stake.argumentId, {
        targetVotes: 0,
      });

      if (result.ok) {
        successful.push({
          argumentId: stake.argumentId,
          previousVotes: result.data.previousVotes,
          refundedCost: Math.abs(result.data.deltaCost),
        });
        finalLedger = result.data.ledger;
      } else {
        failed.push({
          argumentId: stake.argumentId,
          votes: stake.votes,
          cost: stake.cost,
          error: {
            code: result.error.kind === "http" ? result.error.code : undefined,
            message: result.error.message,
          },
        });
      }
    } catch (err) {
      failed.push({
        argumentId: stake.argumentId,
        votes: stake.votes,
        cost: stake.cost,
        error: {
          message: err instanceof Error ? err.message : "Unknown error",
        },
      });
    }

    completed++;
    reportProgress();
  });

  return { successful, failed, finalLedger };
}

/**
 * Retry failed withdrawals
 * Convenience wrapper that converts failed items back to stakes format
 */
export async function retryFailedWithdrawals(
  topicId: string,
  failedItems: WithdrawFailedItem[],
  options: WithdrawOptions = {},
): Promise<WithdrawResult> {
  const stakes: StakeToWithdraw[] = failedItems.map((item) => ({
    argumentId: item.argumentId,
    votes: item.votes,
    cost: item.cost,
  }));

  return withdrawAll(topicId, stakes, options);
}
