/**
 * 作品を入れる表計算ファイルを、どこから取ってくるか。
 *
 * ■ 配り方を変えた
 *   これまで … script.new で独立スクリプトを作り、5 ファイルを手で貼る。
 *              最初に誰かが開いた瞬間に DB を自動生成し、ID をプロパティに持つ。
 *   これから … スプレッドシートのコピーを配る（コンテナバインド）。
 *              束ねられたそのファイルが本体なので、ID も自動生成も要らない。
 *
 * ■ ここで確かめたいこと
 *   **すでに独立スクリプトで公開している学級を止めないこと。** 新しい経路だけに
 *   したら、その学級では getActiveSpreadsheet() が null を返し、作品が
 *   1つも見えなくなる。両方の状況で、正しいファイルに行き着くかを見る。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

const HEADERS = {
  '設定': ['お題', '投票状況'],
  '俳句': ['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート', '投稿者ID'],
  'コメント': ['投稿日時', '俳句ID', 'コメント投稿者', 'コメント'],
  '投票': ['投票日時', '俳句ID', '点数', '投票者ID'],
};

/** 表計算ファイルの代役。どのシートを持っているかを渡して作る。 */
const mkSpreadsheet = (id, sheetNames) => {
  const rows = {};
  for (const n of sheetNames) rows[n] = [HEADERS[n] ? HEADERS[n].slice() : []];
  // 本物のシートは、名前を変えたあとも同じシートを指し続ける。
  // 代役を素朴に書くと setName のあとに appendRow が行方不明になり、
  // code.gs 側の catch に飲まれて「アクセスが集中しています」に化ける。
  const mk = (name0) => {
    let name = name0;
    return {
      getName: () => name,
      getDataRange: () => ({ getValues: () => rows[name] }),
      getRange: () => ({ getValue: () => '', setValue: () => {}, getValues: () => [], setValues: () => {}, clearContent: () => {}, setBackground: () => {} }),
      getLastRow: () => rows[name].length,
      appendRow: (r) => rows[name].push(r),
      setName: (n2) => { rows[n2] = rows[name]; delete rows[name]; name = n2; },
    };
  };
  return {
    id, rows,
    getId: () => id,
    getSheetByName: (n) => (rows[n] ? mk(n) : null),
    getSheets: () => Object.keys(rows).map(mk),
    insertSheet: (n) => { rows[n] = []; return mk(n); },
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  };
};

/**
 * @param bound      束ねられた表計算（コンテナバインド）。null なら独立スクリプト
 * @param storedId   スクリプトプロパティに入っている DB_SPREADSHEET_ID
 * @param existing   openById で開ける既存ファイル
 */
const run = (bound, storedId, existing) => {
  const props = new Map();
  if (storedId) props.set('DB_SPREADSHEET_ID', storedId);
  const created = [];
  const openedIds = [];
  const sandbox = {
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props.get(k) ?? null,
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: k => props.delete(k),
    }) },
    CacheService: { getScriptCache: () => ({ put: () => {}, get: () => null }) },
    Utilities: { getUuid: () => 'uuid', sleep: () => {}, formatDate: () => '',
      DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' }, computeDigest: () => [] },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => bound,
      create: (name) => { const ss = mkSpreadsheet('created-1', ['シート1']); created.push(name); return ss; },
      openById: (id) => { openedIds.push(id); return existing; },
    },
    HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setFaviconUrl() { return this; } }) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const got = sandbox.getDbSpreadsheet();
  return { got, created, openedIds, props };
};

let ng = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail === undefined ? '' : ' … ' + JSON.stringify(detail)}`);
  if (!cond) ng++;
};
const ALL = ['設定', '俳句', 'コメント', '投票'];

console.log('■ 新しい配り方（スプレッドシートのコピー＝コンテナバインド）');
{
  const bound = mkSpreadsheet('bound-1', ALL);
  const r = run(bound, null, null);
  ok(r.got === bound, '束ねられているそのファイルを使う', r.got && r.got.getId());
  ok(r.created.length === 0, '新しいファイルを作らない', r.created);
  ok(r.openedIds.length === 0, 'openById を呼ばない（ID を持たなくてよい）', r.openedIds);
  ok(!r.props.has('DB_SPREADSHEET_ID'), 'スクリプトプロパティを汚さない');
}

console.log('\n■ 前の配り方（独立スクリプト）で、すでに公開している学級');
{
  const existing = mkSpreadsheet('db-old', ALL);
  const r = run(null, 'db-old', existing);
  ok(r.got === existing, 'これまでの表計算ファイルをそのまま開く', r.got && r.got.getId());
  ok(r.openedIds.join() === 'db-old', '控えてある ID で開く', r.openedIds);
  ok(r.created.length === 0, '作り直さない（作品が消えない）', r.created);
}

console.log('\n■ 前の配り方で、まだ一度も開かれていない');
{
  const r = run(null, null, mkSpreadsheet('created-1', ALL));
  ok(r.created.length === 1, 'これまでどおり自動で作る', r.created);
  ok(r.props.get('DB_SPREADSHEET_ID') === 'created-1', '作った ID を控える', r.props.get('DB_SPREADSHEET_ID'));
}

console.log('\n■ コピーしたファイルから、先生がうっかりシートを消した');
{
  const bound = mkSpreadsheet('bound-2', ['設定', '俳句']);   // コメントと投票が無い
  const r = run(bound, null, null);
  ok(ALL.every(n => bound.getSheetByName(n)), '足りないシートを作り直す', Object.keys(bound.rows));
  ok(JSON.stringify(bound.rows['コメント'][0]) === JSON.stringify(HEADERS['コメント']), '見出し行も入れる', bound.rows['コメント'][0]);
  ok(bound.rows['俳句'].length === 1, 'もとからあるシートには足さない（二重見出しにしない）', bound.rows['俳句'].length);
}

console.log(`\n${ng === 0 ? '4 つの状況すべてで、正しい表計算ファイルに行き着いた' : `${ng} 件が意図と違う`}`);
process.exit(ng === 0 ? 0 : 1);
