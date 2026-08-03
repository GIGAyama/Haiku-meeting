/**
 * GAS に置く app.html / css.html / vendor.html を作る。
 *
 * なぜ必要か：
 *   もとは画面をこう作っていた。
 *
 *     cdn.tailwindcss.com          … ブラウザの中で CSS を組み立てる版
 *     unpkg の react / react-dom   … 本体
 *     unpkg の @babel/standalone   … **ブラウザの中で JSX を毎回コンパイルする**
 *     jsdelivr の canvas-confetti
 *
 *   問題は2つ。
 *
 *   1. 学校のフィルタリングでこれらのドメインが塞がれていると、
 *      **画面がまったく出ない。** 白い画面のまま何も起きない。
 *      児童からは「壊れている」としか見えず、原因も分からない。
 *   2. Babel standalone は 3MB 近くあり、しかも開くたびに JSX を
 *      コンパイルし直す。40人が同時に開く校内 Wi-Fi では、この時間が
 *      そのまま待ち時間になる。
 *
 *   どちらも「先に作っておく」ことで消える。JSX はここでコンパイルし、
 *   Tailwind は使っているクラスだけの CSS にし、React は GAS 側に置く。
 *
 * 作られるもの（いずれも生成物。手で編集しない）：
 *   vendor.html … react / react-dom / canvas-confetti
 *   css.html    … Tailwind が生成した CSS と、もとから書いてあった追加のスタイル
 *   app.html    … src/app.jsx をコンパイルした JavaScript
 *
 *   npm ci && npm run build
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(p, 'utf8');

/* ------------------------------------------------------------------ vendor */
// UMD 版をそのまま連結する。GAS は .html しか配れないので <script> で包む。
// require.resolve は使わない。react の package.json は exports で umd/ を
// 公開していないため ERR_PACKAGE_PATH_NOT_EXPORTED になる。パスで指定する。
const vendorFiles = [
    ['react', 'node_modules/react/umd/react.production.min.js'],
    ['react-dom', 'node_modules/react-dom/umd/react-dom.production.min.js'],
    ['canvas-confetti', 'node_modules/canvas-confetti/dist/confetti.browser.js'],
].map(([name, rel]) => [name, join(ROOT, rel)]);

let vendor = `<!-- 自動生成。tools/build.mjs が作る。手で編集しない。 -->\n`;
for (const [name, file] of vendorFiles) {
    if (!existsSync(file)) {
        console.error(`[build] 見つからない: ${name} (${file})`);
        process.exit(1);
    }
    const version = JSON.parse(read(join(ROOT, 'node_modules', name, 'package.json'))).version;
    vendor += `<!-- ${name} ${version} -->\n<script>\n${read(file)}\n</script>\n`;
}
writeFileSync(join(ROOT, 'vendor.html'), vendor);
console.log(`vendor.html  ${(Buffer.byteLength(vendor) / 1024).toFixed(1)} KB`);

/* --------------------------------------------------------------------- css */
// Tailwind CLI に index.html と src/app.jsx を読ませ、使っているクラスだけ出す。
const twInput = join(ROOT, 'tools', 'tailwind-input.css');
const twOutput = join(ROOT, 'tools', 'tailwind-output.css');
execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules/tailwindcss/lib/cli.js'), '-c', join(ROOT, 'tailwind.config.js'),
        '-i', twInput, '-o', twOutput, '--minify'],
    { cwd: ROOT, stdio: 'pipe' }
);
const extra = read(join(ROOT, 'tools', 'extra.css'));
const css = `<!-- 自動生成。tools/build.mjs が作る。手で編集しない。 -->\n<style>\n${read(twOutput)}\n${extra}\n</style>\n`;
writeFileSync(join(ROOT, 'css.html'), css);
console.log(`css.html     ${(Buffer.byteLength(css) / 1024).toFixed(1)} KB`);

/* --------------------------------------------------------------------- app */
// JSX をここでコンパイルする。ブラウザに Babel を送らないための本体部分。
const jsx = read(join(ROOT, 'src', 'app.jsx'));
const { code } = transformSync(jsx, {
    filename: 'app.jsx',
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    compact: false,
    comments: true,
});
const app = `<!-- 自動生成。中身は src/app.jsx。tools/build.mjs が作る。手で編集しない。 -->\n<script>\n${code}\n</script>\n`;
writeFileSync(join(ROOT, 'app.html'), app);
console.log(`app.html     ${(Buffer.byteLength(app) / 1024).toFixed(1)} KB`);

console.log('\n✅ CDN への依存は無くなった。学校のフィルタリングでも画面が出る。');
