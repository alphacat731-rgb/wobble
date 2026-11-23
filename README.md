# Wobble

Wobble is an interactive image editor. Upload a photo, paint the parts you want to move, then pull, tap, or shake them with spring-based soft-body physics.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local address printed by Vite (normally http://localhost:8080).

## Publish with GitHub Pages

Wobble has a static build specifically for GitHub Pages. The image editor, brush tools, WebGL physics, exports, and browser-side project storage run on the visitor's device, so the public editor does not need a Node.js server.

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`. The `Deploy Wobble to GitHub Pages` workflow builds and tests the site, then publishes it automatically.

The expected address is:

https://alphacat731-rgb.github.io/wobble/

To build the Pages version locally, run:

```bash
npm run build:pages
```

The Pages build uses the `/wobble/` base path and emits static files under `dist/client`. The workflow also runs a browser test that opens the site at that project path and uploads a PNG whose MIME type is intentionally generic.

### What is different on GitHub Pages?

GitHub Pages is static hosting. The editor remains fully client-side, and projects/presets are saved in that browser's local storage and IndexedDB. Server-only features such as OAuth sign-in, API endpoints, and dynamic server middleware are not part of the Pages build. The normal `npm run build` remains available for the existing Nitro/Vercel deployment.

The `grok-workspace.zip` archive is retained as the original packaged backup. The application source is also available directly in the repository root.
