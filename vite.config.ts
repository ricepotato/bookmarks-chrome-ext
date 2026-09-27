import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import baseManifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  // Google Drive 백업은 현재 보류된 기능이라 기본으로 빠진 채 빌드된다 (README 참고).
  // .env.local에 ENABLE_DRIVE_BACKUP=true 와 OAuth 클라이언트 ID를 모두 넣었을 때만
  // identity 권한과 oauth2 항목을 manifest에 넣고, 코드에서도 기능을 켠다.
  // 클라이언트 ID는 저장소에 올리지 않도록 .env.local에서 읽는다.
  const env = loadEnv(mode, process.cwd(), "");
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const driveBackup = env.ENABLE_DRIVE_BACKUP === "true" && !!clientId;
  const manifest = driveBackup
    ? {
        ...baseManifest,
        permissions: [...baseManifest.permissions, "identity"],
        oauth2: {
          client_id: clientId,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
        },
      }
    : baseManifest;

  return {
    plugins: [react(), crx({ manifest })],
    define: {
      __DRIVE_BACKUP__: JSON.stringify(driveBackup),
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
