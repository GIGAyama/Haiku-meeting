/**
 * code.gs の管理者APIを Node 上で動かし、合鍵が無いと本当に弾かれるかを確かめる。
 * GAS のサービス（CacheService / Utilities / Spreadsheet）は最小限の代役を置く。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

const cache = new Map();
const props = new Map([['ADMIN_PASSWORD', '1234'], ['DB_SPREADSHEET_ID', 'db1']]);
let uuid = 0;
const sheetRows = {
  '設定':   [['お題','投票状況'], ['夏の思い出','投票受付中']],
  '俳句':   [['ID','名前','投稿日時','俳句','上の句','中の句','下の句','得点','公開名','ミュート'],
             [1,'GIGA太郎',new Date(),'せみのこえ','せみのこえ','きょうしつ','とどきけり',6,'',false]],
  'コメント': [['投稿日時','俳句ID','コメント投稿者','コメント']],
  '投票':   [['投票日時','俳句ID','点数','投票者ID']],
};
const mkSheet = (name) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => sheetRows[name] }),
  // A1 記法をちゃんと見る。ここを手抜きすると getSettingsData が
  // 「お題」を投票状況として読み、締切の判定が常に false になる（実際にそうなった）。
  getRange: (a1) => {
    const m = /^([A-J])(\d+)/.exec(String(a1) || 'A1');
    const col = m ? m[1].charCodeAt(0) - 65 : 0;
    const row = m ? Number(m[2]) - 1 : 0;
    return {
      getValue: () => sheetRows[name]?.[row]?.[col] ?? '',
      setValue: (v) => { (sheetRows[name][row] ||= [])[col] = v; },
      getValues: () => [], setValues: () => {}, clearContent: () => {}, setBackground: () => {},
    };
  },
  getLastRow: () => (sheetRows[name] || []).length,
  appendRow: (r) => sheetRows[name].push(r),
  setName: () => {},
});
const ss = {
  getSheetByName: (n) => (sheetRows[n] ? mkSheet(n) : null),
  getSheets: () => Object.keys(sheetRows).map(mkSheet),
  insertSheet: (n) => { sheetRows[n] = [[]]; return mkSheet(n); },
  getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  getId: () => 'db1',
};

const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k,v) => props.set(k,v) }) },
  CacheService: { getScriptCache: () => ({ put: (k,v) => cache.set(k,v), get: k => cache.get(k) ?? null }) },
  Utilities: { getUuid: () => 'uuid-' + (++uuid), sleep: () => {}, formatDate: () => '2026-08-08_13-00' },
  LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '' }), createTemplateFromFile: () => ({ evaluate: () => ({ setTitle(){return this}, addMetaTag(){return this}, setFaviconUrl(){return this} }) }) },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const attack = (label, fn) => {
  try { const r = fn(); console.log(`  ❌ 通ってしまった: ${label} →`, JSON.stringify(r)); return false; }
  catch (e) { console.log(`  ✅ 弾いた: ${label} → 「${e.message}」`); return true; }
};

console.log('■ 合鍵なしで管理者APIを叩く（児童が開発者ツールから打つのと同じ）');
let ok = 0;
ok += attack('resetKukai()',                       () => sandbox.resetKukai());
ok += attack('updateSettings(null,"x","投票締切")', () => sandbox.updateSettings(null, 'x', '投票締切'));
ok += attack('toggleMuteHaiku(null,1,true)',        () => sandbox.toggleMuteHaiku(null, 1, true));
ok += attack('getAdminDashboardData()',             () => sandbox.getAdminDashboardData());
ok += attack('でたらめな合鍵 resetKukai("nope")',    () => sandbox.resetKukai('nope'));

console.log('\n■ 正しい合言葉でログインしてから');
const bad = sandbox.checkAdminPassword('9999');
console.log('  合言葉ちがい →', JSON.stringify(bad), bad.token ? '❌ 合鍵が出ている' : '✅ 合鍵は出ない');
const good = sandbox.checkAdminPassword('1234');
console.log('  合言葉あってる →', good.success && good.token ? '✅ 合鍵が出た' : '❌');
const dash = sandbox.getAdminDashboardData(good.token);
console.log('  合鍵ありで getAdminDashboardData →', dash && dash.stats ? '✅ 通った' : '❌ 通らない');

console.log('\n■ 投票中に作者名が漏れないか');
const plazaOpen = sandbox.getPlazaData('voter1', 'GIGA太郎');
console.log('  投票受付中:', JSON.stringify(plazaOpen.haikus.map(h=>({author:h.author,isMine:h.isMine}))),
  plazaOpen.haikus.every(h=>h.author==='') ? '✅ 名前は空' : '❌ 名前が入っている');
sheetRows['設定'][1][1] = '投票締切';
const plazaClosed = sandbox.getPlazaData('voter1', 'GIGA太郎');
console.log('  投票締切  :', JSON.stringify(plazaClosed.haikus.map(h=>({author:h.author,isMine:h.isMine}))),
  plazaClosed.haikus[0].author ? '✅ 締切後は出る' : '❌ 出ない');

console.log(`\n合鍵なしの攻撃 ${ok}/5 を弾いた`);
process.exit(ok === 5 ? 0 : 1);
