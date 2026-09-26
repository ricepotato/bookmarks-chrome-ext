import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import baseManifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  // Google Drive 백업용 OAuth 클라이언트 ID는 저장소에 올리지 않도록 .env.local에서 읽는다.
  // 설정하지 않으면 oauth2 항목 없이 빌드되고, 관리 페이지에서 Drive 백업이 비활성화된다.
  const env = loadEnv(mode, process.cwd(), "");
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const manifest = clientId
    ? {
        ...baseManifest,
        oauth2: {
          client_id: clientId,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
        },
      }
    : baseManifest;

  return {
    plugins: [react(), crx({ manifest })],
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
