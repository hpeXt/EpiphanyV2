/**
 * @file setVotes.test.ts
 * @description Tests for QV setVotes pure logic
 *
 * TDD: These tests define the expected behavior before implementation.
 * Key invariant: balance + totalCostStaked === INITIAL_BALANCE (100)
 */

import {
  calculateVoteCost,
  calculateSetVotesDelta,
  validateSetVotes,
  INITIAL_BALANCE,
  MIN_VOTES,
  MAX_VOTES,
  type SetVotesDeltaInput,
  type ValidateSetVotesInput,
} from '../setVotes.js';

describe('calculateVoteCost', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 4],
    [3, 9],
    [4, 16],
    [5, 25],
    [6, 36],
    [7, 49],
    [8, 64],
    [9, 81],
    [10, 100],
  ])('votes=%d should cost %d', (votes, expectedCost) => {
    expect(calculateVoteCost(votes)).toBe(expectedCost);
  });

  it('should return integer for all valid vote values', () => {
    for (let v = MIN_VOTES; v <= MAX_VOTES; v++) {
      const cost = calculateVoteCost(v);
      expect(Number.isInteger(cost)).toBe(true);
    }
  });
});

describe('calculateSetVotesDelta', () => {
  describe('table-driven cases from step04', () => {
    const cases: Array<{
      name: string;
      input: SetVotesDeltaInput;
      expected: { deltaVotes: number; deltaCost: number };
    }> = [
      {
        name: 'currentVotes=0 -> targetVotes=0: deltaCost=0',
        input: { currentVotes: 0, targetVotes: 0 },
        expected: { deltaVotes: 0, deltaCost: 0 },
      },
      {
        name: 'currentVotes=5 -> targetVotes=5: deltaVotes=0, deltaCost=0 (idempotent)',
        input: { currentVotes: 5, targetVotes: 5 },
        expected: { deltaVotes: 0, deltaCost: 0 },
      },
      {
        name: '0 -> 10: deltaCost=100 (full consumption)',
        input: { currentVotes: 0, targetVotes: 10 },
        expected: { deltaVotes: 10, deltaCost: 100 },
      },
      {
        name: '10 -> 0: deltaCost=-100 (full refund)',
        input: { currentVotes: 10, targetVotes: 0 },
        expected: { deltaVotes: -10, deltaCost: -100 },
      },
      {
        name: '3 -> 4: deltaCost = 16-9 = 7',
        input: { currentVotes: 3, targetVotes: 4 },
        expected: { deltaVotes: 1, deltaCost: 7 },
      },
      {
        name: '4 -> 3: deltaCost = 9-16 = -7 (refund)',
        input: { currentVotes: 4, targetVotes: 3 },
        expected: { deltaVotes: -1, deltaCost: -7 },
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      const result = calculateSetVotesDelta(input);
      expect(result.deltaVotes).toBe(expected.deltaVotes);
      expect(result.deltaCost).toBe(expected.deltaCost);
    });
  });

  describe('symmetry property', () => {
    it.each([
      [0, 5],
      [0, 10],
      [3, 7],
      [1, 9],
      [5, 10],
    ])('deltaCost(%d->%d) === -deltaCost(%d->%d)', (a, b) => {
      const forward = calculateSetVotesDelta({ currentVotes: a, targetVotes: b });
      const backward = calculateSetVotesDelta({ currentVotes: b, targetVotes: a });
      expect(forward.deltaCost).toBe(-backward.deltaCost);
    });
  });

  describe('output integrity', () => {
    it('should return previousCost and targetCost correctly', () => {
      const result = calculateSetVotesDelta({ currentVotes: 3, targetVotes: 7 });
      expect(result.previousCost).toBe(9); // 3^2
      expect(result.targetCost).toBe(49); // 7^2
      expect(result.deltaCost).toBe(40); // 49 - 9
    });

    it('should always return integers', () => {
      for (let curr = MIN_VOTES; curr <= MAX_VOTES; curr++) {
        for (let target = MIN_VOTES; target <= MAX_VOTES; target++) {
          const result = calculateSetVotesDelta({ currentVotes: curr, targetVotes: target });
          expect(Number.isInteger(result.deltaVotes)).toBe(true);
          expect(Number.isInteger(result.previousCost)).toBe(true);
          expect(Number.isInteger(result.targetCost)).toBe(true);
          expect(Number.isInteger(result.deltaCost)).toBe(true);
        }
      }
    });
  });
});

