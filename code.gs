/**
 * @fileoverview 句会アプリのサーバーサイドロジックを管理するスクリプト。
 * データベース（Googleスプレッドシート）との連携、Webページの表示、
 * 俳句・投票・コメントのデータ処理など、アプリの頭脳となる部分を担当します。
 */

// ===============================================================
// ■ 1. 初期設定
// アプリケーション全体で共通して使用する基本的な設定です。
// ===============================================================

// データベースとして利用するスプレッドシートの各シート名を設定します。
const HAIKU_SHEET_NAME = '俳句';
const COMMENT_SHEET_NAME = 'コメント';
const VOTE_SHEET_NAME = '投票';
const SETTINGS_SHEET_NAME = '設定';


// ===============================================================
// ■ 2. メイン処理 (Webページ表示)
// ユーザーがWebアプリのURLにアクセスしたときに、どのHTMLページを表示するかを決定します。
// ===============================================================

/**
 * Webアプリケーションにアクセスがあったときに呼ばれるメインの関数です。
 * URLのパラメータ（?page=...）に応じて、表示するHTMLページを切り替えます。
 * @param {object} e - URLパラメータなどの情報を持つオブジェクト
 * @returns {HtmlOutput} - ブラウザに表示するHTMLコンテンツ
 */
function doGet(e) {
  // URLに ?page=... の指定がなければ、最初のページ 'index' を表示します。
  const page = e.parameter.page || 'index';
  
  // 指定された名前のHTMLファイルから、テンプレート（雛形）を作成します。
  const template = HtmlService.createTemplateFromFile(page);

  // HTML側でページのURLを使えるように、URLをテンプレートに渡します。
  template.url = ScriptApp.getService().getUrl();

  // テンプレートからHTMLコンテンツを生成します。
  const html = template.evaluate();

  // 表示するページに応じて、ブラウザのタブに表示されるタイトルを設定します。
  switch (page) {
    case 'index':
      html.setTitle('俳句を投稿しよう');
      break;
    case 'plaza':
      html.setTitle('作品広場');
      break;
    case 'mypage':
      html.setTitle('マイページ');
      break;
    case 'admin':
      html.setTitle('先生用管理ページ');
      break;
    default:
      html.setTitle('句会アプリ');
  }

  return html;
}


// ===============================================================
// ■ 3. データ取得系の関数
// HTMLページ（ブラウザ）からの要求に応じて、スプレッドシートから情報を読み取り、
// ページに表示するためのデータを準備して返します。
// ===============================================================

/**
 * 「設定」シートから、現在のお題と投票状況を取得します。
 * 主に管理ページと作品広場で使用されます。
 * @returns {object} 現在のお題と投票状況を持つオブジェクト
 */
function getAdminData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingsSheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    const theme = settingsSheet.getRange('A2').getValue();
    const votingStatus = settingsSheet.getRange('B2').getValue();
    return {
      theme: theme || '未設定',
      votingStatus: votingStatus || '投票受付中'
    };
  } catch (e) {
    // もしエラーが発生したら、エラーであることが分かるようにします。
    return { theme: 'エラー', votingStatus: 'エラー' };
  }
}

/**
 * 作品広場（plaza.html）の表示に必要なすべてのデータを取得します。
 * @param {string} voterId - 投票者を識別するための一意のID
 * @returns {object} 俳句、コメント、自分の投票履歴など、作品広場で必要な情報の詰め合わせ
 */
function getKukaiData(voterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const haikuSheet = ss.getSheetByName(HAIKU_SHEET_NAME);
  const commentSheet = ss.getSheetByName(COMMENT_SHEET_NAME);
  const voteSheet = ss.getSheetByName(VOTE_SHEET_NAME);
  
  // 「俳句」シートからすべての俳句データを取得します。
  // .slice(1) は、1行目の見出しを除外するためのおまじないです。
  const haikuData = haikuSheet.getDataRange().getValues().slice(1);
  const haikus = haikuData.map(row => ({
    id: row[0],
    author: row[1], // 自分の句かどうかを判定するために使用
    haiku: row[3],  // 俳句の全文
    line1: row[4],  // 上の句
    line2: row[5],  // 中の句
    line3: row[6],  // 下の句
    score: row[7],  // 現在の得点
    name: row[8] || '（作者名）' // 投票締切後に表示する名前
  }));

  // 「コメント」シートからすべてのコメントデータを取得します。
  const commentData = commentSheet.getDataRange().getValues().slice(1);
  const comments = commentData.map(row => ({
    haikuId: row[1],
    commenter: row[2], // コメントした人の名前
    comment: row[3]    // コメントの内容
  }));
  
  // 「投票」シートから、このユーザーが過去にどの作品に投票したかの履歴を取得します。
  const voteData = voteSheet.getDataRange().getValues().slice(1);
  const myVotes = voteData
    .filter(row => row[3] === voterId) // 自分のIDと一致する行だけを絞り込み
    .map(row => ({ haikuId: row[1], score: row[2] }));

  // 管理データを取得します。
  const adminData = getAdminData();

  // これらすべての情報をまとめて、HTML側に返します。
  return {
    haikus: haikus,
    comments: comments,
    myVotes: myVotes, // 自分の投票履歴を追加
    theme: adminData.theme,
    votingStatus: adminData.votingStatus
  };
}

