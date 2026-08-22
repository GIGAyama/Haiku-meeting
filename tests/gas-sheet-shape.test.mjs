/**
 * シートの作り（列の並び）が想定どおりかを、点検できているか。
 *
 * ■ なぜ要るか
 *   このアプリは列を番号で読み書きしている。得点は H列、ミュートは J列、
 *   締め切ったときの作者名は I列。「俳句」シートの前に1列挿されるだけで、
 *   マイページに自分の句が出ない・隠した句が広場に戻る・得点が別の列に入る、が
 *   **画面に何も出ないまま**起きる。MANUAL は「誤字はスプレッドシートで直すのが確実」と
 *   案内しているので、先生がそこを触るのは想定内の操作である。
 *
 * ■ 直しかたの方針
 *   自動で直すのは「直しても事故にならないもの」だけ。
 *   見出しがずれているときに見出しだけ書き換えると、**間違った列に正しいラベルが付き、
 *   事故が見えなくなる**。だから直さず、どこがどうずれているかを言う。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const src = readFileSync(new URL('../code.gs', import.meta.url), 'utf8');

const HEADER = {
  '設定': ['お題', '投票状況'],
  '俳句': ['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート', '投稿者ID'],
  'コメント': ['投稿日時', '俳句ID', 'コメント投稿者', 'コメント'],
  '投票': ['投票日時', '俳句ID', '点数', '投票者ID'],
};

/** rows をそのまま持つ表計算の代役。A1 記法と (row, col, h, w) の両方を受ける。 */
const mkSpreadsheet = (rows) => {
  const mk = (name0) => {
    let name = name0;
    const grid = () => rows[name];
    return {
      getName: () => name,
      getDataRange: () => ({ getValues: () => grid() }),
      getLastRow: () => grid().length,
      getLastColumn: () => grid().reduce((m, r) => Math.max(m, r.length), 0),
      getMaxColumns: () => 26,
      appendRow: (r) => grid().push(r.slice()),
      setName: (n2) => { rows[n2] = rows[name]; delete rows[name]; name = n2; },
      getRange: (a, b, h, w) => {
        if (typeof a === 'string') {
          const m = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(a) || ['', 'A', '1'];
          const c1 = m[1].charCodeAt(0) - 65, r1 = Number(m[2]) - 1;
          const c2 = m[3] ? m[3].charCodeAt(0) - 65 : c1;
          const r2 = m[4] ? Number(m[4]) - 1 : r1;
          return box(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
        }
        return box(a - 1, b - 1, h || 1, w || 1);
      },
    };
    function box(r0, c0, h, w) {
      return {
        getValue: () => (grid()[r0] || [])[c0] ?? '',
        setValue: (v) => { (grid()[r0] ||= [])[c0] = v; },
        getValues: () => Array.from({ length: h }, (_, i) =>
          Array.from({ length: w }, (_, j) => (grid()[r0 + i] || [])[c0 + j] ?? '')),
        setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { (grid()[r0 + i] ||= [])[c0 + j] = v; })),
        clearContent: () => { for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (grid()[r0 + i]) grid()[r0 + i][c0 + j] = ''; },
        setBackground: () => {},
      };
    }
  };
  return {
    rows,
    getId: () => 'bound',
    getSheetByName: (n) => (rows[n] ? mk(n) : null),
    getSheets: () => Object.keys(rows).map(mk),
    insertSheet: (n) => { rows[n] = []; return mk(n); },
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  };
};

/** 正常なコピーの中身。俳句が2句入っている。 */
const healthy = () => ({
  '設定': [HEADER['設定'].slice(), ['夏の思い出', '投票受付中']],
  '俳句': [HEADER['俳句'].slice(),
    [1, 'GIGA太郎', new Date(), 'せみのこえ', 'せみのこえ', 'きょうしつ', 'とどきけり', 6, '', false, 'voter1'],
    [2, 'GIGA花子', new Date(), 'ゆきのあさ', 'ゆきのあさ', 'しろいいき', 'あるくみち', 3, '', false, 'voter2']],
  'コメント': [HEADER['コメント'].slice()],
  '投票': [HEADER['投票'].slice()],
});

const load = (rows) => {
  const ss = mkSpreadsheet(rows);
  const cache = new Map();
  const sandbox = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
    CacheService: { getScriptCache: () => ({ put: (k, v) => cache.set(k, v), get: k => cache.get(k) ?? null }) },
    Utilities: {
      getUuid: () => 'tok', sleep: () => {}, formatDate: () => '',
      DigestAlgorithm: { SHA_256: 'x' }, Charset: { UTF_8: 'x' },
      computeDigest: (_a, v) => [...createHash('sha256').update(String(v), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      create: () => ss, openById: () => ss,
      getUi: () => { throw new Error('画面がありません'); },   // ウェブアプリ文脈
    },
    HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setFaviconUrl() { return this; } }) }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, ss };
};

