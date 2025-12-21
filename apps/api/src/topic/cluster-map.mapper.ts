import type { ClusterMap, ClusterMapCluster, ClusterMapPoint, Stance } from '@epiphany/shared-contracts';

export interface ClusterMapPointRow {
  argumentId: string;
  umapX: number;
  umapY: number;
  clusterId: number | null;
  totalVotes: number;
  stanceScore: number | null;
  analysisStatus: 'pending_analysis' | 'ready' | 'failed' | string;
}

export interface ClusterMapCampRow {
  clusterId: number;
  label: string | null;
  summary: string | null;
}

export function getClusterMapModelVersion(lastClusteredAt: Date | null): string {
  if (!lastClusteredAt) return 'v1';
  return `v1-${lastClusteredAt.toISOString()}`;
}

export function toClusterIdString(clusterId: number | null): string {
  return clusterId == null ? '-1' : String(clusterId);
}

export function stanceFromScore(
  stanceScore: number | null,
  analysisStatus: string
): Stance {
  if (analysisStatus !== 'ready') return 0;
  if (stanceScore == null) return 0;
  if (stanceScore <= -0.3) return -1;
  if (stanceScore >= 0.3) return 1;
  return 0;
}

export function weightFromTotalVotes(totalVotes: number): number {
  const safe = Number.isFinite(totalVotes) ? Math.max(0, totalVotes) : 0;
  return Math.log(safe + 1);
}

export function normalizeToMinus1To1(values: number[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return values.map(() => 0);
  }
  const denom = max - min;
  return values.map((v) => (Number.isFinite(v) ? 2 * ((v - min) / denom) - 1 : 0));
}

export function normalizePointsToMinus1To1<T extends { x: number; y: number }>(
  points: T[]
): Array<T & { x: number; y: number }> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const nx = normalizeToMinus1To1(xs);
  const ny = normalizeToMinus1To1(ys);
  return points.map((p, i) => ({ ...p, x: nx[i]!, y: ny[i]! }));
}

export function buildClusterMapResponse(params: {
  topicId: string;
  computedAt: Date;
  modelVersion: string;
  points: ClusterMapPointRow[];
  camps: ClusterMapCampRow[];
}): ClusterMap {
  const rawPoints: Array<Omit<ClusterMapPoint, 'x' | 'y'> & { x: number; y: number; __clusterIdNum: number | null }> =
    params.points.map((row) => ({
      argumentId: row.argumentId,
      x: row.umapX,
      y: row.umapY,
      clusterId: toClusterIdString(row.clusterId),
      stance: stanceFromScore(row.stanceScore, row.analysisStatus),
      weight: weightFromTotalVotes(row.totalVotes),
      __clusterIdNum: row.clusterId,
    }));

  const normalized = normalizePointsToMinus1To1(rawPoints);

  const points: ClusterMapPoint[] = normalized.map((p) => ({
    argumentId: p.argumentId,
    x: p.x,
    y: p.y,
    clusterId: p.clusterId,
    stance: p.stance,
    weight: p.weight,
  }));

  const centroidByClusterId = new Map<number, { x: number; y: number; n: number }>();
  for (const p of normalized) {
    if (p.__clusterIdNum == null || p.__clusterIdNum < 0) continue;
    const prev = centroidByClusterId.get(p.__clusterIdNum) ?? { x: 0, y: 0, n: 0 };
    centroidByClusterId.set(p.__clusterIdNum, {
      x: prev.x + p.x,
      y: prev.y + p.y,
      n: prev.n + 1,
    });
  }

  const clusters: ClusterMapCluster[] = params.camps
    .slice()
    .sort((a, b) => a.clusterId - b.clusterId)
    .map((camp): ClusterMapCluster => {
      const acc = centroidByClusterId.get(camp.clusterId);
      const centroid = acc && acc.n > 0 ? { x: acc.x / acc.n, y: acc.y / acc.n } : { x: 0, y: 0 };
      return {
        id: String(camp.clusterId),
        label: camp.label,
        summary: camp.summary,
        centroid,
      };
    });

  return {
    topicId: params.topicId,
    modelVersion: params.modelVersion,
    computedAt: params.computedAt.toISOString(),
    points,
    clusters,
  };
}

