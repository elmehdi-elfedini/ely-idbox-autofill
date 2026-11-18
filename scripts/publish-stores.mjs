import { readFile } from "node:fs/promises";

const [store, packagePath] = process.argv.slice(2);
if (!store || !packagePath || !["chrome", "edge"].includes(store)) {
  throw new Error("Usage: node scripts/publish-stores.mjs <chrome|edge> <package.zip>");
}

const packageBytes = await readFile(packagePath);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { response, body };
}

function requireEnv(names) {
  for (const name of names) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function publishChrome() {
  requireEnv(["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_PUBLISHER_ID", "CWS_EXTENSION_ID"]);
  const tokenResponse = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CWS_CLIENT_ID,
      client_secret: process.env.CWS_CLIENT_SECRET,
      refresh_token: process.env.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const accessToken = tokenResponse.body.access_token;
  if (!accessToken) throw new Error("Google OAuth did not return an access token.");

  const publisher = encodeURIComponent(process.env.CWS_PUBLISHER_ID);
  const item = encodeURIComponent(process.env.CWS_EXTENSION_ID);
  const name = `publishers/${publisher}/items/${item}`;
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const upload = await requestJson(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/zip" },
    body: packageBytes
  });

  let uploadState = upload.body.uploadState;
  for (let attempt = 0; uploadState === "IN_PROGRESS" && attempt < 30; attempt++) {
    await sleep(10_000);
    const status = await requestJson(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`, {
      headers: authHeaders
    });
    uploadState = status.body.lastAsyncUploadState;
  }
  if (uploadState !== "SUCCEEDED") {
    throw new Error(`Chrome Web Store upload ended in state ${uploadState || "unknown"}.`);
  }

  const published = await requestJson(`https://chromewebstore.googleapis.com/v2/${name}:publish`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  console.log(`Chrome Web Store submission created; state: ${published.body.state || "submitted for review"}.`);
}

function operationIdFrom(response) {
  const location = response.headers.get("location");
  if (!location) throw new Error("Store API response did not include an operation Location header.");
  return decodeURIComponent(new URL(location, "https://api.addons.microsoftedge.microsoft.com").pathname.split("/").filter(Boolean).at(-1));
}

async function waitForEdgeOperation(url, headers) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { body } = await requestJson(url, { headers });
    const status = String(body.status || "").toLowerCase();
    if (status === "succeeded") return body;
    if (status === "failed") throw new Error(`Edge Add-ons operation failed: ${JSON.stringify(body)}`);
    await sleep(10_000);
  }
  throw new Error("Timed out waiting for Microsoft Edge Add-ons processing.");
}

async function publishEdge() {
  requireEnv(["EDGE_API_KEY", "EDGE_CLIENT_ID", "EDGE_PRODUCT_ID"]);
  const root = "https://api.addons.microsoftedge.microsoft.com/v1";
  const product = encodeURIComponent(process.env.EDGE_PRODUCT_ID);
  const headers = {
    Authorization: `ApiKey ${process.env.EDGE_API_KEY}`,
    "X-ClientID": process.env.EDGE_CLIENT_ID
  };

  const uploaded = await fetch(`${root}/products/${product}/submissions/draft/package`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: packageBytes
  });
  if (uploaded.status !== 202) {
    const body = await uploaded.text();
    throw new Error(`Edge package upload failed (${uploaded.status}): ${body}`);
  }
  const uploadId = operationIdFrom(uploaded);
  await waitForEdgeOperation(
    `${root}/products/${product}/submissions/draft/package/operations/${encodeURIComponent(uploadId)}`,
    headers
  );

  const releaseTag = process.env.GITHUB_REF_NAME || "GitHub release";
  const submitted = await fetch(`${root}/products/${product}/submissions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ notes: `Automated release ${releaseTag}` })
  });
  if (submitted.status !== 202) {
    const body = await submitted.text();
    throw new Error(`Edge submission failed (${submitted.status}): ${body}`);
  }
  const publishId = operationIdFrom(submitted);
  const result = await waitForEdgeOperation(
    `${root}/products/${product}/submissions/operations/${encodeURIComponent(publishId)}`,
    headers
  );
  console.log(`Microsoft Edge Add-ons submission completed: ${result.status}.`);
}

if (store === "chrome") await publishChrome();
else await publishEdge();
