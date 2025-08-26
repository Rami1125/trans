// ====== הגדרות גיליון וקבועים ======
// יש לעדכן את ה-ID של גיליון ה-Google Sheets שלך כאן
const SPREADSHEET_ID = '1EeQJ9ZoOl9Ybtt3bchj9d5Pn2CNRN3OGPy0AsTqpqe4';

// שמות הגיליונות בתוך קובץ ה-Sheets שלך
const SHEET_NAME_ORDERS = 'הזמנות';
const SHEET_NAME_CITIES = 'ערים';
const SHEET_NAME_SETTINGS = 'הגדרות';
const SHEET_NAME_ARCHIVE = 'הזמנות בארכיון'; // גיליון חדש לארכיון הזמנות

// ====== נקודת כניסה ראשית (doPost) ======
/**
 * פונקציית ה-Web App הראשית שמקבלת בקשות POST מה-Frontend.
 * מטפלת באימות ומנתבת את הבקשות לפונקציות המתאימות.
 * @param {object} e אירוע הבקשה.
 * @returns {object} תשובה בפורמט JSON.
 */
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload;

    // --- אימות באמצעות טוקן ---
    const clientToken = e.headers['x-crm-token'];
    const settings = getSettings(); // טוען את כל ההגדרות
    const serverToken = settings.appsScriptToken;

    if (!clientToken || clientToken !== serverToken) {
      return jsonResponse({ ok: false, error: 'Unauthorized: Invalid or missing token.' }, 401);
    }
    // --- סיום אימות ---

    let data;
    switch (action) {
      case 'listOrders':
        data = listOrders();
        break;
      case 'saveOrder':
        data = saveOrder(payload);
        break;
      case 'updateStatus':
        data = updateStatus(payload.id, payload.status);
        break;
      case 'deleteOrder':
        data = deleteOrder(payload.id);
        break;
      case 'assignDeliveryNote':
        data = assignDeliveryNote(payload.id, payload.deliveryNoteNo);
        break;
      case 'archiveOrder':
        data = archiveOrder(payload.id);
        break;
      case 'listCities':
        data = listCities();
        break;
      case 'saveCities':
        data = saveCities(payload);
        break;
      case 'getSettings': // ניתן לקרוא הגדרות גם מה-Frontend אם צריך, אך בדרך כלל לא את הטוקן
        data = getSettings();
        // אין להחזיר את הטוקן ל-Frontend מסיבות אבטחה
        delete data.appsScriptToken; 
        break;
      case 'saveSettings':
        data = saveSettings(payload);
        break;
      case 'morningReport':
        data = generateMorningReport(payload.date);
        break;
      default:
        return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);
    }

    return jsonResponse({ ok: true, data: data });

  } catch (error) {
    Logger.log(`Error in doPost: ${error.message}, Stack: ${error.stack}`);
    return jsonResponse({ ok: false, error: `Server error: ${error.message}` }, 500);
  }
}

// ====== פונקציות עזר כלליות לגיליונות ======
/**
 * יוצרת תשובת JSON סטנדרטית.
 * @param {object} obj האובייקט להחזרה כ-JSON.
 * @param {number} statusCode קוד סטטוס HTTP.
 * @returns {GoogleAppsScript.Content.TextOutput} תשובת JSON.
 */
function jsonResponse(obj, statusCode = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  if (statusCode !== 200) {
    // ב-Apps Script אין דרך ישירה להגדיר קוד סטטוס HTTP שאינו 200 עבור ContentService.
    // הפתרון המקובל הוא להחזיר תגובה עם שדה 'ok: false' ולציין את השגיאה בתוך ה-JSON.
    // ה-Frontend יצטרך לפרש את שדה ה-ok.
  }
  return output;
}

/**
 * פותחת גיליון ספציפי ומוודאת את קיומו.
 * @param {string} sheetName שם הגיליון.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} אובייקט הגיליון.
 * @throws {Error} אם הגיליון לא נמצא.
 */
function getSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found.`);
  }
  return sheet;
}

/**
 * ממיר שורת נתונים למבנה אובייקט.
 * @param {Array<string>} headers כותרות העמודות.
 * @param {Array<any>} row שורת נתונים.
 * @returns {object} אובייקט המייצג את השורה.
 */
function sheetRowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = row[i];
  });
  return obj;
}

/**
 * ממיר אובייקט לשורת נתונים עבור הגיליון.
 * @param {Array<string>} headers כותרות העמודות.
 * @param {object} obj האובייקט להמרה.
 * @returns {Array<any>} שורת נתונים.
 */
function objectToSheetRow(headers, obj) {
  return headers.map(header => obj[header] || '');
}

// ====== פונקציות לניהול הזמנות (SHEET_NAME_ORDERS) ======

/**
 * מחזירה את כל ההזמנות מהגיליון הראשי.
 * @returns {Array<object>} מערך של אובייטים המייצגים הזמנות.
 */
function listOrders() {
  const sheet = getSheet(SHEET_NAME_ORDERS);
  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length === 0) return [];

  const headers = values[0];
  const orders = [];
  // מתחיל משורה 1 (אחרי הכותרות)
  for (let i = 1; i < values.length; i++) {
    orders.push(sheetRowToObject(headers, values[i]));
  }
  return orders;
}

/**
 * שומרת הזמנה חדשה או מעדכנת קיימת.
 * @param {object} orderData נתוני ההזמנה.
 * @returns {object} האובייקט של ההזמנה שנשמרה/עודכנה.
 */
function saveOrder(orderData) {
  const sheet = getSheet(SHEET_NAME_ORDERS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  if (!orderData.id) {
    orderData.id = 'ORD_' + Math.random().toString(36).slice(2) + Date.now().toString().slice(-5);
    orderData.createdAt = new Date().toISOString();
  }
  orderData.updatedAt = new Date().toISOString();

  const newRow = objectToSheetRow(headers, orderData);

  const orders = listOrders();
  const rowIndex = orders.findIndex(o => o.id === orderData.id);

  if (rowIndex !== -1) {
    // עדכון הזמנה קיימת (יש לזכור שה-rowIndex של הגיליון הוא +1 בגלל הכותרות)
    sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([newRow]);
    Logger.log(`Order ${orderData.id} updated.`);
  } else {
    // הוספת הזמנה חדשה
    sheet.appendRow(newRow);
    Logger.log(`New order ${orderData.id} added.`);
  }
  return orderData; // מחזיר את האובייקט המעודכן
}

/**
 * מעדכנת את הסטטוס של הזמנה ספציפית.
 * @param {string} orderId מזהה ההזמנה.
 * @param {string} status הסטטוס החדש.
 * @returns {object} ההזמנה המעודכנת.
 * @throws {Error} אם ההזמנה לא נמצאה.
 */
function updateStatus(orderId, status) {
  const sheet = getSheet(SHEET_NAME_ORDERS);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const headers = values[0];
  const idColIndex = headers.indexOf('id');
  const statusColIndex = headers.indexOf('status');
  const updatedAtColIndex = headers.indexOf('updatedAt');

  if (idColIndex === -1 || statusColIndex === -1 || updatedAtColIndex === -1) {
    throw new Error('Missing "id", "status" or "updatedAt" header in Orders sheet.');
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i][idColIndex] === orderId) {
      values[i][statusColIndex] = status;
      values[i][updatedAtColIndex] = new Date().toISOString();
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
      Logger.log(`Status for order ${orderId} updated to ${status}`);
      return sheetRowToObject(headers, values[i]); // החזרת ההזמנה המעודכנת
    }
  }
  throw new Error(`Order with ID ${orderId} not found.`);
}

/**
 * מוחקת הזמנה מהגיליון הראשי.
 * @param {string} orderId מזהה ההזמנה למחיקה.
 * @returns {string} אישור מחיקה.
 * @throws {Error} אם ההזמנה לא נמצאה.
 */
function deleteOrder(orderId) {
  const sheet = getSheet(SHEET_NAME_ORDERS);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const headers = values[0];
  const idColIndex = headers.indexOf('id');

  if (idColIndex === -1) {
    throw new Error('Missing "id" header in Orders sheet.');
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i][idColIndex] === orderId) {
      sheet.deleteRow(i + 1); // +1 כי השורה ה-i ב-values היא שורה i+1 בגיליון (0-based vs 1-based)
      Logger.log(`Order ${orderId} deleted.`);
      return `Order ${orderId} deleted successfully.`;
    }
  }
  throw new Error(`Order with ID ${orderId} not found for deletion.`);
}

/**
 * משייכת מספר תעודת משלוח להזמנה.
 * @param {string} orderId מזהה ההזמנה.
 * @param {string} deliveryNoteNo מספר תעודת המשלוח.
 * @returns {object} ההזמנה המעודכנת.
 * @throws {Error} אם ההזמנה לא נמצאה.
 */
function assignDeliveryNote(orderId, deliveryNoteNo) {
  const sheet = getSheet(SHEET_NAME_ORDERS);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const headers = values[0];
  const idColIndex = headers.indexOf('id');
  const deliveryNoteNoColIndex = headers.indexOf('deliveryNoteNo');
  const updatedAtColIndex = headers.indexOf('updatedAt');

  if (idColIndex === -1 || deliveryNoteNoColIndex === -1 || updatedAtColIndex === -1) {
    throw new Error('Missing "id", "deliveryNoteNo" or "updatedAt" header in Orders sheet.');
  }

  for (let i = 1; i < values.length; i++) {
    if (values[i][idColIndex] === orderId) {
      values[i][deliveryNoteNoColIndex] = deliveryNoteNo;
      values[i][updatedAtColIndex] = new Date().toISOString();
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
      Logger.log(`Delivery note ${deliveryNoteNo} assigned to order ${orderId}.`);
      return sheetRowToObject(headers, values[i]);
    }
  }
  throw new Error(`Order with ID ${orderId} not found to assign delivery note.`);
}

/**
 * מעבירה הזמנה לגיליון הארכיון.
 * @param {string} orderId מזהה ההזמנה לארכיון.
 * @returns {string} אישור ארכיון.
 * @throws {Error} אם ההזמנה לא נמצאה.
 */
function archiveOrder(orderId) {
  const ordersSheet = getSheet(SHEET_NAME_ORDERS);
  const archiveSheet = getSheet(SHEET_NAME_ARCHIVE); // Ensure this sheet exists

  const ordersRange = ordersSheet.getDataRange();
  const ordersValues = ordersRange.getValues();
  const ordersHeaders = ordersValues[0];
  const idColIndex = ordersHeaders.indexOf('id');

  if (idColIndex === -1) {
    throw new Error('Missing "id" header in Orders sheet for archiving.');
  }

  let orderRowToArchive = null;
  let rowIndexInOrdersSheet = -1;

  for (let i = 1; i < ordersValues.length; i++) {
    if (ordersValues[i][idColIndex] === orderId) {
      orderRowToArchive = ordersValues[i];
      rowIndexInOrdersSheet = i + 1; // +1 for 1-based indexing in sheet
      break;
    }
  }

  if (orderRowToArchive) {
    // וודא שכותרות הארכיון תואמות או צור אותן אם אין
    if (archiveSheet.getLastRow() === 0) {
      archiveSheet.appendRow(ordersHeaders);
    }
    archiveSheet.appendRow(orderRowToArchive);
    ordersSheet.deleteRow(rowIndexInOrdersSheet);
    Logger.log(`Order ${orderId} archived.`);
    return `Order ${orderId} archived successfully.`;
  }
  throw new Error(`Order with ID ${orderId} not found for archiving.`);
}


// ====== פונקציות לניהול ערים (SHEET_NAME_CITIES) ======

/**
 * מחזירה את כל הערים והמרחקים שלהן.
 * @returns {Array<object>} מערך של אובייקטים {city: string, distanceKmFromHodHasharon: number}.
 */
function listCities() {
  const sheet = getSheet(SHEET_NAME_CITIES);
  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length === 0) return [];

  const headers = values[0]; // אמור להיות ['city', 'distanceKmFromHodHasharon']
  const cities = [];
  for (let i = 1; i < values.length; i++) {
    cities.push(sheetRowToObject(headers, values[i]));
  }
  return cities;
}

/**
 * שומרת את רשימת הערים החדשה (דורסת את הקיימת).
 * @param {Array<object>} citiesArray מערך של אובייקטים {city, distanceKmFromHodHasharon}.
 * @returns {string} אישור שמירה.
 */
function saveCities(citiesArray) {
  const sheet = getSheet(SHEET_NAME_CITIES);
  // מנקה את כל התוכן למעט הכותרות
  sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).clearContent();

  const headers = ['city', 'distanceKmFromHodHasharon']; // וודא שכותרות אלה קיימות בגיליון הערים
  const rows = citiesArray.map(cityObj => objectToSheetRow(headers, cityObj));

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  Logger.log('Cities data saved.');
  return 'Cities data saved successfully.';
}

// ====== פונקציות לניהול הגדרות (SHEET_NAME_SETTINGS) ======

/**
 * מחזירה את כל הגדרות המערכת כאובייקט.
 * @returns {object} אובייקט עם הגדרות המערכת.
 */
function getSettings() {
  const sheet = getSheet(SHEET_NAME_SETTINGS);
  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length === 0) return {};

  const settings = {};
  // הכותרות אמורות להיות settingName, settingValue
  for (let i = 1; i < values.length; i++) {
    const settingName = values[i][0];
    const settingValue = values[i][1];
    if (settingName) {
      settings[settingName] = settingValue;
    }
  }
  return settings;
}

/**
 * שומרת הגדרות ספציפיות בגיליון ההגדרות.
 * @param {object} settingsData אובייקט עם ההגדרות לעדכון.
 * @returns {string} אישור שמירה.
 */
function saveSettings(settingsData) {
  const sheet = getSheet(SHEET_NAME_SETTINGS);
  const headers = ['settingName', 'settingValue']; // וודא שכותרות אלה קיימות
  const currentSettings = getSettings(); // טוען את ההגדרות הנוכחיות

  // עדכון הגדרות קיימות או הוספת חדשות
  for (const key in settingsData) {
    currentSettings[key] = settingsData[key];
  }

  // מנקה את הגיליון (למעט כותרות) וכותב מחדש
  sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).clearContent();
  const rows = Object.entries(currentSettings).map(([name, value]) => [name, value]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  Logger.log('Settings saved.');
  return 'Settings saved successfully.';
}

// ====== פונקציות ליצירת דוחות ======

/**
 * מחוללת דו"ח בוקר מפורט עבור תאריך נתון.
 * @param {string} dateStr התאריך בפורמט YYYY-MM-DD.
 * @returns {string} טקסט הדו"ח.
 */
function generateMorningReport(dateStr) {
  const orders = listOrders();
  const targetDayOrders = orders.filter(o => o.date === dateStr);

  const aliOrders = targetDayOrders.filter(o => o.driver === 'ALI');
  const hikmatOrders = targetDayOrders.filter(o => o.driver === 'HIKMAT');

  const warehouses = { HARASH: 'החרש', TALMID: 'התלמיד' };
  const warehouseCounts = { HARASH: 0, TALMID: 0 };
  targetDayOrders.forEach(o => {
    if (warehouseCounts.hasOwnProperty(o.warehouse)) {
      warehouseCounts[o.warehouse]++;
    }
  });

  const dayjsDate = dayjs(dateStr); // משתמש בספריית dayjs לטיפול בתאריכים
  const morningPeakOrders = targetDayOrders.filter(o => {
    const orderTime = dayjs(`${o.date} ${o.time}`);
    const startPeak = dayjs(dayjsDate).hour(6);
    const endPeak = dayjs(dayjsDate).hour(9);
    return orderTime.isBetween(startPeak, endPeak, null, '[)'); // כולל 06:00, לא כולל 09:00
  }).length;

  let report = `סיכום הזמנות ליום ${dayjsDate.format('DD/MM/YYYY')}:\n`;
  report += `🚚 עלי: ${aliOrders.length} הזמנות\n`;
  report += `🚛 חכמת: ${hikmatOrders.length} הזמנות\n`;
  report += `📦 סה"כ הזמנות: ${targetDayOrders.length}\n`;
  report += `🏫 מחסן התלמיד: ${warehouseCounts.TALMID} הזמנות\n`;
  report += `🔨 מחסן החרש: ${warehouseCounts.HARASH} הזמנות\n`;
  report += `☀️ הזמנות 06:00-09:00: ${morningPeakOrders} הזמנות\n\n`;
  report += `--------------------\nדוחות בוקר מפורטים\n\n`;

  const formatOrderForReport = (o) => {
    const driverName = (o.driver === 'ALI' ? 'עלי' : 'חכמת');
    const warehouseName = warehouses[o.warehouse] || o.warehouse;
    return `📝 ${driverName} - דוח בוקר\n📅 ${o.date} ⏰ ${o.time} 🏠 ${warehouseName} 📄 מתכונן ליציאה\n👤 ${o.customer} 📍 ${o.city}${o.address?(' – '+o.address):''}\n-----`;
  };

  if (aliOrders.length > 0) {
    report += aliOrders.map(formatOrderForReport).join('\n') + '\n\n';
  }
  if (hikmatOrders.length > 0) {
    report += hikmatOrders.map(formatOrderForReport).join('\n') + '\n\n';
  }

  // כאן ניתן להוסיף קישור סטטי ל-CRM אם תרצה שהדו"ח יכלול גישה מהירה למערכת
  report += `🔗 לוח בקרה CRM: <<YOUR_CRM_BASE_URL>>`; // החלף בכתובת ה-URL של האפליקציה שלך

  return report;
}

