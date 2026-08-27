function getSpreadsheet_() {
  return SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  assert_(sheet, 'SETUP_REQUIRED', 'ยังไม่พบชีต ' + sheetName + ' กรุณารัน setupSystem()');
  return sheet;
}

function sheetExists_(sheetName) {
  return Boolean(getSpreadsheet_().getSheetByName(sheetName));
}

/**
 * อ่านตารางแบบยอมให้ชีตยังไม่มี
 * ใช้กับชีตที่เพิ่งเพิ่มเข้ามาในเวอร์ชันใหม่ ซึ่งจะยังไม่ถูกสร้างจนกว่าจะรัน setupSystem()
 * ป้องกันไม่ให้ทั้งแอปล่มระหว่างที่ยังไม่ได้รัน setup
 */
function getTableSafe_(sheetName) {
  return sheetExists_(sheetName) ? getTable_(sheetName) : [];
}

function getHeaders_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
}

function getTable_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0].map(String);
  return values.slice(1).map(function (row, index) {
    var record = { _rowNumber: index + 2 };
    headers.forEach(function (header, column) {
      record[header] = serializeValue_(row[column]);
    });
    return record;
  }).filter(function (record) {
    return Object.keys(record).some(function (key) {
      return key !== '_rowNumber' && record[key] !== '' && record[key] !== null;
    });
  });
}

function findById_(sheetName, id) {
  var key = cleanText_(id);
  return getTable_(sheetName).filter(function (record) {
    return String(record.id) === key;
  })[0] || null;
}

function findOne_(sheetName, predicate) {
  var records = getTable_(sheetName);
  for (var i = 0; i < records.length; i += 1) {
    if (predicate(records[i])) return records[i];
  }
  return null;
}

function appendRecord_(sheetName, record) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheetName);
  var row = headers.map(function (header) {
    return safeCell_(record[header] === undefined ? '' : record[header]);
  });
  sheet.appendRow(row);
  return serializeRecord_(record);
}

function updateRecord_(sheetName, id, patch) {
  var record = findById_(sheetName, id);
  assert_(record, 'NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheetName);
  var row = headers.map(function (header) {
    var value = Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : record[header];
    return safeCell_(value === undefined ? '' : value);
  });
  sheet.getRange(record._rowNumber, 1, 1, headers.length).setValues([row]);
  return serializeRecord_(headers.reduce(function (output, header, index) {
    output[header] = row[index];
    return output;
  }, {}));
}

function ensureSheet_(sheetName, headers) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (typeof sheet.getMaxColumns === 'function' && sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
    headers.forEach(function (header, index) {
      assert_(!current[index] || current[index] === header, 'SCHEMA_MISMATCH',
        'หัวคอลัมน์ชีต ' + sheetName + ' ไม่ตรงที่คอลัมน์ ' + (index + 1));
    });
    if (sheet.getLastColumn() < headers.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, headers.length - sheet.getLastColumn())
        .setValues([headers.slice(sheet.getLastColumn())]);
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#16324f')
    .setFontColor('#ffffff')
    .setWrap(false);
  if (!sheet.getFilter() && sheet.getLastRow() >= 1) {
    sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), headers.length).createFilter();
  }
  sheet.autoResizeColumns(1, Math.min(headers.length, 12));
  return sheet;
}

function nextJobNumber_() {
  var year = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy');
  var prefix = 'KOLA';
  var sequence = findOne_(APP_CONFIG.SHEETS.JOB_SEQUENCES, function (row) {
    return String(row.year) === year && String(row.prefix) === prefix;
  });
  var next = sequence ? toNumber_(sequence.lastNumber, 0) + 1 : 1;
  if (sequence) {
    updateRecord_(APP_CONFIG.SHEETS.JOB_SEQUENCES, sequence.id, {
      lastNumber: next,
      updatedAt: nowIso_()
    });
  } else {
    appendRecord_(APP_CONFIG.SHEETS.JOB_SEQUENCES, {
      id: newId_('SEQ'),
      year: year,
      prefix: prefix,
      lastNumber: next,
      updatedAt: nowIso_()
    });
  }
  return prefix + '-' + year + '-' + ('0000' + next).slice(-4);
}
