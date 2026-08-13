import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig(async ({ command, mode }) => {
  const plugins = [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    viteReact(),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    const env = loadEnv(mode, process.cwd(), "");
    const supabaseHost = new URL(env.VITE_SUPABASE_URL).host;
    const livekitHost = new URL(env.VITE_LIVEKIT_URL.replace("wss://", "https://")).host;

    // Built from the same VITE_SUPABASE_URL / VITE_LIVEKIT_URL the app itself
    // uses, so the allow-list can't silently drift from the real endpoints.
    // api.dicebear.com is the fallback avatar for any profile without an
    // avatar_url (src/lib/format.ts); i.pravatar.cc backs the decorative
    // avatars on the login page (src/routes/login.tsx).
    // unsafe-inline is required in script-src and style-src: TanStack
    // Start's SSR hydration/streaming bootstrap injects a per-request inline
    // <script> (embeds live server timestamps, so it can't be pinned to a
    // static hash), and several components set React `style={{...}}` for
    // per-user dynamic values (wallpaper, banner/accent colors).
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `img-src 'self' data: blob: https://${supabaseHost} https://api.dicebear.com https://i.pravatar.cc`,
      "font-src 'self' https://fonts.gstatic.com",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://${livekitHost} wss://${livekitHost}`,
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    plugins.push(
      nitro({
        defaultPreset: "cloudflare-module",
        routeRules: {
          "/**": {
            headers: {
              "content-security-policy": csp,
              "x-content-type-options": "nosniff",
              "x-frame-options": "DENY",
              "referrer-policy": "strict-origin-when-cross-origin",
              "permissions-policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()",
              "strict-transport-security": "max-age=31536000; includeSubDomains",
            },
          },
        },
      }),
    );
  }

  return {
    server: { port: 8080 },
    resolve: { tsconfigPaths: true },
    plugins,
  };
});