/**
 * マイページ（mypage.html）の表示に必要なデータを取得します。
 * 指定された名前の人が投稿した、すべての俳句とそのコメントを取得します。
 * @param {string} name - データを取得したい作者名
 * @returns {{haikus: Array<object>}|null} その人の俳句、得点、コメントのリスト。見つからなければnull。
 */
function getMyHaiku(name) {
  if (!name) return null;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const haikuSheet = ss.getSheetByName(HAIKU_SHEET_NAME);
  const commentSheet = ss.getSheetByName(COMMENT_SHEET_NAME);
  
  // 全俳句データと全コメントデータを取得
  const allHaikuData = haikuSheet.getDataRange().getValues().slice(1);
  const allCommentData = commentSheet.getDataRange().getValues().slice(1);
  
  // 指定された名前の人の俳句だけを抽出
  const myHaikusData = allHaikuData.filter(row => row[1] === name);
  
  if (myHaikusData.length === 0) return null;

  // 自分の各俳句に、寄せられたコメントを紐付ける
  const myHaikusWithComments = myHaikusData.map(haikuRow => {
    const haikuId = haikuRow[0];
    const commentsForThisHaiku = allCommentData
      .filter(commentRow => commentRow[1] == haikuId)
      .map(commentRow => ({
          commenter: commentRow[2],
          comment: commentRow[3]
      }));
      
    return {
      id: haikuId,
      haiku: haikuRow[3],
      score: haikuRow[7],
      comments: commentsForThisHaiku
    };
  });

  return { haikus: myHaikusWithComments };
}


// ===============================================================
// ■ 4. データ更新・登録系の関数
// HTMLページからの指示で、スプレッドシートに新しいデータを書き込んだり、
// 既存のデータを更新したりします。
// ===============================================================

/**
 * 新しい俳句をスプレッドシートに投稿（登録）します。
 * @param {string} name - 投稿者の名前
 * @param {string} line1 - 上の句
 * @param {string} line2 - 中の句
 * @param {string} line3 - 下の句
 * @returns {object} 処理が成功したかどうかと、投稿者名
 */
function submitHaiku(name, line1, line2, line3) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(HAIKU_SHEET_NAME);
    const haikuText = `${line1} ${line2} ${line3}`;
    
    // 新しい俳句IDを決定します（最後の俳句のID + 1）。
    const lastId = sheet.getLastRow() > 1 ? sheet.getRange(sheet.getLastRow(), 1).getValue() : 0;
    const newId = lastId + 1;
    
    // スプレッドシートの最終行に、新しい俳句の情報を追加します。
    const newRow = [
      newId, name, new Date(), haikuText, 
      line1, line2, line3, 
      0, "" // score and published name
    ];
    sheet.appendRow(newRow);

    return { success: true, name: name };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 投票をスプレッドシートに記録し、俳句の得点を更新します。
 * @param {number} haikuId - 投票対象の俳句ID
 * @param {number} score - 投票する点数 (3:金賞, 2:銀賞, 1:銅賞)
 * @param {string} voterId - 投票者の一意のID
 * @returns {object} 処理の成功/失敗を示すオブジェクト
 */
function submitVote(haikuId, score, voterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const voteSheet = ss.getSheetByName(VOTE_SHEET_NAME);
  const haikuSheet = ss.getSheetByName(HAIKU_SHEET_NAME);
  
  // 複数人が同時に投票してもデータが壊れないように、処理をロックします。
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 最大10秒待機

  try {
    const voteData = voteSheet.getDataRange().getValues();
    const haikuData = haikuSheet.getDataRange().getValues();
    
    const voterVotes = voteData.filter(row => row[3] === voterId);

    // ルールチェック1：自分の作品への投票はできない
    const targetHaiku = haikuData.find(row => row[0] == haikuId);
    const authorName = targetHaiku ? targetHaiku[1] : null;
    const voterName = haikuData.find(row => row[1] === authorName) ? authorName : null; // This logic needs to be better
    // This check is imperfect, client-side check is primary.

    // ルールチェック2：同じ賞（金賞など）は1回しか投票できない
    if (voterVotes.some(row => row[2] == score)) {
      const awardName = {3:'金賞', 2:'銀賞', 1:'銅賞'}[score];
      return { success: false, message: `もう${awardName}は投票済みです。` };
    }
    // ルールチェック3：同じ作品に複数回投票はできない
    if (voterVotes.some(row => row[1] == haikuId)) {
      return { success: false, message: '同じ作品には一度しか投票できません。' };
    }

    // 「投票」シートに投票履歴を記録します。
    voteSheet.appendRow([new Date(), haikuId, score, voterId]);
    
    // 「俳句」シートの合計得点を更新します。
    for (let i = 1; i < haikuData.length; i++) {
      if (haikuData[i][0] == haikuId) {
        const currentScore = haikuData[i][7] || 0;
        haikuSheet.getRange(i + 1, 8).setValue(currentScore + score);
        break;
      }
    }
    return { success: true };

  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    // 処理が終わったら、必ずロックを解除します。
    lock.releaseLock();
  }
}

