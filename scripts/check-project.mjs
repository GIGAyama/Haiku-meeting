/**
 * 品質ゲート（GIGA Standard v5 / Part I の静的検査）
 *
 *   node scripts/check-project.mjs              … 検査する
 *   node scripts/check-project.mjs --self-test  … 検査そのものを、わざと壊して確かめる
 *
 * ■ なぜ --self-test があるか
 *
 *   「0件でした」だけでは、検査が動いているのか、何も見ていないのかを区別できない。
 *   実際、この仕組みを作る過程で判定器の不具合が2件見つかっている
 *   （半透明の面で色が壊れる／グラデーションの上を全部誤検出する）。
 *   規則ごとに「これを入れたら必ず落ちるはず」という壊し方を持たせ、
 *   本当に落ちることを毎回確かめる。
 *
 * ■ コメントを落としてから判定する
 *
 *   このリポジトリの app-shell.html には、CDN をやめた経緯が日本語のコメントで
 *   書いてある。素朴に grep すると **その説明文に反応して**「CDN を使っている」と
 *   誤検知する。実際そうなった。判定の前にコメントを落とす。
 *
 * ここにはかつて「正本（Digital_textbook の scripts/lib/project-quality.mjs）は
 * 作業環境から取得できなかったため自前で書いている。正本が使えるようになったら
 * 差し替える」と書いてあった。その計画は取りやめた（2026-08-22 に艦隊を実測）:
 *
 *   ・あの正本は8本にコピーがあるが 3世代に割れており（297行が6本・
 *     158行が1本・64行が1本）、export する名前もばらばら
 *     （runQualityChecks / run / 該当なし）。差し替えで受けられる形に
 *     なっていない。
 *   ・任意参照していた5本では、コピーを置いても検査が1件も増えないか、
 *     例外で落ちるかのどちらかだった。
 *
 * 共通化は、ひとつの大きな正本ではなく用件ごとの小さな正本で進める。
 * いま GIGAyama.github.io/standards/ にあるのは
 *   standards/lib/giga-v5-checks.mjs … Part I の検査
 *   standards/lib/check-secrets.mjs  … 秘密の直書き
 * の2つで、どちらも丸ごと1ファイルで完結し、無ければコマンドごと失敗する。
 *
 * 規則を RULES 配列に閉じてあること自体は、そのまま値打ちがある
 * （どの規則があるかが1か所で読める）ので変えていない。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

/** HTML コメント・JS のブロック/行コメント・CSS コメントを落とす */
export const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** ファイルを読み込んで { 生, コメント無し } の地図にする */
const loadFiles = () => {
  const files = new Map();
  for (const p of new Set([...CONFIG['配信ファイル'], ...CONFIG['原本'], 'tools/extra.css'])) {
    const full = join(ROOT, p);
    if (!existsSync(full)) continue;
    const raw = readFileSync(full, 'utf8');
    files.set(p, { raw, clean: stripComments(raw), kb: Buffer.byteLength(raw) / 1024, lines: raw.split('\n').length });
  }
  return files;
};

const get = (files, p) => files.get(p)?.clean ?? '';

/**
 * `名前(` で始まる呼び出しの、括弧の中身をぜんぶ取り出す。
 * 引数の中にさらに括弧が入る（safeCellText_(authorId || '') など）ので、
 * 正規表現ひとつでは取り切れない。深さを数えて閉じ括弧を探す。
 */
const callArgs = (src, fnName) => {
  const found = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;      // 閉じていない＝読み取れていないので数えない
    found.push(src.slice(open + 1, i));
  }
  return found;
};

/**
 * 規則。
 *   check(files) … { ok, detail } を返す
 *   break(files) … わざと壊す（--self-test 用）。壊したあと check が落ちなければ検査が甘い。
 */
