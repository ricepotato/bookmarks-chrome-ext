import { zipSync } from "fflate";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outFile = join(root, `bookmarkshot-${version}.zip`);

function collectFiles(dir) {
  const files = {};
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      Object.assign(files, collectFiles(full));
    } else {
      // zip 안 경로는 항상 슬래시(/)를 쓴다.
      const zipPath = relative(distDir, full).split(sep).join("/");
      files[zipPath] = readFileSync(full);
    }
  }
  return files;
}

try {
  statSync(distDir);
} catch {
  console.error('dist 폴더가 없습니다. 먼저 "npm run build"를 실행하세요.');
  process.exit(1);
}

const zipped = zipSync(collectFiles(distDir), { level: 9 });
writeFileSync(outFile, zipped);
console.log(`압축 완료: ${outFile}`);