// ====== פונקציות נוספות (יכולות לשמש לצורך בדיקה או הרחבות עתידיות) ======
/**
 * פונקציה לדוגמה המופעלת ב-GET request.
 * בדרך כלל Web Apps שמשמשים כ-API עובדים עם POST.
 */
function doGet(e) {
  return jsonResponse({ ok: true, message: 'CRM Apps Script Web App is running!', parameters: e.parameter });
}

// ====== ספריות חיצוניות (dayjs - Apps Script Edition) ======
// כדי להשתמש ב-dayjs ב-Apps Script, יש לייבא אותו כספרייה.
// הוסף את ספריית Day.js באמצעות Resources > Libraries...
// חפש את Project ID: 1jB4t6W7wQJq9E_R9M9wW4g9H9g2L0p0c0o0x0x0w0x0w0x0
// או השתמש בקוד זה (מומלץ לבדוק גרסאות עדכניות יותר):
// https://cdn.jsdelivr.net/npm/dayjs@1.10.7/dayjs.min.js
// לאחר ההוספה, ה-`dayjs` הגלובלי יהיה זמין.
// אם אין לך גישה לספריות חיצוניות, תצטרך ליישם את הפונקציות dayjs בעצמך או להשתמש ב-Date() המובנה של JavaScript.

