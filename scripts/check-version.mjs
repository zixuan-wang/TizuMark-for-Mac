// P2-1（2026-08-01 审查修复）：版本号一致性校验。
// 以 package.json 的 version 为基准，校验其余发布相关版本号是否同步，
// 防止改版本时漏改导致显示/文档版本不一致。
// 接入 npm run check（npm run check 聚合脚本链）。
// macOS 纯化（2026-10-30）：update json 与 release-notes.js 校验随 Windows 发布链删除而移除。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const fail = [];

function checkVersion(file, pattern, { count = 1 } = {}) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) {
    fail.push(`${file}: 文件不存在`);
    return;
  }
  const content = fs.readFileSync(p, 'utf8');
  // matchAll 要求 global 标志，缺省补 g
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const matches = [...content.matchAll(re)];
  if (matches.length !== count) {
    fail.push(`${file}: 期望 ${count} 处版本号，实际 ${matches.length} 处`);
    return;
  }
  for (const m of matches) {
    if (m[1] !== VERSION) fail.push(`${file}: 版本 ${m[1]} ≠ 基准 ${VERSION}`);
  }
}

checkVersion('src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m, { label: 'Cargo.toml' });
checkVersion('src-tauri/tauri.conf.json', /"version"\s*:\s*"([^"]+)"/, { label: 'tauri.conf.json' });
// versionInfo 文案随 i18n 字典搬到 src/modules/i18n-data.js（zh/en/es 各一处）
checkVersion('src/modules/i18n-data.js', /versionInfo:\s*'TizuMark v([^']+)'/, { count: 3, label: 'i18n-data.js versionInfo(zh/en/es)' });
checkVersion('src/index.html', /id="about-version"[^>]*>TizuMark v([^<]+)</, { label: 'index.html about-version' });
checkVersion('README.md', /Version-([0-9.]+)-blue/, { label: 'README.md badge' });
checkVersion('README.en.md', /Version-([0-9.]+)-blue/, { label: 'README.en.md badge' });
checkVersion('README.es.md', /Version-([0-9.]+)-blue/, { label: 'README.es.md badge' });

if (fail.length > 0) {
  console.error(`✗ 版本号一致性检查失败（基准 package.json version=${VERSION}）：`);
  for (const f of fail) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ 版本号一致：v${VERSION}（7 处检查通过）`);