let ng = 0;
/** 所見が空でも落ちないように。壊したときに「何件落ちたか」を見たいので。 */
const first = (list) => (list && list[0]) || { sheet: '', kind: '', detail: '' };
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail === undefined ? '' : ' … ' + JSON.stringify(detail)}`);
  if (!cond) ng++;
};

console.log('■ 正常なコピー');
{
  const { sandbox, ss } = load(healthy());
  ok(sandbox.checkSheets_(ss).length === 0, '所見は 0 件', sandbox.checkSheets_(ss));
}

console.log('\n■ 見出しの字が変えられた');
{
  const rows = healthy();
  rows['俳句'][0][3] = '作品';                      // 「俳句」→「作品」
  const { sandbox, ss } = load(rows);
  const f = sandbox.checkSheets_(ss);
  ok(f.length === 1 && first(f).sheet === '俳句', '「俳句」シートの所見が 1 件', f);
  ok(/4列目/.test(first(f).detail) && /作品/.test(first(f).detail), '何列目が何になっているかを言う', first(f).detail);
}

console.log('\n■ 前に1列挿された（いちばん怖い壊れ方）');
{
  const rows = healthy();
  rows['俳句'] = rows['俳句'].map(r => ['', ...r]);
  const { sandbox, ss } = load(rows);
  const f = sandbox.checkSheets_(ss);
  ok(f.some(x => x.kind === '見出しがちがう'), 'ずれを見つける', f.map(x => x.kind));
  ok(/ほか \d+ 列もずれています/.test(first(f).detail), '1列だけの話ではないことを言う', first(f).detail);
}

console.log('\n■ 余分な列が足された');
{
  const rows = healthy();
  rows['コメント'][0] = [...HEADER['コメント'], 'メモ'];
  const { sandbox, ss } = load(rows);
  const f = sandbox.checkSheets_(ss);
  ok(f.length === 1 && first(f).kind === '列が多い', '列が多いと分かる', f);
  ok(/メモ/.test(first(f).detail), '何が増えているかを言う', first(f).detail);
}

console.log('\n■ 自動で直すのは、直しても事故にならないものだけ');
{
  const rows = healthy();
  rows['投票'] = [];                                  // 空になっている
  rows['俳句'][0][7] = '点';                          // 見出しが違う（データはある）
  const { sandbox, ss } = load(rows);
  sandbox.ensureSheets_(ss);
  ok(JSON.stringify(rows['投票'][0]) === JSON.stringify(HEADER['投票']), '空のシートには見出しを書き戻す', rows['投票'][0]);
  ok(rows['俳句'][0][7] === '点', '中身のあるシートの見出しは書き換えない', rows['俳句'][0][7]);
  ok(rows['俳句'].length === 3, '行を足したり消したりしない', rows['俳句'].length);
}

console.log('\n■ 締め切り：列がずれていたら止める（実名が別の列に入るため）');
{
  const rows = healthy();
  rows['俳句'] = rows['俳句'].map(r => ['', ...r]);
  const { sandbox } = load(rows);
  const tok = sandbox.setupAdminPassword('haiku2026').token;
  const before = JSON.stringify(rows['設定'][1]);
  const res = sandbox.updateSettings(tok, '夏の思い出', '投票締切');
  ok(res.success === false, '締め切りを断る', res.message && res.message.slice(0, 40));
  ok(JSON.stringify(rows['設定'][1]) === before, 'お題も投票状況も書き換えない（中途半端にしない）', rows['設定'][1]);
  ok(rows['俳句'].every(r => !r.includes('GIGA太郎') || r.indexOf('GIGA太郎') === 2), '作者名をよその列へ書き戻していない');
}

console.log('\n■ 締め切り：正常なら、これまでどおり通る');
{
  const rows = healthy();
  const { sandbox } = load(rows);
  const tok = sandbox.setupAdminPassword('haiku2026').token;
  const res = sandbox.updateSettings(tok, '夏の思い出', '投票締切');
  ok(res.success === true, '締め切れる', res);
  ok(rows['俳句'][1][8] === 'GIGA太郎', 'I列（公開名）に作者名が入る', rows['俳句'][1][8]);
  ok(rows['設定'][1][1] === '投票締切', '投票状況が変わる', rows['設定'][1][1]);
}

console.log('\n■ 先生の画面に所見が届く');
{
  const rows = healthy();
  rows['俳句'][0][9] = 'ひみつ';
  const { sandbox } = load(rows);
  const tok = sandbox.setupAdminPassword('haiku2026').token;
  const dash = sandbox.getAdminDashboardData(tok);
  ok(Array.isArray(dash.sheetIssues) && dash.sheetIssues.length === 1, '管理画面のデータに載る', dash.sheetIssues);
}

console.log('\n■ 点検のメニューは、児童から呼ばれてもシートを読まない');
{
  const rows = healthy();
  const { sandbox, ss } = load(rows);
  let read = 0;
  const orig = ss.getSheetByName.bind(ss);
  ss.getSheetByName = (n) => { read++; return orig(n); };
  let threw = false;
  try { sandbox.showSheetCheck(); } catch (e) { threw = true; }
  ok(threw, '画面が無い文脈では例外になる');
  ok(read === 0, 'シートを1枚も読まずに終わる', read);
}

console.log(`\n${ng === 0 ? 'シートの点検は、9 つの場面すべてで意図どおり' : `${ng} 件が意図と違う`}`);
process.exit(ng === 0 ? 0 : 1);