describe('validateSetVotes', () => {
  describe('successful validations', () => {
    it('should accept valid vote increase with sufficient balance', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 5,
        balance: 100,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.deltaCost).toBe(25);
        expect(result.newBalance).toBe(75);
      }
    });

    it('should accept vote decrease (refund)', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 3,
        balance: 75,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.deltaCost).toBe(-16); // 9 - 25 = -16
        expect(result.newBalance).toBe(91);
      }
    });

    it('should accept no-change (idempotent)', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 5,
        balance: 75,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.deltaCost).toBe(0);
        expect(result.newBalance).toBe(75);
      }
    });
  });

  describe('INSUFFICIENT_BALANCE rejection', () => {
    it('should reject when balance is insufficient', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 10,
        balance: 50, // Need 100, have 50
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('INSUFFICIENT_BALANCE');
      }
    });

    it('should reject when balance is exactly 1 less than needed', () => {
      const result = validateSetVotes({
        currentVotes: 3,
        targetVotes: 4,
        balance: 6, // Need 7, have 6
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('INSUFFICIENT_BALANCE');
      }
    });

    it('should accept when balance is exactly enough', () => {
      const result = validateSetVotes({
        currentVotes: 3,
        targetVotes: 4,
        balance: 7, // Need 7, have 7
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('BAD_REQUEST - targetVotes validation', () => {
    it('should reject non-integer targetVotes', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 3.5,
        balance: 100,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('BAD_REQUEST');
      }
    });

    it('should reject negative targetVotes', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: -1,
        balance: 100,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('BAD_REQUEST');
      }
    });

    it('should reject targetVotes > MAX_VOTES', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 11,
        balance: 200,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('BAD_REQUEST');
      }
    });

    it('should reject NaN targetVotes', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: NaN,
        balance: 100,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('BAD_REQUEST');
      }
    });

    it('should reject Infinity targetVotes', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: Infinity,
        balance: 100,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('BAD_REQUEST');
      }
    });
  });

  describe('onlyAllowDecrease policy (for pruned/frozen arguments)', () => {
    it('should allow decrease when onlyAllowDecrease is true', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 3,
        balance: 75,
        policy: { onlyAllowDecrease: true },
      });
      expect(result.ok).toBe(true);
    });

    it('should allow no-change when onlyAllowDecrease is true', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 5,
        balance: 75,
        policy: { onlyAllowDecrease: true },
      });
      expect(result.ok).toBe(true);
    });

    it('should reject increase when onlyAllowDecrease is true', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 6,
        balance: 75,
        policy: { onlyAllowDecrease: true },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('ARGUMENT_PRUNED_INCREASE_FORBIDDEN');
      }
    });

    it('should allow increase when onlyAllowDecrease is false/undefined', () => {
      const result = validateSetVotes({
        currentVotes: 5,
        targetVotes: 6,
        balance: 75,
        policy: { onlyAllowDecrease: false },
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('invariant: balance + totalCostStaked === INITIAL_BALANCE', () => {
    it.each([
      { currentVotes: 0, targetVotes: 5, currentBalance: 100, expectedNewBalance: 75 },
      { currentVotes: 5, targetVotes: 10, currentBalance: 75, expectedNewBalance: 0 },
      { currentVotes: 10, targetVotes: 0, currentBalance: 0, expectedNewBalance: 100 },
      { currentVotes: 3, targetVotes: 7, currentBalance: 91, expectedNewBalance: 51 },
    ])(
      'balance + cost should equal $INITIAL_BALANCE after $currentVotes->$targetVotes',
      ({ currentVotes, targetVotes, currentBalance, expectedNewBalance }) => {
        const result = validateSetVotes({
          currentVotes,
          targetVotes,
          balance: currentBalance,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.newBalance).toBe(expectedNewBalance);
          // Verify invariant: newBalance + targetCost === INITIAL_BALANCE
          expect(result.newBalance + result.delta.targetCost).toBe(INITIAL_BALANCE);
        }
      },
    );

    it('should maintain invariant through random sequence of operations', () => {
      // Simulate a sequence of vote operations
      // Start with balance=100, no votes
      let balance = INITIAL_BALANCE;
      let currentVotes = 0;

      // Random seed for reproducibility
      const sequence = [5, 3, 7, 2, 10, 0, 4, 4, 8, 1, 0];

      for (const targetVotes of sequence) {
        const result = validateSetVotes({
          currentVotes,
          targetVotes,
          balance,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          // Verify invariant
          expect(result.newBalance + result.delta.targetCost).toBe(INITIAL_BALANCE);

          // Update state for next iteration
          balance = result.newBalance;
          currentVotes = targetVotes;
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle 0->0 transition', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 0,
        balance: 100,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.deltaCost).toBe(0);
        expect(result.newBalance).toBe(100);
      }
    });

    it('should handle 10->10 transition', () => {
      const result = validateSetVotes({
        currentVotes: 10,
        targetVotes: 10,
        balance: 0,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.deltaCost).toBe(0);
        expect(result.newBalance).toBe(0);
      }
    });

    it('should allow full allocation 0->10 with exact balance', () => {
      const result = validateSetVotes({
        currentVotes: 0,
        targetVotes: 10,
        balance: 100,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newBalance).toBe(0);
      }
    });

    it('should allow full withdrawal 10->0', () => {
      const result = validateSetVotes({
        currentVotes: 10,
        targetVotes: 0,
        balance: 0,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newBalance).toBe(100);
      }
    });
  });
});
