/**
 * สะพานเชื่อม google.script.run ของจริง สำหรับใช้ตอนรันบน localhost
 *
 * แทนที่ preview-mock.js โดยส่งทุก rpc ไปที่ /api ของ dev server
 * ซึ่งจะ forward ต่อไปยัง Apps Script web app แล้วคุยกับ Google Sheets ตัวจริง
 *
 * รูปแบบ error ที่ reject กลับไปเป็น "CODE|ข้อความ" เหมือนที่ handleError() รออยู่
 */
(function () {
  var ENDPOINT = '/api';

  function fileToBlobMarker(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('READ_FAILED|อ่านไฟล์ไม่สำเร็จ'));
      };
      reader.onload = function () {
        var result = String(reader.result);
        var comma = result.indexOf(',');
        resolve({
          __blob: true,
          base64: comma >= 0 ? result.slice(comma + 1) : '',
          name: file.name,
          mimeType: file.type || 'application/octet-stream'
        });
      };
      reader.readAsDataURL(file);
    });
  }

  /** แปลง <form> เป็น object แบบเดียวกับที่ google.script.run ของจริงส่งให้ฝั่ง .gs */
  function serializeForm(form) {
    var out = {};
    var pending = [];
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'file') {
        var file = el.files && el.files[0];
        if (file) {
          pending.push(fileToBlobMarker(file).then(function (marker) {
            out[el.name] = marker;
          }));
        }
        return;
      }
      if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      out[el.name] = el.value;
    });
    return Promise.all(pending).then(function () { return out; });
  }

  function prepareArgs(args) {
    return Promise.all(args.map(function (arg) {
      if (typeof HTMLFormElement !== 'undefined' && arg instanceof HTMLFormElement) {
        return serializeForm(arg);
      }
      if (typeof File !== 'undefined' && arg instanceof File) {
        return fileToBlobMarker(arg);
      }
      return arg;
    }));
  }

  function invoke(fn, args, onSuccess, onFailure) {
    prepareArgs(args).then(function (prepared) {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fn: fn, args: prepared })
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          throw new Error('HTTP_' + res.status + '|เรียก API ไม่สำเร็จ (HTTP ' + res.status + ') ' + text.slice(0, 200));
        }
        var payload;
        try {
          payload = JSON.parse(text);
        } catch (parseError) {
          throw new Error('BAD_RESPONSE|ตอบกลับไม่ใช่ JSON: ' + text.slice(0, 200));
        }
        if (!payload.ok) throw new Error(payload.error || 'ERROR|เกิดข้อผิดพลาด');
        return payload.data;
      });
    }).then(function (data) {
      if (onSuccess) onSuccess(data);
    }).catch(function (error) {
      if (onFailure) onFailure(error); else console.error('[live-bridge]', error);
    });
  }

  function runner(success, failure) {
    return new Proxy({}, {
      get: function (_target, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(fn, failure); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(success, fn); };
        return function () {
          invoke(String(prop), Array.prototype.slice.call(arguments), success, failure);
        };
      }
    });
  }

  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: function () { return runner(); } });
  console.info('[live-bridge] เชื่อมกับ Google Sheets ตัวจริงผ่าน ' + ENDPOINT);
}());