const RULES = [
  {
    id: 'CDN実行コードなし',
    why: '学校のフィルタリングで塞がれると画面が一切出ない',
    check: (files) => {
      const hits = [];
      for (const p of CONFIG['配信ファイル']) {
        for (const bad of CONFIG['禁止するCDN']) {
          if (get(files, p).includes(bad)) hits.push(`${p}: ${bad}`);
        }
      }
      return { ok: hits.length === 0, detail: hits.length ? hits.join(' / ') : '0 バイト' };
    },
    break: (files) => {
      const f = files.get('app-shell.html');
      f.clean += '\n<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>';
    },
  },
  {
    id: '拡大を禁止していない',
    why: '見えづらい子が画面を大きくできなくなる',
    check: (files) => {
      const hits = ['app-shell.html', 'index.html', 'code.gs'].filter(p => /user-scalable\s*=\s*no|maximum-scale/.test(get(files, p)));
      return { ok: hits.length === 0, detail: hits.length ? hits.join(', ') + ' に指定あり' : '指定なし' };
    },
    break: (files) => { files.get('code.gs').clean += "\n.addMetaTag('viewport','width=device-width, user-scalable=no')"; },
  },
  {
    id: 'viewport-fit=cover が app-shell.html と code.gs の両方にある',
    why: 'GAS は画面を iframe で包むため、片方だけでは安全領域が使えない',
    check: (files) => {
      const missing = ['app-shell.html', 'code.gs'].filter(p => !get(files, p).includes('viewport-fit=cover'));
      return { ok: missing.length === 0, detail: missing.length ? `${missing.join(', ')} に無い` : '両方にあり' };
    },
    break: (files) => { files.get('code.gs').clean = get(files, 'code.gs').replace(/viewport-fit=cover/g, ''); },
  },
  {
    id: 'サイトのトップが GAS のテンプレートのままではない',
    why: 'GitHub Pages がそれをそのまま配ると、白い画面だけが出る',
    // 実際にそうなっていた。`<?!= include('app'); ?>` はブラウザには意味が無く、
    // 黙って捨てられる。エラーも出ないので、開いた人には理由が分からない。
    check: (files) => {
      // 「無い」を緑にしない。消えていても Pages は 404 を返すだけで、
      // ここが素通りすると誰も気づけない。
      if (!files.has('index.html')) return { ok: false, detail: 'index.html が無い' };
      const bad = /<\?/.test(get(files, 'index.html'));
      return { ok: !bad, detail: bad ? 'index.html に GAS のテンプレート記法がある' : '導入案内のページになっている' };
    },
    break: (files) => { files.get('index.html').clean += "\n<?!= include('app'); ?>"; },
  },
  {
    id: 'code.gs が読む外枠のファイルがある',
    why: '名前がずれると、開いた瞬間に「ファイルが見つかりません」だけが出る',
    check: (files) => {
      const m = /SHELL_FILE_\s*=\s*'([^']+)'/.exec(get(files, 'code.gs'));
      if (!m) return { ok: false, detail: 'code.gs に SHELL_FILE_ が無い' };
      const wanted = m[1] + '.html';
      return { ok: files.has(wanted), detail: files.has(wanted) ? `${wanted} を読んでいる` : `${wanted} がリポジトリに無い` };
    },
    break: (files) => {
      files.get('code.gs').clean = get(files, 'code.gs').replace(/SHELL_FILE_\s*=\s*'[^']+'/, "SHELL_FILE_ = 'nope'");
    },
  },
  {
    id: '100vh を単独で使っていない',
    why: 'モバイルのアドレスバー分だけはみ出し、下のボタンが押せなくなる',
    // ⚠️ @supports not (height: 100dvh) の中の 100vh は正しいフォールバック。
    //    ここを見ないと、正しく書いてあるものを落としてしまう（v5 §P4 の既知の誤検知）。
    check: (files) => {
      const css = get(files, 'tools/extra.css');
      if (!css.includes('100dvh')) return { ok: false, detail: '100dvh が無い' };
      const outside = css.replace(/@supports\s+not\s*\(height:\s*100dvh\)\s*\{[\s\S]*?\}\s*\}/g, '');
      const bare = /100vh/.test(outside);
      return { ok: !bare, detail: bare ? '@supports の外に 100vh がある' : '100dvh ＋ @supports のフォールバック' };
    },
    break: (files) => { files.get('tools/extra.css').clean += '\n.something { height: 100vh; }'; },
  },
  {
    id: 'safe-area-inset を使っている',
    why: 'ノッチやホームバーに中身が潜り込む',
    check: (files) => {
      const n = (get(files, 'tools/extra.css').match(/safe-area-inset/g) || []).length;
      return { ok: n > 0, detail: `${n} か所` };
    },
    break: (files) => { files.get('tools/extra.css').clean = get(files, 'tools/extra.css').replace(/safe-area-inset/g, 'xxx'); },
  },
  {
    id: 'prefers-reduced-motion が 0 ではない',
    why: '0 にすると animation-fill-mode: forwards が壊れ、fade-in の中身が消える',
    check: (files) => {
      const css = get(files, 'tools/extra.css');
      if (!css.includes('prefers-reduced-motion')) return { ok: false, detail: '対応していない' };
      const block = css.slice(css.indexOf('prefers-reduced-motion'));
      const end = block.indexOf('}\n}');
      const body = block.slice(0, end > 0 ? end : 400);
      const zero = /animation-duration:\s*0s|animation-duration:\s*0\s*!|transition-duration:\s*0s|transition-duration:\s*0\s*!/.test(body);
      return { ok: !zero, detail: zero ? '0 になっている（.01ms にする）' : '.01ms を使っている' };
    },
    break: (files) => {
      files.get('tools/extra.css').clean = get(files, 'tools/extra.css').replace(/animation-duration:\s*0\.01ms/, 'animation-duration: 0s');
    },
  },
  {
    id: 'forced-colors に対応している',
    why: 'ハイコントラストモードで色の境目が消え、押せると分からなくなる',
    check: (files) => ({ ok: get(files, 'tools/extra.css').includes('forced-colors'), detail: '' }),
    break: (files) => { files.get('tools/extra.css').clean = get(files, 'tools/extra.css').replace(/forced-colors/g, 'xxx'); },
  },
  {
    id: 'rt（ふりがな）の色を決め打ちしていない',
    why: '色のついた面に重ねると読めなくなる。ふりがなが要るのは低学年の児童である',
    // 継がせる規則が広すぎても壊れる。アプリ全体の地の色（.app-shell）を
    // 「色のついた面」と数えると、rt の既定色が一度も効かなくなる（実測でそうなっていた）。
    check: (files) => {
      const css = get(files, 'tools/extra.css');
      const hasInherit = /rt\s*\{\s*color:\s*inherit/.test(css) || /rt\s*\{[^}]*color:\s*inherit/.test(css);
      const excludesShell = css.includes(':not(.app-shell) rt');
      if (!hasInherit) return { ok: false, detail: '色のついた面で継がせる規則が無い' };
      if (!excludesShell) return { ok: false, detail: 'アプリ全体の地の色を除いていない（既定色が効かなくなる）' };
      return { ok: true, detail: '継がせる範囲を地の色の外に限っている' };
    },
    break: (files) => {
      files.get('tools/extra.css').clean = get(files, 'tools/extra.css').replace(/:not\(\.app-shell\) rt/g, ' rt');
    },
  },
  {
    id: '管理者APIがサーバー側で認可を通している',
    why: 'google.script.run は誰でも呼べる。ボタンを隠すのは防御ではない',
    check: (files) => {
      const gs = get(files, 'code.gs');
      const bad = CONFIG['管理者API'].filter(fn => {
        const m = new RegExp(`function\\s+${fn}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(gs);
        return !m || !m[1].includes('requireAdmin_');
      });
      return { ok: bad.length === 0, detail: bad.length ? `認可なし: ${bad.join(', ')}` : `${CONFIG['管理者API'].length} 件すべて通している` };
    },
    break: (files) => {
      files.get('code.gs').clean = get(files, 'code.gs').replace(/function resetKukai\(token\) \{\n  requireAdmin_\(token\);/, 'function resetKukai(token) {');
    },
  },
  {
    id: '児童の入力をセルに書く前に無害化している',
    why: '= + - @ で始まる句を先生が表計算で開くと、その場で学級のデータが外へ出る',
    check: (files) => {
      const gs = get(files, 'code.gs');
      const fn = CONFIG['無害化関数'];
      const bad = [];
      if (!new RegExp(`function\\s+${fn}\\s*\\(`).test(gs)) bad.push(`${fn}() が無い`);

      const writes = [...callArgs(gs, 'appendRow'), ...callArgs(gs, 'setValue')];
      for (const args of writes) {
        // 無害化を通しているところは、いったん取り除いてから見る。
        // 残ったところに児童の入力の名前があれば、それは素通しで書いている。
        let rest = args;
        for (const wrapped of callArgs(args, fn)) rest = rest.replace(`${fn}(${wrapped})`, '');
        for (const v of CONFIG['無害化する値']) {
          if (new RegExp(`\\b${v}\\b`).test(rest) && !bad.includes(v)) bad.push(v);
        }
      }
      return {
        ok: bad.length === 0,
        detail: bad.length ? `素通し: ${bad.join(', ')}` : `セルへの書き込み ${writes.length} か所すべてが ${fn}() を通している`,
      };
    },
    break: (files) => {
      files.get('code.gs').clean = get(files, 'code.gs').replace('safeCellText_(comment)', 'comment');
    },
  },
  {
    id: 'localStorage.clear() を使っていない',
    why: '同じ端末のほかのアプリの記録まで消える',
    check: (files) => {
      const hits = [...files.entries()].filter(([, v]) => v.clean.includes('localStorage.clear()')).map(([k]) => k);
      return { ok: hits.length === 0, detail: hits.join(', ') || '未使用' };
    },
    break: (files) => { files.get('src/app.jsx').clean += '\nlocalStorage.clear();'; },
  },
  {
    id: 'タップ領域を広げる仕組みがある',
    why: '詰めて組んだところで min-height を当てると折り返しが起き、別の破綻を生む',
    check: (files) => {
      const css = get(files, 'tools/extra.css');
      const ok = /\.tap-44::after/.test(css) && /min-width:\s*44px/.test(css) && /min-height:\s*44px/.test(css);
      return { ok, detail: ok ? '.tap-44 が疑似要素で当たり判定を広げている' : '.tap-44 が無い' };
    },
    break: (files) => { files.get('tools/extra.css').clean = get(files, 'tools/extra.css').replace(/min-height:\s*44px/g, 'min-height: 20px'); },
  },
  {
    id: 'ファイルの大きさが上限内',
    why: '校内Wi-Fiで40人が同時に開く',
    check: (files) => {
      const over = [...files.entries()]
        .filter(([, v]) => v.kb > CONFIG['1ファイルの上限KB'] || v.lines > CONFIG['1ファイルの上限行数'])
        .map(([k, v]) => `${k} ${v.kb.toFixed(0)}KB/${v.lines}行`);
      const js = ['app.html', 'vendor.html'].reduce((a, p) => a + (files.get(p)?.kb ?? 0), 0);
      if (js > CONFIG['初回JSの上限KB']) over.push(`初回JS ${js.toFixed(0)}KB`);
      return { ok: over.length === 0, detail: over.join(', ') || `初回JS ${js.toFixed(0)}KB（上限 ${CONFIG['初回JSの上限KB']}KB）` };
    },
    break: (files) => { files.get('app.html').kb = 9999; },
  },
];

/* ------------------------------------------------------------------ 実行 */
const selfTest = process.argv.includes('--self-test');

if (!selfTest) {
  const files = loadFiles();
  let ng = 0;
  console.log('GIGA Standard v5 品質ゲート\n');
  for (const rule of RULES) {
    const r = rule.check(files);
    if (!r.ok) ng++;
    console.log(`  ${r.ok ? '✅' : '❌'} ${rule.id}${r.detail ? `  … ${r.detail}` : ''}`);
    if (!r.ok) console.log(`     なぜ大事か: ${rule.why}`);
  }
  console.log(`\n${RULES.length} 件中 ${RULES.length - ng} 件が通った。`);
  if (ng) { console.error(`\n❌ ${ng} 件が基準を満たしていない。`); process.exit(1); }
  console.log('\n⚠️ これは静的な検査だけ。コントラスト・タップ領域・キーボード操作は');
  console.log('   実ブラウザで測らないと分からない（AUDIT.md の「測り方」を参照）。');
} else {
  // 規則ごとに、壊す前は通り、壊したあとは落ちることを確かめる
  console.log('品質ゲートの自己検証（わざと壊して、落ちることを見る）\n');
  let ng = 0;
  for (const rule of RULES) {
    const before = rule.check(loadFiles());
    const files = loadFiles();
    rule.break(files);
    const after = rule.check(files);
    const ok = before.ok && !after.ok;
    if (!ok) ng++;
    console.log(`  ${ok ? '✅' : '❌'} ${rule.id}`);
    if (!before.ok) console.log(`     壊す前から落ちている（${before.detail}）`);
    if (after.ok) console.log(`     わざと壊しても通ってしまった ← この規則は何も見ていない`);
  }
  console.log(`\n${RULES.length} 件中 ${RULES.length - ng} 件が「壊すと落ちる」ことを確かめられた。`);
  if (ng) { console.error(`\n❌ ${ng} 件の規則が信用できない。`); process.exit(1); }
}
