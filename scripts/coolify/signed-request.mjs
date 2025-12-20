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

function sha256Hex(rawString) {
  return crypto.createHash("sha256").update(rawString, "utf8").digest("hex");
}

function createNonce() {
  // base64url: won't contain '|'
  return crypto.randomBytes(16).toString("base64url");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const extraHeaders = [];
  let baseUrl = process.env.API_BASE_URL ?? "";
  let keyFile = "tmp/coolify-test-ed25519.jwk.json";
  let newKey = false;
  let nonce = null;
  let timestamp = null;

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
    if (arg === "--new-key") {
      newKey = true;
      continue;
    }
    if (arg === "--nonce") {
      nonce = args[++i] ?? "";
      continue;
    }
    if (arg === "--timestamp") {
      const value = args[++i] ?? "";
      timestamp = Number(value);
      continue;
    }
    if (arg === "--extra-header") {
      const header = args[++i] ?? "";
      extraHeaders.push(header);
      continue;
    }
    positional.push(arg);
  }

  return { positional, baseUrl, keyFile, newKey, nonce, timestamp, extraHeaders };
}

function ensureDir(filePath) {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadOrCreateKeypair(keyFile, newKey) {
  if (!newKey && fs.existsSync(keyFile)) {
    const json = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    const publicKey = crypto.createPublicKey({ key: json.publicJwk, format: "jwk" });
    const privateKey = crypto.createPrivateKey({ key: json.privateJwk, format: "jwk" });
    return { publicKey, privateKey, persisted: true };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });

  ensureDir(keyFile);
  fs.writeFileSync(
    keyFile,
    JSON.stringify({ publicJwk, privateJwk }, null, 2),
    "utf8",
  );

  return { publicKey, privateKey, persisted: false };
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  node scripts/coolify/signed-request.mjs <METHOD> <PATH> [BODY_JSON_STRING] [--base-url <url>] [--key-file <path>] [--new-key] [--extra-header \"K: V\"]",
      "",
      "Notes:",
      "  - PATH must NOT include query string (canonical message uses PATH only).",
      "  - If BODY_JSON_STRING is omitted, BODY_HASH is \"\" and canonical message ends with '|'.",
      "  - Default base URL comes from API_BASE_URL env var.",
      "",
      "Examples:",
      "  export API_BASE_URL=\"https://api.example.com\"",
      "  node scripts/coolify/signed-request.mjs GET /v1/topics/xxx/ledger/me",
      "  node scripts/coolify/signed-request.mjs POST /v1/topics/xxx/commands '{\"type\":\"CLAIM_OWNER\",\"payload\":{}}' --extra-header \"X-Claim-Token: ...\"",
    ].join("\n"),
  );
}

function buildCanonicalMessage({ method, path, timestamp, nonce, bodyString }) {
  const bodyHash = bodyString === undefined ? "" : sha256Hex(bodyString);
  return ["v1", method, path, String(timestamp), nonce, bodyHash].join("|");
}

async function main() {
  const { positional, baseUrl, keyFile, newKey, nonce, timestamp, extraHeaders } =
    parseArgs(process.argv);

  const [methodRaw, pathRaw, bodyString] = positional;
  if (!methodRaw || !pathRaw) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (!baseUrl) {
    throw new Error("Missing base URL. Provide --base-url or set API_BASE_URL.");
  }

  const method = methodRaw.toUpperCase();
  const requestPath = pathRaw.includes("?") ? pathRaw.split("?")[0] : pathRaw;
  if (requestPath !== pathRaw) {
    throw new Error("PATH must not include query string for signing. Provide only '/v1/...'.");
  }
  if (!requestPath.startsWith("/")) {
    throw new Error("PATH must start with '/'.");
  }

  const { publicKey, privateKey, persisted } = loadOrCreateKeypair(keyFile, newKey);
  const publicJwk = publicKey.export({ format: "jwk" });

  const pubkeyBytes = base64UrlToBuffer(publicJwk.x);
  const pubkeyHex = bufferToHexLower(pubkeyBytes);

  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  const requestNonce = nonce ?? createNonce();
  if (requestNonce.includes("|")) {
    throw new Error("X-Nonce must not include '|'.");
  }

  const canonical = buildCanonicalMessage({
    method,
    path: requestPath,
    timestamp: ts,
    nonce: requestNonce,
    bodyString,
  });

  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const signatureHex = bufferToHexLower(signature);

  const headers = new Headers();
  headers.set("X-Pubkey", pubkeyHex);
  headers.set("X-Signature", signatureHex);
  headers.set("X-Timestamp", String(ts));
  headers.set("X-Nonce", requestNonce);
  if (bodyString !== undefined) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Accept", "application/json");

  for (const header of extraHeaders) {
    const index = header.indexOf(":");
    if (index === -1) throw new Error(`Invalid --extra-header value: ${header}`);
    const key = header.slice(0, index).trim();
    const value = header.slice(index + 1).trim();
    headers.set(key, value);
  }

  const url = new URL(requestPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        baseUrl,
        url: url.toString(),
        method,
        keyFile,
        keyPersisted: persisted,
        pubkey: pubkeyHex,
        timestamp: ts,
        nonce: requestNonce,
        canonical,
      },
      null,
      2,
    ),
  );

  const response = await fetch(url, { method, headers, body: bodyString });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        status: response.status,
        contentType,
        body: text,
      },
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