// הגדרה פשוטה של isBetween (למקרה שאין תמיכה מלאה ב-plugins ב-Apps Script)
// זוהי אימפלימנטציה מינימלית, עבור גרסה מלאה מומלץ להשתמש בספרייה
function dayjs(date) {
  if (typeof date === 'string') {
    date = new Date(date);
  }
  return {
    _date: date,
    format: function(fmt) {
      if (fmt === 'YYYY-MM-DD') {
        return this._date.toISOString().slice(0, 10);
      }
      if (fmt === 'DD/MM/YYYY') {
        const d = this._date;
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
      }
      // הוסף פורמטים נוספים לפי הצורך
      return this._date.toString();
    },
    hour: function(h) {
      const newDate = new Date(this._date);
      newDate.setHours(h, 0, 0, 0);
      return newDate;
    },
    isBetween: function(start, end, unit, inclusivity) {
      const ts = this._date.getTime();
      const startTs = (typeof start === 'object' ? start._date.getTime() : new Date(start).getTime());
      const endTs = (typeof end === 'object' ? end._date.getTime() : new Date(end).getTime());

      let isGreater = ts > startTs;
      let isLess = ts < endTs;

      if (inclusivity && inclusivity.includes('[')) { // כולל התחלה
        isGreater = ts >= startTs;
      }
      if (inclusivity && inclusivity.includes(']')) { // כולל סיום
        isLess = ts <= endTs;
      }
      return isGreater && isLess;
    }
  };
}

// קטע קוד לטעינת dayjs ב-Apps Script (יש להדביק בנפרד ב-Script editor)
/*
// Libraries -> Add a library -> Script ID: 1jB4t6W7wQJq9E_R9M9wW4g9H9g2L0p0c0o0x0x0w0x0w0x0
// Identifier: dayjs (זהו השם הגלובלי של הספרייה)
*/

// אם לא משתמשים בספריית dayjs חיצונית, יש להשתמש בזה:
// הפונקציה dayjs שכבר כתובה למעלה היא מינימלית, יש צורך בהרחבה
// אם ברצונך להשתמש ב dayjs מלא, עליך להוסיף את הספרייה כפי שצוין
// או להשתמש בפונקציות Date() המובנות של JavaScript
