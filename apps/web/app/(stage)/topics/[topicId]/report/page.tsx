import { ConsensusReportPage } from "@/components/topics/ConsensusReportPage";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

type Params = { topicId: string };

function getApiBaseUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

type TopicVisibility = "public" | "unlisted" | "private";

async function safeFetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function truncate(text: string, max = 180): string {
  const normalized = text.trim().replaceAll(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function getShareMeta(report: any): { ogTitle?: string; ogDescription?: string } | null {
  const share = report?.metadata?.share;
  if (!share || typeof share !== "object" || Array.isArray(share)) return null;
  const ogTitle = typeof (share as any).ogTitle === "string" ? String((share as any).ogTitle) : undefined;
  const ogDescription =
    typeof (share as any).ogDescription === "string" ? String((share as any).ogDescription) : undefined;
  return ogTitle || ogDescription ? { ogTitle, ogDescription } : null;
}

function getBridgeMeta(report: any, bridgeId: string | null): null | { id: string; text: string; conditions: string[] } {
  if (!bridgeId || typeof bridgeId !== "string" || !/^B\d+$/.test(bridgeId)) return null;
  const bridges = report?.metadata?.bridges;
  if (!bridges || typeof bridges !== "object" || Array.isArray(bridges)) return null;
  const statements = (bridges as any).statements;
  if (!Array.isArray(statements)) return null;

  for (const item of statements) {
    const id = (item as any)?.id;
    const text = (item as any)?.text;
    const conditionsRaw = (item as any)?.conditions;
    if (id !== bridgeId) continue;
    if (typeof text !== "string" || !text.trim()) return null;
    const conditions = Array.isArray(conditionsRaw) ? conditionsRaw.filter((c) => typeof c === "string" && c.trim()) : [];
    return { id, text: text.trim(), conditions };
  }
  return null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params | Promise<Params>;
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { topicId } = await params;
  const sp = await searchParams;
  const rid = typeof sp.rid === "string" ? sp.rid : null;
  const bridge = typeof sp.bridge === "string" ? sp.bridge : null;

  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    return { title: BRAND.name, description: BRAND.description };
  }

  const [topicTree, reportResponse] = await Promise.all([
    safeFetchJson(`${apiBase}/v1/topics/${encodeURIComponent(topicId)}/tree?depth=1`),
    rid
      ? safeFetchJson(
          `${apiBase}/v1/topics/${encodeURIComponent(topicId)}/consensus-report/${encodeURIComponent(rid)}`,
        )
      : safeFetchJson(`${apiBase}/v1/topics/${encodeURIComponent(topicId)}/consensus-report/latest`),
  ]);

  const topicTitle =
    typeof (topicTree as any)?.topic?.title === "string" ? String((topicTree as any).topic.title) : null;
  const visibility = (topicTree as any)?.topic?.visibility as TopicVisibility | undefined;

  const report = (reportResponse as any)?.report ?? null;
  const share = report ? getShareMeta(report) : null;
  const bridgeMeta = report ? getBridgeMeta(report, bridge) : null;

  const title = bridgeMeta
    ? `${bridgeMeta.id} · ${topicTitle ?? "Bridge"}`
    : share?.ogTitle ?? (topicTitle ? `${topicTitle} · 共识报告` : "共识报告");

  const description = bridgeMeta
    ? truncate(
        bridgeMeta.conditions.length
          ? `${bridgeMeta.text}（条件：${bridgeMeta.conditions.join(" / ")}）`
          : bridgeMeta.text,
        200,
      )
    : share?.ogDescription ?? BRAND.description;

  const robots =
    visibility === "unlisted" || visibility === "private"
      ? { index: false, follow: false }
      : undefined;

  const ogImage = `/api/og/report?topicId=${encodeURIComponent(topicId)}${
    rid ? `&rid=${encodeURIComponent(rid)}` : ""
  }${bridgeMeta ? `&bridge=${encodeURIComponent(bridgeMeta.id)}` : ""}`;

  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: {
      title,
      description,
      type: "article",
      siteName: BRAND.name,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    alternates: {
      canonical: `/topics/${encodeURIComponent(topicId)}/report${rid ? `?rid=${encodeURIComponent(rid)}` : ""}`,
    },
    other: {
      "x-epiphany-topic": topicId,
      ...(rid ? { "x-epiphany-report": rid } : {}),
    },
  };
}

export default async function TopicConsensusReportPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { topicId } = await params;
  return <ConsensusReportPage topicId={topicId} />;
}
