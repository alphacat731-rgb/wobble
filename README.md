# Wobble

Wobble is an interactive image editor. Upload a photo, paint the parts you want to move, then pull, tap, or shake them with spring-based soft-body physics.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local address printed by Vite (normally http://localhost:8080).

## Deploy as a website

This project uses TanStack Start with Nitro's Vercel preset. It is not a plain static HTML export.

1. Open [Vercel New Project](https://vercel.com/new).
2. Import this GitHub repository: `alphacat731-rgb/wobble`.
3. Keep the project root directory set to `./`.
4. Let Vercel detect the Nitro framework and use the repository's `vercel.json` settings.
5. Deploy. Future pushes to `main` can then deploy automatically through the Vercel Git integration.

The `grok-workspace.zip` archive is retained as the original packaged backup. The application source is now also available directly in the repository root.
