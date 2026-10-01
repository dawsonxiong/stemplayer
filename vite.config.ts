import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  // Modal's webhook reaches the dev server through a Cloudflare quick tunnel
  // (scripts/dev.mjs), whose Host header Vite would otherwise reject.
  server: { allowedHosts: [".trycloudflare.com"] },
  plugins: [
    vinext(),
    // The RSC environment runs in workerd, so route handlers can import
    // bindings from "cloudflare:workers".
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
    tailwindcss(),
  ],
});
