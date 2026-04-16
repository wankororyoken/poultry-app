// ===================================================
// 養鶏管理アプリ - Google Apps Script バックエンド
// ===================================================

// ★ スプレッドシートのIDを設定してください
const SPREADSHEET_ID = '1C5Aa1dZ15utX3jUEZQn17ljTBzlddjUCUmGypfaPf-s';

// ★ デプロイ時にバージョンを更新してください（例: 'v2', 'v3-fix'）
const APP_VERSION = 'v1';

// シート名
const SHEETS = {
  採卵: '採卵記録',
  餌: '餌記録',
  死鶏: '死鶏記録',
  入力者: '入力者',
  メモ: 'メモ記録',
  設定: '設定'
};

// ===================================================
// Webアプリのエントリーポイント
// ===================================================
function doGet(e) {
  if (e.parameter.action === 'version') {
    return ContentService.createTextOutput(APP_VERSION);
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('養鶏管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
}

// ===================================================
// 初期化：シートのヘッダーを作成
// ===================================================
function initSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let sheet = getOrCreateSheet(ss, SHEETS.採卵);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '時間帯', '鶏舎', '採卵数', '入力者', '入力日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f3f3f3');
  }

  sheet = getOrCreateSheet(ss, SHEETS.餌);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '時間帯', '鶏舎', '餌の量(kg)', '入力者', '入力日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f3f3f3');
  }

  sheet = getOrCreateSheet(ss, SHEETS.死鶏);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '鶏舎', '死鶏数', '入力者', '入力日時']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f3f3f3');
  }

  sheet = getOrCreateSheet(ss, SHEETS.入力者);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['入力者名']);
    sheet.getRange(1, 1).setFontWeight('bold').setBackground('#f3f3f3');
    ['田中', '鈴木', '佐藤', '山田'].forEach(name => sheet.appendRow([name]));
  }

  sheet = getOrCreateSheet(ss, SHEETS.メモ);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '鶏舎', 'タブ', 'メモ', '入力者', '入力日時']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f3f3f3');
  }

  sheet = getOrCreateSheet(ss, SHEETS.設定);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['鶏舎', '規定量(kg)']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#f3f3f3');
  }

  return '初期化完了';
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// ===================================================
// 設定（餌の規定量）取得・保存
// ===================================================
function getSettings() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.設定);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, feedDefaults: {} };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const feedDefaults = {};
    rows.forEach(row => { if (row[0]) feedDefaults[String(row[0])] = row[1]; });
    return { success: true, feedDefaults };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function saveSettings(payload) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.設定);
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
    }
    payload.feedDefaults.forEach(item => {
      if (item.value !== '' && item.value !== null && item.value !== undefined) {
        sheet.appendRow([item.room, Number(item.value)]);
      }
    });
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ===================================================
// 入力者リストの取得
// ===================================================
function getWorkers() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.入力者);
    if (!sheet || sheet.getLastRow() <= 1) return [];
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    return data.map(row => row[0]).filter(v => v !== '');
  } catch (e) {
    return [];
  }
}

// ===================================================
// データ読み込み（日付指定）
// prevDate: 前日の日付文字列（餌のフォールバック用）
// 戻り値: {
//   eggs: { '午前': { '1号室': 値, ... }, '午後': { ... } },
//   feed: { '午前': { ... }, '午後': { ... } },
//   feedSource: 'today' | 'yesterday' | 'none',
//   dead: { '1号室': 値, ... },
//   hasData: bool
// }
// ===================================================
// 日付を yyyy-MM-dd 形式に正規化（Date型・スラッシュ・ハイフンすべて対応）
function normDate(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val).replace(/\//g, '-').trim();
}

