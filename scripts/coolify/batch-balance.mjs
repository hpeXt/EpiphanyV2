import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function base64UrlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function bufferToHexLower(buffer) {
  return Buffer.from(buffer).toString("hex");
}

function createNonce() {
  return crypto.randomBytes(16).toString("base64url");
}

function loadKeypair(keyFile) {
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Missing key file: ${keyFile}. Create one by running scripts/coolify/signed-request.mjs once.`,
    );
  }
  const json = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const publicKey = crypto.createPublicKey({ key: json.publicJwk, format: "jwk" });
  const privateKey = crypto.createPrivateKey({ key: json.privateJwk, format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const pubkeyBytes = base64UrlToBuffer(publicJwk.x);
  const pubkeyHex = bufferToHexLower(pubkeyBytes);
  return { publicKey, privateKey, pubkeyHex };
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  node scripts/coolify/batch-balance.mjs <topicId1> [topicId2 ...] [--base-url <url>] [--key-file <path>]",
      "",
      "Notes:",
      "  - This hits POST /v1/user/batch-balance (item-level signature in body).",
      "  - Default base URL comes from API_BASE_URL env var.",
      "  - Default key file: tmp/coolify-test-ed25519.jwk.json",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const topicIds = [];
  let baseUrl = process.env.API_BASE_URL ?? "";
  let keyFile = "tmp/coolify-test-ed25519.jwk.json";
  let signWithMount = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--base-url") {
      baseUrl = args[++i] ?? "";
      continue;
    }
    if (arg === "--key-file") {
      keyFile = args[++i] ?? keyFile;
      continue;
    }
    if (arg === "--sign-with-mount") {
      signWithMount = true;
      continue;
    }
    topicIds.push(arg);
  }

  return { topicIds, baseUrl, keyFile, signWithMount };
}

function normalizePathname(value) {
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function joinMountAndPath(mountPath, rawPath) {
  const mount = mountPath === "/" ? "" : mountPath.replace(/\/$/, "");
  const p = normalizePathname(rawPath);
  if (!mount) return p;
  if (p === "/") return mount || "/";
  if (p.startsWith(`${mount}/`)) return p;
  return `${mount}${p}`;
}

function buildCanonicalMessage({ topicId, timestamp, nonce, signPathPrefix }) {
  const path = joinMountAndPath(signPathPrefix, `/v1/topics/${topicId}/ledger/me`);
  // Empty body => BODY_HASH is "", canonical ends with '|'
  return ["v1", "GET", path, String(timestamp), nonce, ""].join("|");
}

async function main() {
  const { topicIds, baseUrl, keyFile, signWithMount } = parseArgs(process.argv);
  if (topicIds.length === 0) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (!baseUrl) {
    throw new Error("Missing base URL. Provide --base-url or set API_BASE_URL.");
  }

  const base = new URL(baseUrl);
  const mountPath = base.pathname;
  const signPathPrefix = signWithMount ? mountPath : "/";

  const { privateKey, pubkeyHex } = loadKeypair(keyFile);

  const items = topicIds.map((topicId) => {
    const timestamp = Date.now();
    const nonce = createNonce();
    const canonical = buildCanonicalMessage({ topicId, timestamp, nonce, signPathPrefix });
    const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
    const signatureHex = bufferToHexLower(signature);
    return { topicId, pubkey: pubkeyHex, timestamp, nonce, signature: signatureHex };
  });

  const requestPath = joinMountAndPath(mountPath, "/v1/user/batch-balance");
  const url = new URL(requestPath, base.origin);
  const body = JSON.stringify({ items });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        baseUrl,
        mountPath,
        signWithMount,
        url: url.toString(),
        keyFile,
        pubkey: pubkeyHex,
        items,
      },
      null,
      2,
    ),
  );

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body,
  });
  const text = await response.text();

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { status: response.status, contentType: response.headers.get("content-type") ?? "", body: text },
      null,
      2,
    ),
  );

  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
});
