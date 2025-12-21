import {
  buildClusterMapResponse,
  getClusterMapModelVersion,
  normalizeToMinus1To1,
  stanceFromScore,
  weightFromTotalVotes,
} from './cluster-map.mapper';

describe('cluster-map.mapper', () => {
  it('normalizeToMinus1To1 should min-max scale to [-1,1]', () => {
    expect(normalizeToMinus1To1([10, 20])).toEqual([-1, 1]);
    expect(normalizeToMinus1To1([5, 5, 5])).toEqual([0, 0, 0]);
  });

  it('stanceFromScore should follow documented thresholds', () => {
    expect(stanceFromScore(null, 'ready')).toBe(0);
    expect(stanceFromScore(-0.3, 'ready')).toBe(-1);
    expect(stanceFromScore(-0.31, 'ready')).toBe(-1);
    expect(stanceFromScore(0, 'ready')).toBe(0);
    expect(stanceFromScore(0.29, 'ready')).toBe(0);
    expect(stanceFromScore(0.3, 'ready')).toBe(1);
    expect(stanceFromScore(0.31, 'ready')).toBe(1);
    expect(stanceFromScore(0.9, 'failed')).toBe(0);
  });

  it('weightFromTotalVotes should be log(totalVotes+1)', () => {
    expect(weightFromTotalVotes(0)).toBeCloseTo(0, 8);
    expect(weightFromTotalVotes(9)).toBeCloseTo(Math.log(10), 8);
  });

  it('buildClusterMapResponse should map ids, normalize coords, and compute centroids', () => {
    const computedAt = new Date('2025-12-19T12:00:00.000Z');
    const modelVersion = getClusterMapModelVersion(computedAt);

    const result = buildClusterMapResponse({
      topicId: 'topic_1',
      computedAt,
      modelVersion,
      points: [
        {
          argumentId: 'a1',
          umapX: 10,
          umapY: -5,
          clusterId: null,
          totalVotes: 0,
          stanceScore: -0.31,
          analysisStatus: 'ready',
        },
        {
          argumentId: 'a2',
          umapX: 20,
          umapY: 5,
          clusterId: 0,
          totalVotes: 9,
          stanceScore: 0.31,
          analysisStatus: 'ready',
        },
      ],
      camps: [{ clusterId: 0, label: 'Camp 0', summary: null }],
    });

    expect(result.topicId).toBe('topic_1');
    expect(result.modelVersion).toBe(`v1-${computedAt.toISOString()}`);
    expect(result.computedAt).toBe(computedAt.toISOString());

    const byId = new Map(result.points.map((p) => [p.argumentId, p]));
    expect(byId.get('a1')!.clusterId).toBe('-1');
    expect(byId.get('a1')!.x).toBe(-1);
    expect(byId.get('a1')!.y).toBe(-1);
    expect(byId.get('a2')!.clusterId).toBe('0');
    expect(byId.get('a2')!.x).toBe(1);
    expect(byId.get('a2')!.y).toBe(1);

    expect(result.clusters).toEqual([
      { id: '0', label: 'Camp 0', summary: null, centroid: { x: 1, y: 1 } },
    ]);
  });
});

