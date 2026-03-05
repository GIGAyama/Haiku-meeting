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

function doGet(e) {
  getDbSpreadsheet();
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('GIGA句会プラザ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
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

function getPlazaData(voterId) {
  const ss = getDbSpreadsheet();
  const haikuData = ss.getSheetByName('俳句').getDataRange().getValues().slice(1);
  const commentData = ss.getSheetByName('コメント').getDataRange().getValues().slice(1);
  const voteData = ss.getSheetByName('投票').getDataRange().getValues().slice(1);
  const settings = getSettingsData();

  const haikus = [];
  haikuData.forEach(row => {
    // J列(インデックス9)がtrueのものはミュートされているので広場には送らない
    const isMuted = row[9] === true || String(row[9]).toUpperCase() === 'TRUE';
    if (!isMuted) {
      haikus.push({
        id: row[0],
        author: row[1],
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
// 5. 管理者API (神アプリアップデート版)
// -------------------------------------------------------------------------
function checkAdminPassword(password) {
  const props = PropertiesService.getScriptProperties();
  return password === props.getProperty('ADMIN_PASSWORD');
}

function updateSettings(theme, status) {
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
  if (checkAdminPassword(oldPass)) {
    PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', newPass);
    return { success: true, message: 'パスワードを更新しました。' };
  }
  return { success: false, message: '現在のパスワードが違います。' };
}

// 新規追加：ダッシュボード用データの一括取得
function getAdminDashboardData() {
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

// 新規追加：不適切コンテンツのワンタップミュート
function toggleMuteHaiku(haikuId, muteStatus) {
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

function resetKukai() {
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
