/**
 * Google Drive 백업 기능을 켜고 빌드했는지. vite.config.ts가 .env.local의
 * ENABLE_DRIVE_BACKUP=true 와 GOOGLE_OAUTH_CLIENT_ID 가 모두 있을 때만 true로 넣는다.
 */
declare const __DRIVE_BACKUP__: boolean;
