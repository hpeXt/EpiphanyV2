import type {
  TopicClusterEngine,
  ClusterEngineResult,
  ClusterEngineUmapParams,
  ClusterEngineHdbscanParams,
} from '../processors/topic-cluster.js';

export function createPythonTopicClusterEngine(): TopicClusterEngine & { engine: 'python' } {
  const baseUrl = process.env.AI_WORKER_URL;
  const token = process.env.AI_WORKER_TOKEN;

  if (!baseUrl) {
    throw new Error('AI_WORKER_URL is required when CLUSTER_ENGINE=python');
  }

  if (!token) {
    throw new Error('AI_WORKER_TOKEN is required when CLUSTER_ENGINE=python');
  }

  return {
    engine: 'python',
    async cluster(opts: {
      topicId: string;
      computedAt: Date;
      umap: ClusterEngineUmapParams;
      hdbscan: ClusterEngineHdbscanParams;
    }): Promise<ClusterEngineResult> {
      const url = new URL('/v1/cluster/topic', baseUrl).toString();

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          topicId: opts.topicId,
          computedAt: opts.computedAt.toISOString(),
          umap: {
            nNeighbors: opts.umap.nNeighbors,
            minDist: opts.umap.minDist,
            randomState: opts.umap.randomState,
            metric: opts.umap.metric,
          },
          hdbscan: {
            minClusterSize: opts.hdbscan.minClusterSize,
            minSamples: opts.hdbscan.minSamples,
            clusterSelectionMethod: opts.hdbscan.clusterSelectionMethod,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI worker cluster failed status=${res.status} body=${text}`);
      }

      const json = (await res.json()) as {
        points?: Array<{ argumentId: string; x: number; y: number; clusterId: number }>;
      };

      if (!json.points || !Array.isArray(json.points)) {
        throw new Error('AI worker cluster response missing points');
      }

      return { points: json.points };
    },
  };
}

