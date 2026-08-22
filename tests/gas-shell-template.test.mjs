/**
 * doGet が読む「外枠」のファイル名を確かめる。
 *
 * ■ なぜ要るか
 *   外枠はもと index.html だった。しかし GitHub Pages が配っているのは
 *   リポジトリ直下なので、GAS 用のテンプレートがそのままトップページとして
 *   配られ、`<?!= include('app'); ?>` はブラウザに捨てられて **白い画面**になっていた。
 *   いまトップに置いてあるのは導入案内で、外枠は app-shell.html に移してある。
 *
 * ■ 名前を変えるほうの危険
 *   前の版を貼り付けた学級では、GAS 側のファイル名がまだ index のままである。
 *   code.gs だけ新しくすると、授業中に「ファイルが見つかりません」で画面が出ない。
 *   そこで新しい名前を先に探し、無ければ前の名前に落ちる。
 *   **その落ちる道が本当に動くか**を、ここで確かめる。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

/** GAS プロジェクトに置いてあるファイルの一覧を渡すと、その状況を作る */
const runDoGet = (existingFiles) => {
  const asked = [];
  const sheetRows = { '設定': [['お題', '投票状況'], ['夏の思い出', '投票受付中']] };
  const sheet = {
    getName: () => '設定',
    getDataRange: () => ({ getValues: () => sheetRows['設定'] }),
    getRange: () => ({ getValue: () => '', setValue: () => {}, setBackground: () => {} }),
    getLastRow: () => 2, appendRow: () => {}, setName: () => {},
  };
  const ss = {
    getSheetByName: () => sheet, getSheets: () => [sheet], insertSheet: () => sheet,
    getSpreadsheetTimeZone: () => 'Asia/Tokyo', getId: () => 'db1',
  };
  const evaluated = { setTitle() { return this; }, addMetaTag() { return this; }, setFaviconUrl() { return this; } };
  const sandbox = {
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k === 'DB_SPREADSHEET_ID' ? 'db1' : null),
      setProperty: () => {}, deleteProperty: () => {},
    }) },
    CacheService: { getScriptCache: () => ({ put: () => {}, get: () => null }) },
    Utilities: { getUuid: () => 'uuid', sleep: () => {}, formatDate: () => '',
      DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' }, computeDigest: () => [] },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    HtmlService: {
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      // GAS は、無いファイル名を渡すと例外を投げる。代役も同じにする。
      createTemplateFromFile: (name) => {
        asked.push(name);
        if (!existingFiles.includes(name)) throw new Error(`ファイルが見つかりません: ${name}`);
        return { evaluate: () => evaluated };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  let error = null;
  try { sandbox.doGet({}); } catch (e) { error = e; }
  return { asked, error };
};

let ng = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail === undefined ? '' : ' … ' + JSON.stringify(detail)}`);
  if (!cond) ng++;
};

console.log('■ いまの貼り付け（app-shell がある）');
{
  const r = runDoGet(['app-shell', 'app', 'css', 'vendor']);
  ok(r.error === null, '画面が出る');
  ok(r.asked[0] === 'app-shell', 'app-shell を読む', r.asked);
  ok(!r.asked.includes('index'), 'index は読みに行かない', r.asked);
}

console.log('\n■ 前の版のまま（GAS 側は index のまま。すでに使っている学級）');
{
  const r = runDoGet(['index', 'app', 'css', 'vendor']);
  ok(r.error === null, '画面が出る（授業が止まらない）', r.error && r.error.message);
  ok(r.asked.join(' → ') === 'app-shell → index', '新しい名前を先に探し、無ければ前の名前に落ちる', r.asked);
}

console.log('\n■ どちらも貼り忘れている');
{
  const r = runDoGet(['app', 'css', 'vendor']);
  ok(r.error !== null, '黙って空白を返さず、例外にする', r.error && r.error.message);
}

console.log(`\n${ng === 0 ? '外枠の読み分けは、3 つの状況すべてで意図どおり' : `${ng} 件が意図と違う`}`);
process.exit(ng === 0 ? 0 : 1);