function loadData(dateStr, prevDate) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const normTarget = normDate(dateStr);
    const normPrev   = normDate(prevDate);

    const result = {
      eggs: { '午前': {}, '午後': {} },
      feed: { '午前': {}, '午後': {} },
      feedSource: 'none',
      dead: {},
      hasData: false
    };

    // 採卵
    const eggSheet = ss.getSheetByName(SHEETS.採卵);
    if (eggSheet && eggSheet.getLastRow() > 1) {
      eggSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (normDate(row[0]) === normTarget && result.eggs[row[1]]) {
          result.eggs[row[1]][row[2]] = row[3];
          result.hasData = true;
        }
      });
    }

    // 餌：当日データを優先、なければ前日データを初期値として使用
    const feedSheet = ss.getSheetByName(SHEETS.餌);
    if (feedSheet && feedSheet.getLastRow() > 1) {
      const feedRows = feedSheet.getDataRange().getValues().slice(1);

      feedRows.forEach(row => {
        if (normDate(row[0]) === normTarget && result.feed[row[1]]) {
          result.feed[row[1]][row[2]] = row[3];
          result.feedSource = 'today';
          result.hasData = true;
        }
      });

      if (result.feedSource === 'none' && normPrev) {
        feedRows.forEach(row => {
          if (normDate(row[0]) === normPrev && result.feed[row[1]]) {
            result.feed[row[1]][row[2]] = row[3];
            result.feedSource = 'yesterday';
            result.hasData = true;
          }
        });
      }
    }

    // 死鶏
    const deadSheet = ss.getSheetByName(SHEETS.死鶏);
    if (deadSheet && deadSheet.getLastRow() > 1) {
      deadSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (normDate(row[0]) === normTarget) {
          result.dead[row[1]] = row[2];
          result.hasData = true;
        }
      });
    }

    // メモ（鶏舎ごと・タブごと）
    // memo: { eggs: { '1~3番': 'テキスト', ... }, feed: {...}, dead: {...} }
    const memoSheet = ss.getSheetByName(SHEETS.メモ);
    result.memo = { eggs: {}, feed: {}, dead: {} };
    if (memoSheet && memoSheet.getLastRow() > 1) {
      memoSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (normDate(row[0]) === normTarget) {
          const room = row[1], tab = row[2], text = row[3];
          if (result.memo[tab]) result.memo[tab][room] = text;
        }
      });
    }

    return { success: true, data: result };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ===================================================
// データ保存（上書き：同日の既存データを削除してから追加）
// ===================================================
function saveData(payload) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const now = new Date();
    const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    const dateStr = payload.date;

    const normTarget = normDate(dateStr);

    // 採卵：同日・同時間帯・同鶏舎の行を上書き
    if (payload.eggs && payload.eggs.length > 0) {
      const sheet = ss.getSheetByName(SHEETS.採卵);
      const keys = new Set(payload.eggs.map(r => `${r.period}__${r.room}`));
      deleteMatchingRows(sheet, row =>
        normDate(row[0]) === normTarget && keys.has(`${row[1]}__${row[2]}`)
      );
      payload.eggs.forEach(row =>
        sheet.appendRow([dateStr, row.period, row.room, Number(row.value), payload.worker, nowStr])
      );
    }

    // 餌：同日・同時間帯・同鶏舎の行を上書き
    if (payload.feed && payload.feed.length > 0) {
      const sheet = ss.getSheetByName(SHEETS.餌);
      const keys = new Set(payload.feed.map(r => `${r.period}__${r.room}`));
      deleteMatchingRows(sheet, row =>
        normDate(row[0]) === normTarget && keys.has(`${row[1]}__${row[2]}`)
      );
      payload.feed.forEach(row =>
        sheet.appendRow([dateStr, row.period, row.room, Number(row.value), payload.worker, nowStr])
      );
    }

    // 死鶏：同日・同鶏舎の行を上書き
    if (payload.dead && payload.dead.length > 0) {
      const sheet = ss.getSheetByName(SHEETS.死鶏);
      const rooms = new Set(payload.dead.map(r => r.room));
      deleteMatchingRows(sheet, row =>
        normDate(row[0]) === normTarget && rooms.has(row[1])
      );
      payload.dead.forEach(row =>
        sheet.appendRow([dateStr, row.room, Number(row.value), payload.worker, nowStr])
      );
    }

    // メモ保存（鶏舎×タブごとに上書き）
    if (payload.memos && payload.memos.length > 0) {
      const memoSheet = ss.getSheetByName(SHEETS.メモ);
      const memoKeys = new Set(payload.memos.map(m => `${m.tab}__${m.room}`));
      deleteMatchingRows(memoSheet, row =>
        normDate(row[0]) === normTarget && memoKeys.has(`${row[2]}__${row[1]}`)
      );
      payload.memos.forEach(m => {
        if (m.text !== '') {
          memoSheet.appendRow([dateStr, m.room, m.tab, m.text, payload.worker, nowStr]);
        }
      });
    }

    return { success: true, message: '保存しました' };
  } catch (e) {
    return { success: false, message: 'エラー: ' + e.toString() };
  }
}

