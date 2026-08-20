/**
 * code.gs の管理者APIを Node 上で動かし、合鍵が無いと本当に弾かれるかを確かめる。
 * GAS のサービス（CacheService / Utilities / Spreadsheet）は最小限の代役を置く。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

const cache = new Map();
// 合言葉は入れずに始める。初期パスワードを廃止したので、これが新規導入の姿。
// 前の版から引き継いだ平文（ADMIN_PASSWORD）の扱いは、下のほうで別に確かめる。
const props = new Map([['DB_SPREADSHEET_ID', 'db1']]);
let uuid = 0;
const sheetRows = {
  '設定':   [['お題','投票状況'], ['夏の思い出','投票受付中']],
  // K列（投稿者ID）は端末ごとの識別子。マイページの持ち主判定に使う。
  '俳句':   [['ID','名前','投稿日時','俳句','上の句','中の句','下の句','得点','公開名','ミュート','投稿者ID'],
             [1,'GIGA太郎',new Date(),'せみのこえ','せみのこえ','きょうしつ','とどきけり',6,'',false,'voter1'],
             [2,'GIGA花子',new Date(),'ゆきのあさ','ゆきのあさ','しろいいきして','あるくみち',3,'',false,'voter2']],
  'コメント': [['投稿日時','俳句ID','コメント投稿者','コメント'],
             [new Date(),2,'先生','いい句だね']],
  '投票':   [['投票日時','俳句ID','点数','投票者ID']],
};
const mkSheet = (name) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => sheetRows[name] }),
  // A1 記法をちゃんと見る。ここを手抜きすると getSettingsData が
  // 「お題」を投票状況として読み、締切の判定が常に false になる（実際にそうなった）。
  getRange: (a1) => {
    const m = /^([A-K])(\d+)/.exec(String(a1) || 'A1');
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
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => props.get(k) ?? null,
    setProperty: (k,v) => props.set(k,v),
    deleteProperty: k => props.delete(k),
  }) },
  CacheService: { getScriptCache: () => ({ put: (k,v) => cache.set(k,v), get: k => cache.get(k) ?? null }) },
  Utilities: {
    getUuid: () => 'uuid-' + (++uuid),
    sleep: () => {},
    formatDate: () => '2026-08-08_13-00',
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF-8' },
    // GAS は符号つきのバイト列（-128〜127）を返す。code.gs 側がそれを 16 進に
    // 直しているので、代役も符号つきで返さないと本番と違う道を通ってしまう。
    computeDigest: (_alg, value) => [...createHash('sha256').update(String(value), 'utf8').digest()]
      .map(b => (b > 127 ? b - 256 : b)),
  },
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

console.log('\n■ 合言葉が未設定のときに、勝手に入れないか');
console.log('  設定前の getAdminSetupState →', JSON.stringify(sandbox.getAdminSetupState()),
  sandbox.getAdminSetupState().needsSetup ? '✅ 未設定と分かる' : '❌ 設定済みになっている');
const emptyTry = sandbox.checkAdminPassword('');
console.log('  空の合言葉で入室 →', JSON.stringify(emptyTry), emptyTry.token ? '❌ 合鍵が出ている' : '✅ 合鍵は出ない');
const guess = sandbox.checkAdminPassword('1234');
console.log('  むかしの初期値 1234 で入室 →', JSON.stringify(guess), guess.token ? '❌ 通ってしまった' : '✅ 通らない');
ok += attack('未設定のまま resetKukai("nope")', () => sandbox.resetKukai('nope'));

console.log('\n■ 最初の1回で合言葉を決める');
const tooShort = sandbox.setupAdminPassword('123');
console.log('  短すぎる →', JSON.stringify(tooShort), tooShort.success ? '❌ 通ってしまった' : '✅ 断った');
const setup = sandbox.setupAdminPassword('haiku2026');
console.log('  6文字以上 →', setup.success && setup.token ? '✅ 決まって合鍵も出た' : '❌');
const again = sandbox.setupAdminPassword('yokodori');
console.log('  あとから上書き →', JSON.stringify(again), again.success ? '❌ 上書きできてしまった' : '✅ 断った');
console.log('  保存されているのは平文か →',
  props.get('ADMIN_PASSWORD_HASH') && props.get('ADMIN_PASSWORD_HASH') !== 'haiku2026' && !props.get('ADMIN_PASSWORD')
    ? '✅ ハッシュだけ（平文は無い）' : '❌ 平文が残っている');

console.log('\n■ 決めた合言葉でログインしてから');
const bad = sandbox.checkAdminPassword('9999');
console.log('  合言葉ちがい →', JSON.stringify(bad), bad.token ? '❌ 合鍵が出ている' : '✅ 合鍵は出ない');
const good = sandbox.checkAdminPassword('haiku2026');
console.log('  合言葉あってる →', good.success && good.token ? '✅ 合鍵が出た' : '❌');
const dash = sandbox.getAdminDashboardData(good.token);
console.log('  合鍵ありで getAdminDashboardData →', dash && dash.stats ? '✅ 通った' : '❌ 通らない');

console.log('\n■ 前の版から引き継いだ平文の合言葉が、ハッシュに移るか');
props.delete('ADMIN_PASSWORD_HASH');
props.set('ADMIN_PASSWORD', 'oldpass123');
const migrated = sandbox.checkAdminPassword('oldpass123');
console.log('  むかしの合言葉で入室 →', migrated.success ? '✅ そのまま入れる' : '❌ 入れない');
console.log('  平文は消えたか →', props.get('ADMIN_PASSWORD') ? '❌ 残っている' : '✅ 消えた');

console.log('\n■ 他人のマイページを覗けないか');
const mine = sandbox.getMyHaikus('voter1');
console.log('  自分（voter1） →', JSON.stringify(mine.map(h => h.haiku)),
  mine.length === 1 && mine[0].haiku === 'せみのこえ' ? '✅ 自分の分だけ' : '❌');
const stolen = sandbox.getMyHaikus('GIGA花子');
console.log('  他人の名前を打つ →', JSON.stringify(stolen), stolen.length === 0 ? '✅ 何も返さない' : '❌ 読めてしまった');
const empty = sandbox.getMyHaikus('');
console.log('  識別子なし →', JSON.stringify(empty), empty.length === 0 ? '✅ 何も返さない' : '❌ 読めてしまった');
const others = sandbox.getMyHaikus('voter1').some(h => h.comments.some(c => c.comment === 'いい句だね'));
console.log('  他人がもらったコメント →', others ? '❌ 混ざっている' : '✅ 混ざらない');

console.log('\n■ 投票中に作者名が漏れないか');
const plazaOpen = sandbox.getPlazaData('voter1', 'GIGA太郎');
console.log('  投票受付中:', JSON.stringify(plazaOpen.haikus.map(h=>({author:h.author,isMine:h.isMine}))),
  plazaOpen.haikus.every(h=>h.author==='') ? '✅ 名前は空' : '❌ 名前が入っている');
sheetRows['設定'][1][1] = '投票締切';
const plazaClosed = sandbox.getPlazaData('voter1', 'GIGA太郎');
console.log('  投票締切  :', JSON.stringify(plazaClosed.haikus.map(h=>({author:h.author,isMine:h.isMine}))),
  plazaClosed.haikus[0].author ? '✅ 締切後は出る' : '❌ 出ない');

console.log(`\n合鍵なしの攻撃 ${ok}/6 を弾いた`);

const leaks = [
  ['他人の名前でマイページが読めた', stolen.length !== 0],
  ['識別子なしでマイページが読めた', empty.length !== 0],
  ['他人のコメントが混ざった', others],
  ['むかしの初期値 1234 で入れた', !!guess.token],
  ['未設定のまま合鍵が出た', !!emptyTry.token],
  ['合言葉を上書きできた', !!again.success],
  ['平文の合言葉が残っている', !!props.get('ADMIN_PASSWORD')],
].filter(([, ng]) => ng).map(([label]) => label);
if (leaks.length) console.error('\n❌ ' + leaks.join(' / '));

process.exit(ok === 6 && leaks.length === 0 ? 0 : 1);
