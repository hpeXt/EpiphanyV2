import { ImageResponse } from "next/og";

export const runtime = "edge";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getApiBaseUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

function truncate(text: string, max = 220): string {
  const normalized = text.trim().replaceAll(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function safeHexPrefix(id: string, size = 8): string {
  const normalized = id.trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, size);
}

async function safeFetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

type BridgeStatement = { id: string; text: string; conditions: string[]; sourceLabels: string[] };

function extractBridge(report: unknown, bridgeId: string | null): BridgeStatement | null {
  const reportObj = asRecord(report);
  const metadata = asRecord(reportObj?.metadata);
  const bridges = asRecord(metadata?.bridges);
  const statementsRaw = bridges?.statements;
  if (!Array.isArray(statementsRaw)) return null;

  const parsed: BridgeStatement[] = [];
  for (const item of statementsRaw) {
    const statement = asRecord(item);
    const id = statement?.id;
    const text = statement?.text;
    const conditionsRaw = statement?.conditions;
    const sourceLabelsRaw = statement?.sourceLabels;
    if (typeof id !== "string" || !/^B\d+$/.test(id)) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    const conditions = Array.isArray(conditionsRaw)
      ? conditionsRaw.filter((c) => typeof c === "string" && c.trim())
      : [];
    const sourceLabels = Array.isArray(sourceLabelsRaw)
      ? sourceLabelsRaw.filter((s) => typeof s === "string" && /^S\d+$/.test(s))
      : [];
    parsed.push({ id, text: text.trim(), conditions, sourceLabels });
  }

  if (!parsed.length) return null;

  if (bridgeId && /^B\d+$/.test(bridgeId)) {
    return parsed.find((b) => b.id === bridgeId) ?? null;
  }

  const share = asRecord(metadata?.share);
  const featuredRaw = share?.featuredBridgeIds;
  if (Array.isArray(featuredRaw)) {
    const first = featuredRaw.find((id) => typeof id === "string" && /^B\d+$/.test(id));
    if (first) {
      return parsed.find((b) => b.id === first) ?? parsed[0] ?? null;
    }
  }

  const galleryIdsRaw = bridges?.galleryIds;
  if (Array.isArray(galleryIdsRaw)) {
    const first = galleryIdsRaw.find((id) => typeof id === "string" && /^B\d+$/.test(id));
    if (first) {
      return parsed.find((b) => b.id === first) ?? parsed[0] ?? null;
    }
  }

  return parsed[0] ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get("topicId");
  const rid = searchParams.get("rid");
  const bridgeId = searchParams.get("bridge");

  const apiBase = getApiBaseUrl();

  const fallback = new ImageResponse(
    <div
      style={{
        width: "1200px",
        height: "630px",
        background: "#ffffff",
        color: "#0f172a",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "56px",
      }}
    >
      <div style={{ fontSize: 22, letterSpacing: 0.5, opacity: 0.7 }}>Epiphany · Consensus report</div>
      <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>Epiphany</div>
      <div style={{ fontSize: 26, opacity: 0.75 }}>Open the report to view Bridge Statements and sources.</div>
      <div style={{ fontSize: 18, opacity: 0.55 }}>report</div>
    </div>,
    { width: 1200, height: 630 },
  );

  if (!apiBase || !topicId) return fallback;

  const [topicTree, reportResponse] = await Promise.all([
    safeFetchJson(`${apiBase}/v1/topics/${encodeURIComponent(topicId)}/tree?depth=1`),
    rid
      ? safeFetchJson(
          `${apiBase}/v1/topics/${encodeURIComponent(topicId)}/consensus-report/${encodeURIComponent(rid)}`,
        )
      : safeFetchJson(`${apiBase}/v1/topics/${encodeURIComponent(topicId)}/consensus-report/latest`),
  ]);

  const topicTreeObj = asRecord(topicTree);
  const topicObj = asRecord(topicTreeObj?.topic);
  const topicTitleRaw = topicObj?.title;
  const topicTitle = typeof topicTitleRaw === "string" && topicTitleRaw.trim() ? topicTitleRaw : "Topic";

  const reportPayload = asRecord(reportResponse);
  const report = reportPayload?.report ?? null;
  const reportObj = asRecord(report);
  const reportStatus = typeof reportObj?.status === "string" ? reportObj.status : null;

  const bridge = reportObj ? extractBridge(reportObj, bridgeId) : null;
  const reportId = typeof reportObj?.id === "string" ? reportObj.id : rid ?? null;

  if (!reportObj || reportStatus !== "ready" || !bridge) {
    const status = reportStatus ?? (reportObj ? "unknown" : "no report");

    return new ImageResponse(
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#ffffff",
          color: "#0f172a",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px",
          border: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 22, opacity: 0.7 }}>Epiphany · Consensus report</div>
          <div style={{ fontSize: 18, opacity: 0.5 }}>{status}</div>
        </div>

        <div style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.1 }}>{truncate(topicTitle, 64)}</div>

        <div style={{ fontSize: 26, opacity: 0.75 }}>
          Open the report to view Bridge Statements and sources.
        </div>

        <div style={{ fontSize: 18, opacity: 0.55 }}>
          {reportId ? `rid=${safeHexPrefix(reportId)}` : "report"}
        </div>
      </div>,
      { width: 1200, height: 630 },
    );
  }

  const sourceBadges = bridge.sourceLabels.slice(0, 6);
  const hasMoreSources = bridge.sourceLabels.length > sourceBadges.length;

  return new ImageResponse(
    <div
      style={{
        width: "1200px",
        height: "630px",
        background: "#ffffff",
        color: "#0f172a",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "56px",
        border: "1px solid #e2e8f0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 22, opacity: 0.7 }}>Epiphany · Bridge statement</div>
        <div style={{ fontSize: 18, opacity: 0.55 }}>{reportId ? `rid=${safeHexPrefix(reportId)}` : ""}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ fontSize: 18, opacity: 0.7 }}>Topic</div>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.12 }}>{truncate(topicTitle, 72)}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <div
            style={{
              fontSize: 16,
              padding: "6px 10px",
              border: "1px solid #cbd5e1",
              borderRadius: 999,
              opacity: 0.9,
            }}
          >
            {bridge.id}
          </div>
          <div style={{ fontSize: 16, opacity: 0.6 }}>Bridge Statement</div>
        </div>

        <div style={{ fontSize: 32, lineHeight: 1.25 }}>{truncate(bridge.text, 260)}</div>

        {bridge.conditions.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <div style={{ fontSize: 16, opacity: 0.65 }}>Conditions</div>
            <div style={{ fontSize: 18, opacity: 0.85 }}>
              {truncate(bridge.conditions.slice(0, 2).join(" / "), 120)}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sourceBadges.map((label) => (
            <div
              key={label}
              style={{
                fontSize: 14,
                padding: "6px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                color: "#334155",
                background: "#f8fafc",
              }}
            >
              [{label}]
            </div>
          ))}
          {hasMoreSources ? (
            <div style={{ fontSize: 14, padding: "6px 0", color: "#64748b" }}>+{bridge.sourceLabels.length - sourceBadges.length}</div>
          ) : null}
        </div>
        <div style={{ fontSize: 16, opacity: 0.6 }}>Hosted by Epiphany</div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
