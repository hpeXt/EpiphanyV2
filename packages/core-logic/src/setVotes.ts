/**
 * @file setVotes.ts
 * @description Pure functions for QV setVotes calculations
 *
 * Key invariant: balance + totalCostStaked === INITIAL_BALANCE (100)
 */

import type { ErrorCode } from '@epiphany/shared-contracts';

/** Initial balance for each user per topic */
export const INITIAL_BALANCE = 100;

/** Minimum votes (inclusive) */
export const MIN_VOTES = 0;

/** Maximum votes (inclusive) */
export const MAX_VOTES = 10;

/**
 * Policy options for setVotes validation
 */
export interface SetVotesPolicy {
  /** If true, only allows targetVotes <= currentVotes (for pruned/frozen arguments) */
  onlyAllowDecrease?: boolean;
}

/**
 * Input for calculateSetVotesDelta
 */
export interface SetVotesDeltaInput {
  currentVotes: number;
  targetVotes: number;
}

/**
 * Output from calculateSetVotesDelta
 */
export interface SetVotesDeltaOutput {
  deltaVotes: number;
  previousCost: number;
  targetCost: number;
  deltaCost: number;
}

/**
 * Input for validateSetVotes
 */
export interface ValidateSetVotesInput {
  currentVotes: number;
  targetVotes: number;
  balance: number;
  policy?: SetVotesPolicy;
}

/**
 * Success result from validateSetVotes
 */
export interface ValidateSetVotesSuccess {
  ok: true;
  delta: SetVotesDeltaOutput;
  newBalance: number;
}

/**
 * Error result from validateSetVotes
 */
export interface ValidateSetVotesError {
  ok: false;
  errorCode: ErrorCode;
  message: string;
}

export type ValidateSetVotesResult = ValidateSetVotesSuccess | ValidateSetVotesError;

/**
 * Check if a value is a valid vote count (integer in range 0-10)
 */
function isValidVoteCount(votes: number): boolean {
  return Number.isInteger(votes) && votes >= MIN_VOTES && votes <= MAX_VOTES;
}

/**
 * Calculate the cost (credit consumed) for a given number of votes.
 * QV cost formula: votes^2
 *
 * @param votes - Number of votes (0-10)
 * @returns Cost as integer
 */
export function calculateVoteCost(votes: number): number {
  return votes * votes;
}

/**
 * Calculate the delta (change) when moving from currentVotes to targetVotes.
 *
 * @param input - Current and target votes
 * @returns Delta information including vote change and cost change
 */
export function calculateSetVotesDelta(input: SetVotesDeltaInput): SetVotesDeltaOutput {
  const { currentVotes, targetVotes } = input;
  const previousCost = calculateVoteCost(currentVotes);
  const targetCost = calculateVoteCost(targetVotes);

  return {
    deltaVotes: targetVotes - currentVotes,
    previousCost,
    targetCost,
    deltaCost: targetCost - previousCost,
  };
}

/**
 * Validate a setVotes operation and return either success with delta info
 * or an error with appropriate error code.
 *
 * @param input - Validation input including votes and balance
 * @returns Result with delta info on success, or error code on failure
 */
export function validateSetVotes(input: ValidateSetVotesInput): ValidateSetVotesResult {
  const { currentVotes, targetVotes, balance, policy } = input;

  // Validate targetVotes is a valid vote count
  if (!isValidVoteCount(targetVotes)) {
    return {
      ok: false,
      errorCode: 'BAD_REQUEST',
      message: `targetVotes must be an integer between ${MIN_VOTES} and ${MAX_VOTES}`,
    };
  }

  // Check onlyAllowDecrease policy (for pruned/frozen arguments)
  if (policy?.onlyAllowDecrease && targetVotes > currentVotes) {
    return {
      ok: false,
      errorCode: 'ARGUMENT_PRUNED_INCREASE_FORBIDDEN',
      message: 'Cannot increase votes on a pruned or frozen argument',
    };
  }

  // Calculate delta
  const delta = calculateSetVotesDelta({ currentVotes, targetVotes });

  // Check balance sufficiency (only needed when deltaCost > 0)
  if (delta.deltaCost > 0 && balance < delta.deltaCost) {
    return {
      ok: false,
      errorCode: 'INSUFFICIENT_BALANCE',
      message: `Insufficient balance: need ${delta.deltaCost}, have ${balance}`,
    };
  }

  // Success
  return {
    ok: true,
    delta,
    newBalance: balance - delta.deltaCost,
  };
}
