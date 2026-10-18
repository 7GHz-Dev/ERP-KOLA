/*
 * ตัวบันทึกขั้นตอน — ฉีดเข้าทุกหน้า (และทุก iframe) ของ Chrome ที่ worker เปิด
 *
 * เขียนเป็น JavaScript ล้วนเพราะถูกส่งเข้าเบราว์เซอร์ตรง ๆ ไม่ผ่านตัวแปลง TypeScript
 * คุยกับ worker ผ่าน window.__kolaRec(...) ซึ่ง worker ผูกไว้ด้วย exposeBinding
 * สถานะการบันทึกและรายการขั้นอยู่ฝั่ง worker จึงไม่หายเมื่อหน้าเปลี่ยน
 *
 * เก็บ "ช่องไหน" (ชื่อปุ่ม ป้ายช่อง placeholder css) ไม่เก็บพิกัดบนจอ
 * ไม่เก็บค่าที่พิมพ์ในช่องรหัสผ่าน
 */
(() => {
  if (window.__kolaRecorderInstalled) return;
  window.__kolaRecorderInstalled = true;

  const isTop = window.top === window;
  let active = false;      // worker อยู่ในโหมดบันทึก
  // กดเริ่มบันทึกแล้วหรือยัง — ใช้แค่แสดงบนแถบเครื่องมือ ส่วนการตัดสินว่าเก็บขั้นไหนอยู่ที่ worker
  // (iframe ที่โหลดก่อนกดเริ่มจะไม่รู้ว่าเริ่มแล้ว ถ้าตัดสินที่หน้าเว็บจะตกหล่น)
  let recording = false;
  let count = 0;
  let host = null;         // กล่องแถบเครื่องมือ — เหตุการณ์ในกล่องนี้ไม่ถูกบันทึก
  let pending = null;      // ช่องที่กำลังพิมพ์อยู่ ยังไม่ได้ส่งเป็นขั้น

  const call = (msg) => (typeof window.__kolaRec === 'function' ? window.__kolaRec(msg) : Promise.resolve(null));

  /* ---------------- อ่านข้อมูลของช่อง ---------------- */

  const clean = (s, max = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

  const TEXT_TYPES = ['', 'text', 'email', 'tel', 'url', 'search', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week'];
  const isTextField = (el) => el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && TEXT_TYPES.includes((el.getAttribute('type') || '').toLowerCase()));
  const isPassword = (el) => el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'password';
  const isFileInput = (el) => el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'file';

  function implicitRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'SELECT') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (el.hasAttribute('list')) return 'combobox';
      if (TEXT_TYPES.includes(type) && type !== 'password') return 'textbox';
    }
    return '';
  }

  function byIdIn(el, id) {
    const root = el.getRootNode();
    return (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id);
  }

  function labelText(el) {
    const parts = [];
    if (el.labels && el.labels.length) for (const l of el.labels) parts.push(l.innerText);
    else {
      const wrap = el.closest && el.closest('label');
      if (wrap) parts.push(wrap.innerText);
    }
    return clean(parts.join(' ').replace(/\*/g, ''));
  }

  function accName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by.split(/\s+/).map((id) => byIdIn(el, id)).filter(Boolean).map((n) => n.innerText || n.textContent).join(' ');
      if (clean(text)) return clean(text);
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return clean(el.value);
      const label = labelText(el);
      if (label) return label;
      return clean(el.getAttribute('placeholder') || el.getAttribute('title'));
    }
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    const img = el.querySelector && el.querySelector('img[alt]');
    return clean(el.getAttribute('title') || (img && img.getAttribute('alt')));
  }

  const UNSTABLE_ID = /\d{2,}|^[a-f0-9-]{16,}$|^(ember|react|ext-|j_id|input-|combobox-|button-)/i;

  function cssPath(el) {
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && depth < 5; depth++) {
      if (cur.id && !UNSTABLE_ID.test(cur.id)) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      let part = cur.tagName.toLowerCase();
      for (const attr of ['name', 'data-testid', 'data-id', 'type']) {
        const v = cur.getAttribute(attr);
        if (v && v.length < 60 && !UNSTABLE_ID.test(v)) { part += `[${attr}="${CSS.escape(v)}"]`; break; }
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  /** ทุกช่องที่ตรง selector ไล่ลึกเข้า shadow DOM ตามลำดับเดียวกับที่ Playwright ไล่ */
  function deepAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.matches(selector)) out.push(child);
        if (child.shadowRoot) visit(child.shadowRoot);
        visit(child);
      }
    };
    visit(document);
    return out;
  }

  function describe(el) {
    if (isFileInput(el)) {
      const nth = deepAll('input[type="file"]').indexOf(el);
      return { css: 'input[type="file"]', nth: nth < 0 ? 0 : nth, label: labelText(el) || undefined };
    }
    const target = {};
    const role = implicitRole(el);
    const name = accName(el);
    if (role) target.role = role;
    if (role && name) target.name = name;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const label = labelText(el) || clean(el.getAttribute('aria-label'));
      if (label) target.label = label;
      const ph = clean(el.getAttribute('placeholder'));
      if (ph) target.placeholder = ph;
    }
    if (!role || !name) {
      const text = clean(el.innerText || el.textContent, 80);
      if (text) target.text = text;
    }
    target.css = cssPath(el);
    return target;
  }

  /* ---------------- ส่งขั้นให้ worker ---------------- */

  function send(step) {
    call({ kind: 'step', step }).then((res) => { if (res && typeof res.count === 'number') setCount(res.count); });
  }

  function flushPending() {
    if (!pending) return;
    const { el, target } = pending;
    pending = null;
    send({ type: 'fill', target, value: el.value == null ? String(el.textContent || '') : String(el.value) });
  }

  const INTERACTIVE = 'button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=option],'
    + '[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],'
    + '[role=combobox],[role=switch],[role=treeitem],[role=gridcell],[role=listitem],[onclick]';

  /** ตัวที่ถูกกดจริง — ไล่ขึ้นจากจุดที่กดจนเจอปุ่ม/ลิงก์/ช่อง ทะลุ shadow DOM */
  function pickTarget(event) {
    const path = event.composedPath().filter((n) => n instanceof Element);
    for (const node of path) {
      if (node === document.body || node === document.documentElement) break;
      if (node.matches(INTERACTIVE)) return node;
    }
    return path[0] || null;
  }

  const fromToolbar = (event) => host && event.composedPath().includes(host);

  function textOf(el) {
    // ข้อความสั้นที่สุดที่ยังมีความหมาย — กดโดนข้อความในกล่องใหญ่ก็ได้แค่ข้อความนั้น
    let cur = el;
    while (cur && cur instanceof Element) {
      const t = clean(cur.innerText || cur.textContent, 200);
      if (t) return t.length <= 120 ? t : t.slice(0, 120);
      cur = cur.parentElement;
    }
    return '';
  }

  /* ---------------- ฟังเหตุการณ์ของหน้า ---------------- */

  function topMode() {
    try { return window.top.__kolaMode || null; } catch { return null; }
  }
  function setTopMode(mode) {
    try { window.top.__kolaMode = mode; } catch { /* คนละโดเมน */ }
    if (isTop) renderMode();
  }

  function onPointer(event) {
    if (!active || fromToolbar(event)) return;
    const el = pickTarget(event);
    if (!el) return;
    const mode = topMode();

    if (mode === 'wait' || mode === 'submit') {
      // กดเพื่อชี้ ไม่ได้กดจริง — โดยเฉพาะปุ่มส่ง จะได้ไม่ส่งจริงตอนบันทึก
      event.preventDefault();
      event.stopImmediatePropagation();
      flushPending();
      if (mode === 'wait') {
        const text = textOf(event.composedPath()[0] instanceof Element ? event.composedPath()[0] : el);
        if (text) send({ type: 'waitText', text });
      } else {
        send({ type: 'submit', target: describe(el) });
      }
      setTopMode(null);
      return;
    }

    // คลิกเข้าช่องพิมพ์ เลือกรายการ หรือช่องไฟล์ ไม่ต้องเก็บ ค่าที่ใส่จะถูกเก็บเป็นขั้นของมันเอง
    if (isTextField(el) || el.tagName === 'SELECT' || isFileInput(el) || el.isContentEditable) return;
    if (el.tagName === 'LABEL' && el.control && (isTextField(el.control) || el.control.tagName === 'SELECT')) return;
    if (pending && pending.el !== el) flushPending();
    send({ type: 'click', target: describe(el) });
  }

  /** กันคลิกจริงตามหลัง pointerdown ในโหมดชี้ */
  function onClick(event) {
    if (!active || fromToolbar(event)) return;
    if (window.__kolaSwallowClick) {
      window.__kolaSwallowClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // กด Enter ที่ปุ่ม (ไม่มี pointerdown) ก็ถือเป็นคลิก
    if (event.detail === 0 && event.isTrusted) {
      const el = pickTarget(event);
      if (el && implicitRole(el) === 'button') {
        flushPending();
        send({ type: 'click', target: describe(el) });
      }
    }
  }

  function onInput(event) {
    if (!active || fromToolbar(event)) return;
    const el = event.composedPath()[0];
    if (!(el instanceof Element)) return;
    if (isPassword(el)) return;
    if (isFileInput(el)) {
      const names = [...(el.files || [])].map((f) => f.name).join(', ');
      flushPending();
      send({ type: 'upload', target: describe(el), file: 'DO_MERGED', note: names ? `ไฟล์ตอนบันทึก: ${names}`.slice(0, 200) : undefined });
      return;
    }
    if (el.tagName === 'SELECT') {
      flushPending();
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (opt) send({ type: 'select', target: describe(el), value: clean(opt.text, 300) });
      return;
    }
    if (isTextField(el) || el.isContentEditable) {
      if (pending && pending.el !== el) flushPending();
      pending = { el, target: describe(el) };
    }
  }

  function onFocusOut(event) {
    if (pending && event.composedPath()[0] === pending.el) flushPending();
  }

  document.addEventListener('pointerdown', (e) => {
    const mode = topMode();
    if (active && (mode === 'wait' || mode === 'submit') && !fromToolbar(e)) window.__kolaSwallowClick = true;
    onPointer(e);
  }, true);
  // โหมดชี้ — กันไม่ให้ปุ่มของเว็บรับ mousedown/mouseup ด้วย บางเว็บทำงานตั้งแต่ตอนกดลง
  for (const type of ['mousedown', 'mouseup']) {
    document.addEventListener(type, (e) => {
      if (window.__kolaSwallowClick && !fromToolbar(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', (e) => {
    // ช่องที่ไม่ส่ง input (บางเว็บ) — ใช้ change แทน ถ้า input ยังไม่ได้เก็บไว้
    const el = e.composedPath()[0];
    if (el instanceof Element && (el.tagName === 'SELECT' || isFileInput(el))) return;
    if (el instanceof Element && isTextField(el) && !pending) {
      onInput(e);
      flushPending();
    }
  }, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('pagehide', flushPending);

  /* ---------------- แถบเครื่องมือ (หน้าบนสุดเท่านั้น) ---------------- */

  let ui = null;

  function setCount(n) {
    count = n;
    if (ui) ui.count.textContent = String(count);
  }

  function renderMode() {
    if (!ui) return;
    const mode = topMode();
    ui.status.textContent = !recording ? 'ยังไม่เริ่ม — ล็อกอิน/ไปหน้าที่จะเริ่มก่อน'
      : mode === 'wait' ? 'คลิกข้อความที่ต้องรอให้ขึ้น'
      : mode === 'submit' ? 'คลิกปุ่มส่งของเว็บ (จะไม่ส่งจริง)'
      : 'กำลังบันทึก';
    ui.dot.style.background = recording ? '#e5484d' : '#a4a097';
    ui.start.textContent = recording ? 'พัก' : 'เริ่มบันทึก';
    for (const b of [ui.wait, ui.submit, ui.pause, ui.undo]) b.disabled = !recording;
  }

  function buildToolbar() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .bar{font:13px system-ui,sans-serif;background:#1f1d1a;color:#fff;border-radius:10px;padding:10px 12px;
          box-shadow:0 6px 24px rgba(0,0,0,.3);display:grid;gap:8px;min-width:250px}
        .head{display:flex;align-items:center;gap:8px;font-weight:600}
        .dot{width:10px;height:10px;border-radius:50%}
        .count{margin-left:auto;background:#7b3fe4;border-radius:999px;padding:1px 8px;font-size:12px}
        .status{color:#cfcac0;font-size:12px}
        .row{display:flex;flex-wrap:wrap;gap:6px}
        button{font:inherit;font-size:12px;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;background:#3a3631;color:#fff}
        button:disabled{opacity:.4;cursor:default}
        .primary{background:#7b3fe4}
        .done{background:#1aae39}
      </style>
      <div class="bar">
        <div class="head"><span class="dot"></span>KOLA บันทึกขั้นตอน<span class="count">0</span></div>
        <div class="status"></div>
        <div class="row">
          <button class="primary" data-a="start"></button>
          <button data-a="wait" title="คลิกข้อความบนหน้าที่ต้องรอให้ขึ้นก่อนไปขั้นถัดไป (หรือลากคลุมข้อความก่อนกด)">+ รอข้อความ</button>
          <button data-a="submit" title="ชี้ปุ่มส่งขั้นสุดท้าย — ระบบจะไม่กดจริงตอนบันทึก">+ ปุ่มส่ง</button>
        </div>
        <div class="row">
          <button data-a="pause" title="ขั้นที่ให้คนทำเอง เช่นกรอก OTP">+ หยุดให้คนทำ</button>
          <button data-a="undo">ย้อน 1 ขั้น</button>
          <button class="done" data-a="finish">จบและบันทึก</button>
        </div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    ui = {
      dot: $('.dot'), count: $('.count'), status: $('.status'),
      start: $('[data-a=start]'), wait: $('[data-a=wait]'), submit: $('[data-a=submit]'),
      pause: $('[data-a=pause]'), undo: $('[data-a=undo]'), finish: $('[data-a=finish]'),
    };
    ui.start.onclick = async () => {
      flushPending();
      const res = await call({ kind: recording ? 'stop' : 'start', url: location.href });
      if (res) { recording = res.recording; setCount(res.count); }
      renderMode();
    };
    ui.wait.onclick = () => {
      const sel = clean(String(window.getSelection() || ''), 200);
      if (sel) { send({ type: 'waitText', text: sel }); window.getSelection().removeAllRanges(); return; }
      setTopMode(topMode() === 'wait' ? null : 'wait');
    };
    ui.submit.onclick = () => setTopMode(topMode() === 'submit' ? null : 'submit');
    ui.pause.onclick = () => {
      const message = clean(window.prompt('ข้อความบอกคนว่าต้องทำอะไร (เช่น กรอก OTP จากมือถือ)') || '', 300);
      if (message) { flushPending(); send({ type: 'pause', message }); }
    };
    ui.undo.onclick = async () => {
      pending = null;
      const res = await call({ kind: 'undo' });
      if (res) setCount(res.count);
    };
    ui.finish.onclick = async () => {
      flushPending();
      if (!window.confirm(`จบการบันทึก ${count} ขั้น แล้วส่งเข้า ERP?`)) return;
      await call({ kind: 'finish' });
      host.remove();
    };
    (document.body || document.documentElement).appendChild(host);
    renderMode();
    setCount(count);
  }

  call({ kind: 'hello' }).then((res) => {
    if (!res || !res.active) return;
    active = true;
    recording = res.recording;
    count = res.count;
    if (!isTop) return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildToolbar, { once: true });
    else buildToolbar();
  });
})();