// ヘッダー行を除いた行を後ろから走査して条件一致行を削除
function deleteMatchingRows(sheet, matchFn) {
  if (sheet.getLastRow() <= 1) return;
  const allRows = sheet.getDataRange().getValues();
  for (let i = allRows.length - 1; i >= 1; i--) {
    if (matchFn(allRows[i])) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ===================================================
// サマリーデータ取得（直近N日分）
// 戻り値: {
//   dates: ['2025-04-01', ...],
//   eggs:  [{ date, total }],
//   feed:  [{ date, total }],
//   dead:  [{ date, total }]
// }
// ===================================================
function getSummary(days) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    days = days || 30;

    // 対象日付範囲を生成
    const today = new Date();
    const dateSet = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateSet.push(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'));
    }

    // 集計用マップ
    const eggsMap = {}, feedMap = {}, deadMap = {};
    dateSet.forEach(d => { eggsMap[d] = 0; feedMap[d] = 0; deadMap[d] = 0; });

    // 採卵集計
    const eggSheet = ss.getSheetByName(SHEETS.採卵);
    if (eggSheet && eggSheet.getLastRow() > 1) {
      eggSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (eggsMap[d] !== undefined) eggsMap[d] += Number(row[3]) || 0;
      });
    }

    // 餌集計
    const feedSheet = ss.getSheetByName(SHEETS.餌);
    if (feedSheet && feedSheet.getLastRow() > 1) {
      feedSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (feedMap[d] !== undefined) feedMap[d] += Number(row[3]) || 0;
      });
    }

    // 死鶏集計
    const deadSheet = ss.getSheetByName(SHEETS.死鶏);
    if (deadSheet && deadSheet.getLastRow() > 1) {
      deadSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (deadMap[d] !== undefined) deadMap[d] += Number(row[2]) || 0;
      });
    }

    return {
      success: true,
      dates: dateSet,
      eggs: dateSet.map(d => ({ date: d, total: eggsMap[d] })),
      feed: dateSet.map(d => ({ date: d, total: Math.round(feedMap[d] * 10) / 10 })),
      dead: dateSet.map(d => ({ date: d, total: deadMap[d] }))
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ===================================================
// 複数日一括読み込み（クライアントキャッシュ用）
// dates: ['yyyy-MM-dd', ...] の配列
// 戻り値: { success, data: { 'yyyy-MM-dd': { eggs, feed, feedSource, dead, memo, hasData }, ... } }
// ===================================================
function loadDataRange(dates) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const normDates = dates.map(d => normDate(d));
    const dateSet = new Set(normDates);

    const result = {};
    normDates.forEach(nd => {
      result[nd] = {
        eggs: { '午前': {}, '午後': {} },
        feed: { '午前': {}, '午後': {} },
        feedSource: 'none',
        dead: {},
        memo: { eggs: {}, feed: {}, dead: {} },
        hasData: false
      };
    });

    // 採卵
    const eggSheet = ss.getSheetByName(SHEETS.採卵);
    if (eggSheet && eggSheet.getLastRow() > 1) {
      eggSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (dateSet.has(d) && result[d].eggs[row[1]]) {
          result[d].eggs[row[1]][row[2]] = row[3];
          result[d].hasData = true;
        }
      });
    }

    // 餌
    const feedSheet = ss.getSheetByName(SHEETS.餌);
    if (feedSheet && feedSheet.getLastRow() > 1) {
      feedSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (dateSet.has(d) && result[d].feed[row[1]]) {
          result[d].feed[row[1]][row[2]] = row[3];
          result[d].feedSource = 'today';
          result[d].hasData = true;
        }
      });
    }

    // 死鶏
    const deadSheet = ss.getSheetByName(SHEETS.死鶏);
    if (deadSheet && deadSheet.getLastRow() > 1) {
      deadSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (dateSet.has(d)) {
          result[d].dead[row[1]] = row[2];
          result[d].hasData = true;
        }
      });
    }

    // メモ
    const memoSheet = ss.getSheetByName(SHEETS.メモ);
    if (memoSheet && memoSheet.getLastRow() > 1) {
      memoSheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (dateSet.has(d)) {
          const room = row[1], tab = row[2], text = row[3];
          if (result[d].memo[tab]) result[d].memo[tab][room] = text;
        }
      });
    }

    return { success: true, data: result };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ===================================================
