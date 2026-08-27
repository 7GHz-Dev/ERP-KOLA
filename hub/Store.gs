function hubSpreadsheet_() {
  var id = hubProp_(HUB_CONFIG.PROP.SPREADSHEET_ID);
  hubAssert_(id, 'SETUP_REQUIRED', 'ยังไม่ได้ตั้งค่า Hub กรุณารัน hubSetup()');
  return SpreadsheetApp.openById(id);
}

function hubFolder_() {
  var id = hubProp_(HUB_CONFIG.PROP.FOLDER_ID);
  hubAssert_(id, 'SETUP_REQUIRED', 'ยังไม่ได้ตั้งค่า Hub กรุณารัน hubSetup()');
  return DriveApp.getFolderById(id);
}

function hubSheet_(name) {
  var sheet = hubSpreadsheet_().getSheetByName(name);
  hubAssert_(sheet, 'SETUP_REQUIRED', 'ไม่พบชีต ' + name + ' กรุณารัน hubSetup()');
  return sheet;
}

function hubHeaders_(name) {
  var sheet = hubSheet_(name);
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
}

function hubTable_(name) {
  var sheet = hubSheet_(name);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0].map(String);
  return values.slice(1).map(function (row, index) {
    var record = { _rowNumber: index + 2 };
    headers.forEach(function (header, column) {
      var value = row[column];
      record[header] = value instanceof Date ? value.toISOString() : (value === null || value === undefined ? '' : value);
    });
    return record;
  }).filter(function (record) {
    return hubText_(record.id) !== '';
  });
}

function hubFindById_(name, id) {
  var key = hubText_(id);
  if (!key) return null;
  return hubTable_(name).filter(function (row) {
    return String(row.id) === key;
  })[0] || null;
}

function hubAppend_(name, record) {
  var sheet = hubSheet_(name);
  var headers = hubHeaders_(name);
  sheet.appendRow(headers.map(function (header) {
    return hubSafeCell_(record[header] === undefined ? '' : record[header]);
  }));
  return record;
}

function hubUpdate_(name, id, patch) {
  var record = hubFindById_(name, id);
  hubAssert_(record, 'NOT_FOUND', 'ไม่พบงาน ' + id);
  var sheet = hubSheet_(name);
  var headers = hubHeaders_(name);
  var row = headers.map(function (header) {
    var value = Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : record[header];
    return hubSafeCell_(value === undefined ? '' : value);
  });
  sheet.getRange(record._rowNumber, 1, 1, headers.length).setValues([row]);
  return headers.reduce(function (out, header, index) {
    out[header] = row[index];
    return out;
  }, {});
}

function hubEnsureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
    headers.forEach(function (header, index) {
      hubAssert_(!current[index] || current[index] === header, 'SCHEMA_MISMATCH',
        'หัวคอลัมน์ชีต ' + name + ' ไม่ตรงที่คอลัมน์ ' + (index + 1));
    });
    if (sheet.getLastColumn() < headers.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, headers.length - sheet.getLastColumn())
        .setValues([headers.slice(sheet.getLastColumn())]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#16324f').setFontColor('#ffffff');
  return sheet;
}

function hubLog_(taskId, actor, action, detail) {
  try {
    hubAppend_(HUB_CONFIG.SHEETS.LOG, {
      id: hubId_('LOG'),
      taskId: taskId || '',
      actor: actor || '',
      action: action || '',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
      createdAt: hubNow_()
    });
  } catch (ignore) {
    // log ล้มเหลวไม่ควรทำให้งานหลักล้ม
  }
}