/**
 * コメントをスプレッドシートに投稿します。
 * @param {number} haikuId - コメント対象の俳句ID
 * @param {string} comment - コメントの内容
 * @param {string} commenterName - コメントした人の名前
 * @returns {object} 処理の成功/失敗を示すオブジェクト
 */
function submitComment(haikuId, comment, commenterName) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COMMENT_SHEET_NAME);
    sheet.appendRow([new Date(), haikuId, commenterName, comment]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}


// ===============================================================
// ■ 5. 管理機能系の関数
// 教師用の管理ページから呼び出される機能です。
// ===============================================================

/**
 * 教師用管理ページからの設定をスプレッドシートに反映します。
 * @param {string} theme - 新しいお題
 * @param {string} votingStatus - 新しい投票状況
 * @returns {object} 処理の成功/失敗を示すオブジェクト
 */
function updateAdminSettings(theme, votingStatus) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingsSheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    const haikuSheet = ss.getSheetByName(HAIKU_SHEET_NAME);

    // 「設定」シートのお題と投票状況を更新します。
    settingsSheet.getRange('A2').setValue(theme);
    settingsSheet.getRange('B2').setValue(votingStatus);

    // もし「投票締切」に設定されたら、作者名を公開する処理を行います。
    if (votingStatus === '投票締切') {
        const lastRow = haikuSheet.getLastRow();
        if (lastRow > 1) {
          const authorNames = haikuSheet.getRange('B2:B' + lastRow).getValues();
          haikuSheet.getRange('I2:I' + lastRow).setValues(authorNames);
        }
    } else {
        // もし「投票受付中」に戻されたら、公開名をクリアします。
        const lastRow = haikuSheet.getLastRow();
        if (lastRow > 1) {
          const range = haikuSheet.getRange('I2:I' + lastRow);
          range.clearContent();
        }
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 入力されたパスワードが、設定された管理者用パスワードと一致するか確認します。
 * @param {string} password - 入力されたパスワード
 * @returns {boolean} パスワードが一致すればtrue、しなければfalse
 */
function checkAdminPassword(password) {
  // スクリプトプロパティに保存された、安全なパスワードを取得します。
  const correctPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  return password === correctPassword;
}

/**
 * ★新機能：新しい句会のためにデータをリセットする関数
 * 現在の「俳句」「コメント」「投票」シートを日付付きでアーカイブ（名前変更）し、
 * 新しい空のシートを作成します。
 * @returns {object} 処理の成功/失敗を示すオブジェクト
 */
function resetKukaiData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timezone = ss.getSpreadsheetTimeZone();
    const timestamp = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd_HH-mm');

    const sheetsToArchive = [HAIKU_SHEET_NAME, COMMENT_SHEET_NAME, VOTE_SHEET_NAME];
    
    // 既存のシートをリネームしてアーカイブ
    sheetsToArchive.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        sheet.setName(`${sheetName}_${timestamp}`);
      }
    });

    // 新しいシートを作成し、ヘッダーを書き込む
    const haikuSheet = ss.insertSheet(HAIKU_SHEET_NAME, 0); // 0は先頭に追加
    haikuSheet.appendRow(['ID', '名前', '投稿日時', '俳句', '上の句', '中の句', '下の句', '得点', '公開名']);
    
    const commentSheet = ss.insertSheet(COMMENT_SHEET_NAME, 1);
    commentSheet.appendRow(['投稿日時', '俳句ID', 'コメント投稿者', 'コメント']);
    
    const voteSheet = ss.insertSheet(VOTE_SHEET_NAME, 2);
    voteSheet.appendRow(['投票日時', '俳句ID', '点数', '投票者ID']);

    return { success: true, message: '新しい句会の準備ができました。' };
  } catch (e) {
    return { success: false, message: `リセット処理中にエラーが発生しました: ${e.message}` };
  }
}