// 入力履歴取得（直近N日・セッション単位でグループ化）
// ===================================================
function getHistory(days) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    days = days || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const entries = [];

    // 採卵 (日付, 時間帯, 鶏舎, 採卵数, 入力者, 入力日時)
    const eggSheet = ss.getSheetByName(SHEETS.採卵);
    if (eggSheet && eggSheet.getLastRow() > 1) {
      eggSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (!row[5]) return;
        const ts = row[5] instanceof Date ? row[5] : new Date(String(row[5]).replace(/\//g, '-'));
        if (ts < cutoff) return;
        entries.push({ type: 'eggs', date: normDate(row[0]), period: String(row[1]),
          room: String(row[2]), value: Number(row[3]) || 0,
          worker: String(row[4]), savedAt: Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') });
      });
    }

    // 餌 (日付, 時間帯, 鶏舎, 餌の量, 入力者, 入力日時)
    const feedSheet = ss.getSheetByName(SHEETS.餌);
    if (feedSheet && feedSheet.getLastRow() > 1) {
      feedSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (!row[5]) return;
        const ts = row[5] instanceof Date ? row[5] : new Date(String(row[5]).replace(/\//g, '-'));
        if (ts < cutoff) return;
        entries.push({ type: 'feed', date: normDate(row[0]), period: String(row[1]),
          room: String(row[2]), value: Number(row[3]) || 0,
          worker: String(row[4]), savedAt: Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') });
      });
    }

    // 死鶏 (日付, 鶏舎, 死鶏数, 入力者, 入力日時)
    const deadSheet = ss.getSheetByName(SHEETS.死鶏);
    if (deadSheet && deadSheet.getLastRow() > 1) {
      deadSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (!row[4]) return;
        const ts = row[4] instanceof Date ? row[4] : new Date(String(row[4]).replace(/\//g, '-'));
        if (ts < cutoff) return;
        entries.push({ type: 'dead', date: normDate(row[0]), period: '',
          room: String(row[1]), value: Number(row[2]) || 0,
          worker: String(row[3]), savedAt: Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') });
      });
    }

    // メモ (日付, 鶏舎, タブ, メモ, 入力者, 入力日時)
    const memoSheet = ss.getSheetByName(SHEETS.メモ);
    if (memoSheet && memoSheet.getLastRow() > 1) {
      memoSheet.getDataRange().getValues().slice(1).forEach(row => {
        if (!row[5]) return;
        const ts = row[5] instanceof Date ? row[5] : new Date(String(row[5]).replace(/\//g, '-'));
        if (ts < cutoff) return;
        entries.push({ type: 'memo', date: normDate(row[0]), period: '',
          room: String(row[1]), tab: String(row[2]), value: String(row[3]),
          worker: String(row[4]), savedAt: Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') });
      });
    }

    // データとメモを分離してそれぞれグループ化
    const buildGroups = (list) => {
      list.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      const groups = [], map = {};
      list.forEach(e => {
        const key = `${e.savedAt}__${e.worker}`;
        if (!map[key]) {
          const [datePart, timePart] = e.savedAt.split(' ');
          const [, m, d] = datePart.split('-');
          map[key] = { savedAt: `${parseInt(m)}/${parseInt(d)} ${timePart}`,
            worker: e.worker, date: e.date, items: [] };
          groups.push(map[key]);
        }
        map[key].items.push(e);
      });
      return groups;
    };

    const dataGroups = buildGroups(entries.filter(e => e.type !== 'memo'));
    const memoGroups = buildGroups(entries.filter(e => e.type === 'memo'));

    return { success: true, data: dataGroups, memos: memoGroups };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// ===================================================
// 死鶏累計取得（直近30日・部屋ごと）
// ===================================================
function getDeadMonthly(dateStr) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 直近30日の日付セットを生成
    const base = new Date(dateStr + 'T00:00:00');
    const dateSet = new Set();
    for (let i = 0; i < 30; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      dateSet.add(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'));
    }

    const result = {};
    const sheet = ss.getSheetByName(SHEETS.死鶏);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getDataRange().getValues().slice(1).forEach(row => {
        const d = normDate(row[0]);
        if (dateSet.has(d)) {
          const room = row[1];
          result[room] = (result[room] || 0) + (Number(row[2]) || 0);
        }
      });
    }
    return { success: true, data: result };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}
