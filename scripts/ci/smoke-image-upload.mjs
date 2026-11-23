import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const payload = Buffer.concat([name, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

function makePng(width = 64, height = 48) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      scanlines[pixel] = Math.round((x / Math.max(1, width - 1)) * 255);
      scanlines[pixel + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      scanlines[pixel + 2] = 180;
      scanlines[pixel + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const rawBasePath = process.env.WOBBLE_BASE_PATH ?? "/";
const normalizedBasePath = rawBasePath.replace(/^\/+|\/+$/g, "");
const basePath = normalizedBasePath ? `/${normalizedBasePath}/` : "/";
const origin = `http://127.0.0.1:8081${basePath}`;
const mode = process.env.WOBBLE_PREVIEW_MODE;
const modeArgs = mode ? ["--mode", mode] : [];
const server = spawn(
  process.execPath,
  [
    "scripts/with-app-env.mjs",
    "vite",
    "preview",
    ...modeArgs,
    "--host",
    "127.0.0.1",
    "--port",
    "8081",
    "--strictPort",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${process.cwd()}/node_modules/.bin:${process.env.PATH ?? ""}`,
    },
  },
);

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The preview server is still starting.
    }
    await delay(500);
  }
  if (!ready) throw new Error(`The production preview did not become ready at ${origin}`);

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(origin, { waitUntil: "networkidle" });

  if (mode === "pages") {
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
    if (manifestUrl !== `${basePath}manifest.webmanifest`) {
      throw new Error(`Unexpected manifest URL: ${manifestUrl}`);
    }
    const manifestResponse = await page.request.get(new URL(manifestUrl, origin).href);
    if (!manifestResponse.ok()) throw new Error(`Manifest request failed: ${manifestResponse.status()}`);
    const manifest = await manifestResponse.json();
    if (manifest.start_url !== "./" || manifest.scope !== "./") {
      throw new Error(`Manifest is not project-path safe: ${JSON.stringify(manifest)}`);
    }
    console.log("PASS: GitHub Pages base path and static web manifest resolved.");
  }

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "android-photo.bin",
    mimeType: "application/octet-stream",
    buffer: makePng(),
  });

  await page.getByText("Paint a region, then switch to Play", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  });

  const debug = await page.waitForFunction(() => {
    const state = window.__wobble?.debug?.();
    return state && state.workW > 0 && state.workH > 0 ? state : false;
  }, { timeout: 10000 }).then((handle) => handle.jsonValue());

  if (!debug || debug.workW !== 64 || debug.workH !== 48) {
    throw new Error(`Image dimensions were not loaded correctly: ${JSON.stringify(debug)}`);
  }
  // Verify the motion control is exposed in the mobile Physics sheet. Real
  // accelerometer permission and sensor delivery require a physical handset.
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByRole("button", { name: "Enable phone shake" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  for (const label of ["Invert mask", "Feather mask", "Expand mask", "Contract mask"]) {
    await page.getByRole("button", { name: label }).waitFor({ state: "visible" });
  }

  if (pageErrors.length) {
    throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
  }

  console.log("PASS: production page rendered.");
  console.log("PASS: phone motion control is visible in the mobile Physics panel.");
  console.log("PASS: mobile mask actions are visible.");

  console.log("PASS: PNG uploaded with application/octet-stream MIME type.");
  console.log(`PASS: image decoded at ${debug.workW}x${debug.workH}; WebGL failed: ${debug.glFailed}.`);
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
