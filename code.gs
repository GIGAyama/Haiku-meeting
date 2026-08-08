/**
 * =========================================================================
 * GIGA句会プラザ - バックエンド (GAS)
 * =========================================================================
 */

function getDbSpreadsheet() {
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
        props.setProperty('ADMIN_PASSWORD', '1234');

        const sheet1 = ss.getSheets()[0];
        sheet1.setName('設定');
        sheet1.appendRow(['お題', '投票状況']);
        sheet1.appendRow(['自由律', '投票受付中']);
        
        const sheet2 = ss.insertSheet('俳句');
        // J列（10列目）に非表示(ミュート)フラグを隠しデータとして持ちます
        sheet2.appendRow(['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート']);
        
        const sheet3 = ss.insertSheet('コメント');
        sheet3.appendRow(['投稿日時', '俳句ID', 'コメント投稿者', 'コメント']);
        
        const sheet4 = ss.insertSheet('投票');
        sheet4.appendRow(['投票日時', '俳句ID', '点数', '投票者ID']);
        
        ss.getSheets().forEach(s => s.getRange('A1:J1').setBackground('#f3f4f6'));
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
 * ほかの .html ファイルを index.html に差し込む。
 * GAS は .gs と .html しか置けないので、CSS も JavaScript も .html に包んで持つ。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  getDbSpreadsheet();
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('GIGA句会プラザ')
    // 拡大は禁止しない。maximum-scale=1.0 と user-scalable=no を入れると、
    // 見えづらい子が画面を大きくできなくなる。
    // viewport-fit=cover は、切り欠きのある端末で安全領域を CSS から使うために要る。
    // GAS は画面を iframe で包むため、index.html の <meta> だけでは足りず、ここにも要る。
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

function getMyHaikus(authorName) {
  const ss = getDbSpreadsheet();
  const sheets = ss.getSheets();
  const myHaikus = [];

  const commentSheetsData = [];
  sheets.filter(s => s.getName().startsWith('コメント')).forEach(s => {
    commentSheetsData.push(...s.getDataRange().getValues().slice(1));
  });

  sheets.filter(s => s.getName().startsWith('俳句')).forEach(sheet => {
    const data = sheet.getDataRange().getValues().slice(1);
    const filtered = data.filter(row => row[1] === authorName);
    
    filtered.forEach(row => {
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

function submitHaiku(name, line1, line2, line3) {
  try {
    const ss = getDbSpreadsheet();
    const sheet = ss.getSheetByName('俳句');
    const haikuText = `${line1} ${line2} ${line3}`;
    const newId = new Date().getTime();
    sheet.appendRow([newId, name, new Date(), haikuText, line1, line2, line3, 0, "", false]);
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

    voteSheet.appendRow([new Date(), haikuId, score, voterId]);
    
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
    ss.getSheetByName('コメント').appendRow([new Date(), haikuId, commenterName, comment]);
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

function checkAdminPassword(password) {
  const props = PropertiesService.getScriptProperties();
  if (password === props.getProperty('ADMIN_PASSWORD')) {
    return { success: true, token: issueAdminToken_() };
  }
  // 合言葉は初期値が 1234 の4桁で、画面から何度でも試せる。
  // 締め出すと児童のいたずらで先生が入れなくなるので、代わりに1回ごとに待たせて
  // 総当たりを割に合わなくする。本当の対策は合言葉を変えてもらうこと。
  Utilities.sleep(1000);
  return { success: false };
}

function updateSettings(token, theme, status) {
  requireAdmin_(token);
  try {
    const ss = getDbSpreadsheet();
    const settingsSheet = ss.getSheetByName('設定');
    const haikuSheet = ss.getSheetByName('俳句');
    settingsSheet.getRange('A2').setValue(theme);
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
  if (oldPass !== props.getProperty('ADMIN_PASSWORD')) {
    Utilities.sleep(1000);
    return { success: false, message: '現在のパスワードが違います。' };
  }
  if (!newPass || String(newPass).length < 4) {
    return { success: false, message: 'あたらしいパスワードは4文字以上にしてください。' };
  }
  props.setProperty('ADMIN_PASSWORD', newPass);
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
    settings: settings
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
    s1.appendRow(['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名', 'ミュート']);
    
    const s2 = ss.insertSheet('コメント', 2);
    s2.appendRow(['投稿日時', '俳句ID', 'コメント投稿者', 'コメント']);
    
    const s3 = ss.insertSheet('投票', 3);
    s3.appendRow(['投票日時', '俳句ID', '点数', '投票者ID']);

    ss.getSheets().forEach(s => {
      if(s.getName() === '俳句' || s.getName() === 'コメント' || s.getName() === '投票') {
        s.getRange('A1:J1').setBackground('#f3f4f6');
      }
    });

    const setSheet = ss.getSheetByName('設定');
    setSheet.getRange('B2').setValue('投票受付中');
    return { success: true, message: '新しい句会の準備が完了しました！' };
  } catch (e) { return { success: false, message: e.message }; }
}
