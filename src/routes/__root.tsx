import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Wobble";
const isPagesBuild = import.meta.env.MODE === "pages";
const baseUrl = import.meta.env.BASE_URL;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: "Paint part of a photo and make it jiggle with soft-body physics." },
      { name: "theme-color", content: "#0c0e12" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: `${baseUrl}favicon.svg` },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" },
      ...(isPagesBuild
        ? [
            { rel: "manifest", href: `${baseUrl}manifest.webmanifest` },
            { rel: "apple-touch-icon", href: `${baseUrl}__grok/icon-180.png` },
          ]
        : [
            { rel: "manifest", href: "/__grok/manifest.webmanifest" },
            { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
          ]),
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
