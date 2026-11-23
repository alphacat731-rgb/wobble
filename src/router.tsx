import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { previewPathRewrite } from "@/lib/preview-path-prefix";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // The Pages build is served below /wobble/, while local and Vercel builds
    // keep the root URL. Vite's BASE_URL matches the configured build base.
    basepath: import.meta.env.BASE_URL,
    rewrite: previewPathRewrite(),
    defaultErrorComponent: AppErrorComponent,
  });
}
