import { UMAP } from 'umap-js';
import { HDBSCAN } from 'hdbscan-ts';

import type {
  ClusterEngineResult,
  TopicClusterEngine,
  ClusterEngineUmapParams,
  ClusterEngineHdbscanParams,
} from '../processors/topic-cluster.js';

export function createNodeTopicClusterEngine(): TopicClusterEngine & { engine: 'node' } {
  return {
    engine: 'node',
    async cluster(opts: {
      embeddings: Array<{ argumentId: string; embedding: number[] }>;
      umap: ClusterEngineUmapParams;
      hdbscan: ClusterEngineHdbscanParams;
    }): Promise<ClusterEngineResult> {
      const n = opts.embeddings.length;
      if (n === 0) return { points: [] };
      if (n === 1) {
        return {
          points: [
            {
              argumentId: opts.embeddings[0]!.argumentId,
              x: 0,
              y: 0,
              clusterId: -1,
            },
          ],
        };
      }

      const data = opts.embeddings.map((e) => e.embedding);

      const rng = mulberry32(opts.umap.randomState);
      const umap = new UMAP({
        nComponents: 2,
        nNeighbors: clampNeighbors(opts.umap.nNeighbors, n),
        minDist: opts.umap.minDist,
        distanceFn: cosineDistance,
        random: rng,
      });

      const coords = umap.fit(data);

      const hdb = new HDBSCAN({
        minClusterSize: opts.hdbscan.minClusterSize,
        minSamples: opts.hdbscan.minSamples,
      });

      const labels = extractLabels(hdb.fit(coords), hdb, n);

      return {
        points: opts.embeddings.map((row, idx) => ({
          argumentId: row.argumentId,
          x: finiteOrZero(coords[idx]?.[0]),
          y: finiteOrZero(coords[idx]?.[1]),
          clusterId: Number.isFinite(labels[idx]) ? labels[idx]! : -1,
        })),
      };
    },
  };
}

function clampNeighbors(requested: number, n: number): number {
  // UMAP requires 1 < nNeighbors < n
  const upper = Math.max(2, n - 1);
  return Math.max(2, Math.min(requested, upper));
}

function extractLabels(
  fitResult: unknown,
  instance: unknown,
  n: number
): number[] {
  if (Array.isArray(fitResult) && fitResult.length === n) return fitResult as number[];
  const maybe = (fitResult as { labels_?: unknown })?.labels_;
  if (Array.isArray(maybe) && maybe.length === n) return maybe as number[];
  const instLabels = (instance as { labels_?: unknown })?.labels_;
  if (Array.isArray(instLabels) && instLabels.length === n) return instLabels as number[];
  // Fallback: treat everything as noise
  return new Array(n).fill(-1);
}

function finiteOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / Math.sqrt(normA * normB);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

