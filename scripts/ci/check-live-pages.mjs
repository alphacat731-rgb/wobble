const base = process.env.WOBBLE_PAGES_URL;
if (!base) throw new Error("WOBBLE_PAGES_URL is required");

const pageUrl = new URL(base);
const expectedPath = pageUrl.pathname.endsWith("/") ? pageUrl.pathname : `${pageUrl.pathname}/`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let response;
let html = "";
for (let attempt = 0; attempt < 18; attempt++) {
  try {
    response = await fetch(pageUrl, { redirect: "follow", cache: "no-store" });
    if (response.ok) {
      html = await response.text();
      break;
    }
  } catch {
    // Pages may still be propagating to the public edge.
  }
  await sleep(5000);
}

if (!response?.ok) {
  throw new Error(`Public Pages URL did not return HTTP 200: ${response?.status ?? "network error"}`);
}
if (!html.includes("<title>Wobble</title>")) {
  throw new Error("The public page did not contain the Wobble title; it may still be serving the old branch-based site.");
}

const references = [...html.matchAll(/(?:src|href)=(["'])([^"']+)\1/g)]
  .map((match) => match[2])
  .filter((value) => /\.(?:js|css)(?:[?#]|$)/i.test(value));

const jsAssets = references.filter((value) => /\.js(?:[?#]|$)/i.test(value));
const cssAssets = references.filter((value) => /\.css(?:[?#]|$)/i.test(value));
if (jsAssets.length === 0 || cssAssets.length === 0) {
  throw new Error(`Expected JS and CSS bundles in the public HTML; found JS=${jsAssets.length}, CSS=${cssAssets.length}`);
}

for (const reference of [...new Set([...jsAssets, ...cssAssets])]) {
  const assetUrl = new URL(reference, pageUrl);
  if (assetUrl.origin !== pageUrl.origin || !assetUrl.pathname.startsWith(expectedPath)) {
    throw new Error(`Asset escaped the GitHub Pages project path: ${assetUrl.href}`);
  }
  const assetResponse = await fetch(assetUrl, { redirect: "follow", cache: "no-store" });
  if (!assetResponse.ok) {
    throw new Error(`Asset returned HTTP ${assetResponse.status}: ${assetUrl.href}`);
  }
  console.log(`PASS: ${assetUrl.pathname} returned HTTP ${assetResponse.status}`);
}

console.log(`PASS: public Wobble page returned HTTP ${response.status}: ${response.url}`);
