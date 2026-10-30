/**
 * NETBAY (KOLA) จำลองสำหรับเทสต์ worker สร้าง Draft ใบขน — ยกมาจาก tests/mock_netbay.py ของ imp
 *
 * โครงหน้าเว็บสร้างตาม XPath ที่โปรแกรมเดิมใช้และที่ตรวจกับหน้าจริง (ไม่ใช่หน้าจริงของ NETBAY)
 * ใช้ตรวจว่าทุกขั้นทำได้: login, iframe, autocomplete, ช่องวันที่แบบ mask, แนบไฟล์, ข้อความ success,
 * ค้นหา Reference No. แล้วเปิดใบขน  ค่าที่กรอกและไฟล์ที่ได้รับเก็บไว้ใน state
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import JSZip from 'jszip';

export const IMPORTER = 'บริษัท เเม่สอด ฟรีโซน จำกัด';
export const REF_NO = 'QENX000000099';

/**
 * แถวของใบขนในหน้ารายการ (ตัว monitor ใบขน) — ป้ายสถานะเป็นรูป แบบหน้าจริง
 * code = ค่าที่ช่อง Status ของ NETBAY ใช้กรอง · image = src ของรูปป้าย · declarationNo = คอลัมน์ DECLARATION NO
 */
export type MockStatus = { code: string; image: string; declarationNo?: string };

export type MockState = {
  login: [string, string] | null;
  decl: Record<string, string> | null;
  upload: Buffer | null;
  created: number; saved: number; sentToCustoms: boolean; searched: string[];
  importOk: boolean;
  declarations: Record<string, string>;     // เลขภายใน (ImDclCtrl) -> Reference No.
  statuses: Record<string, MockStatus>;     // Reference No. -> สถานะ (ไม่มี = กำลังเตรียมเอกสาร)
  /** การกด Save PDF แต่ละครั้ง: แถวที่ติ๊ก + ตัวเลือกช่อง "ชื่อไฟล์" */
  pdfRequests: { refs: string[]; fileName: string }[];
};

/** PDF เล็กที่สุดที่ยังขึ้นต้นด้วย %PDF- — พอให้ตรวจว่าแตก zip ได้ไฟล์ที่ถูก */
export const mockPdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, 'latin1');

const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

const SAVE_BAR = `<input id="referenceNo" name="referenceNo" value="${REF_NO}">` +
  `<input id="saveBTN" type="button" value="F12 [Save]" onclick="fetch('/save').then(() => location.reload())">`;

function declPage() {
  const rows = [
    row(['r1']),
    row(['ผู้นำเข้า', `<input name="importer_search" onkeydown="if(event.key=='ArrowDown')document.getElementById('list').style.display='block'">`]),
    row(['r3']), row(['r4']),
    row(['a', '<select name="s5a"><option value="0">0</option><option value="1">1</option></select>',
      'b', '<select name="s5b"><option value="0">0</option><option value="9">9</option></select>']),
    row(['vessel', '<input name="vessel">']),
    row(['voyage', '<input id="ins_voyage" name="voyage">', 'bl', '<input name="bl">']),
    row(['origin', '<input name="origin1">', 'origin2', '<input name="origin2">']),
    row(['arrival', '<input id="ins_arrivalDate" name="arrival" value="00-00-0000" maxlength="10" style="width: 80px">',
      'port', '<input name="release_port">']),
    row(['pkg', '<font><input name="pkg_amount"><input name="pkg_unit"></font>']),
    row(['r11']),
    row(['gw', '<font><input name="gw1"></font>']),
    row(['gw2', '<font><input name="gw2"></font>']),
    ...[14, 15, 16, 17, 18].map((i) => row([`r${i}`])),
    row(['price', '<font><input name="price"><input name="currency"></font>']),
  ];
  return `<html><body>${SAVE_BAR}
<div id="declTypeID"><font><select name="decl_type"><option value="">-</option><option value="610">610</option></select></font></div>
<div id="declarationDIV"><table><tbody>${rows.join('')}</tbody></table></div>
<div id="list" style="display:none"><table><tbody>
 <tr id="tr1" ondblclick="document.querySelector('#importerDetail input').value='${IMPORTER}'"><td>1</td><td>0635561000645</td><td>MAESOT FREE ZONE</td></tr>
</tbody></table></div>
<div id="importerDetail"><font><input name="importer_name"></font></div>
<button id="addInvoice" onclick="save()">Add invoice</button>
<script>
// ช่องวันที่มี input mask แบบหน้าจริง: ว่าง = __-__-____  ตัวเลขลงที่ตำแหน่ง cursor  ข้าม '-'  ไม่ครบตอน blur = ล้าง
const MASK = '__-__-____', date = document.getElementById('ins_arrivalDate');
date.addEventListener('focus', () => { if (date.value === '00-00-0000' || date.value === '') date.value = MASK; });
date.addEventListener('input', () => { if (date.value === '') date.value = MASK; });
date.addEventListener('blur', () => { if (date.value.includes('_')) date.value = ''; });
date.addEventListener('keydown', e => {
  if (e.key.length !== 1) return;
  e.preventDefault();
  if (!/[0-9]/.test(e.key)) return;
  let i = date.selectionStart;
  while (i < MASK.length && MASK[i] !== '_') i++;
  if (i >= MASK.length) return;
  date.value = date.value.slice(0, i) + e.key + date.value.slice(i + 1);
  i++; while (i < MASK.length && MASK[i] !== '_') i++;
  date.setSelectionRange(i, i);
});
function save() {
  const data = new URLSearchParams();
  document.querySelectorAll('input,select').forEach(e => { if (e.name) data.append(e.name, e.value); });
  fetch('/save_decl', {method: 'POST', body: data}).then(() => location = '/upload_form');
}
</script></body></html>`;
}

// ปุ่ม Import อยู่ที่ /html/body/table/tbody/tr[4]/td[2]/div/form/table/tbody/tr/td/table/tbody/tr[5]/td[2]/input[2]
const UPLOAD_FORM = `<html><body><table><tbody>
<tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr>
<tr><td>4</td><td><div><form method="post" action="/upload" enctype="multipart/form-data"><table><tbody><tr><td>
 <table><tbody>
  <tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr>
  <tr><td>file</td><td><div id="maptypeDiv2"><input type="file" name="file"></div></td></tr>
  <tr><td>go</td><td><input type="button" value="ยกเลิก"><input type="submit" value="Import"></td></tr>
 </tbody></table>
</td></tr></tbody></table></form></div></td></tr>
</tbody></table></body></html>`;

const readBody = (req: IncomingMessage) => new Promise<Buffer>((resolve) => {
  const parts: Buffer[] = [];
  req.on('data', (c: Buffer) => parts.push(c));
  req.on('end', () => resolve(Buffer.concat(parts)));
});

/** เนื้อไฟล์แรกใน multipart/form-data */
function multipartFile(body: Buffer, type: string) {
  const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(type)![1]}`);
  const start = body.indexOf(boundary);
  const head = body.indexOf('\r\n\r\n', start) + 4;
  const end = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), head);
  return body.subarray(head, end);
}

export async function startMockNetbay(): Promise<{ url: string; state: MockState; close(): Promise<void> }> {
  const state: MockState = {
    login: null, decl: null, upload: null, created: 0, saved: 0, sentToCustoms: false, searched: [],
    importOk: true, declarations: { 16399: REF_NO, 16300: 'QENX000000042' },
    statuses: {}, pdfRequests: [],
  };
  const statusOf = (ref: string): MockStatus => state.statuses[ref] ?? { code: 'PREPARE', image: '/images/st_prepare.gif' };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const html = (s: string) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(s); };
    const p = url.pathname;
    if (p === '/' && req.method === 'GET') {
      return html(`<html><body>
<form method="post" action="/login"><input id="user" name="user"><input id="passwd" name="passwd" type="password">
<img src="/btn.gif" usemap="#m" width="60" height="20"></form>
<map name="m"><area shape="rect" coords="0,0,60,20" href="javascript:document.forms[0].submit()"></map>
</body></html>`);
    }
    if (p === '/login') {
      const f = new URLSearchParams((await readBody(req)).toString());
      state.login = [f.get('user') ?? '', f.get('passwd') ?? ''];
      return html(`<html><body><div id="smoothmenu1"><ul><li>a</li><li>b</li><li>c<ul>
<li>1</li><li>2</li><li>3</li><li>4</li><li><a href="/import?uid=1&amp;mode=imp">ใบขนขาเข้า</a></li>
</ul></li></ul></div></body></html>`);
    }
    if (p === '/import') {
      // หน้ารายการใบขน: ช่องค้นหา Reference No. (sREF) + แถวละใบ (statusPic<id> value=<ref>)
      const ref = url.searchParams.get('sREF');
      const want = url.searchParams.get('sStatus') ?? '';
      if (ref !== null) state.searched.push(ref);
      const rows = Object.entries(state.declarations)
        .filter(([, r]) => (!ref || r === ref) && (!want || statusOf(r).code === want))
        .map(([id, r]) => {
          const st = statusOf(r);
          return `<tr><td><input type="checkbox" name="sel" value="${id}"><img src="/images/print.gif"></td>`
            + `<td><img id="statusPic${id}" value="${r}" src="${st.image}" onclick="editID('${id}')"></td>`
            + `<td><a href="#">${r}</a></td><td></td><td>${st.declarationNo ?? ''}</td></tr>`;
        }).join('');
      const codes = ['ACCEPT', 'CANCEL_REJECT', 'CANCELED', 'ERROR', 'IMPREJECT', 'PREPARE', 'REJECT', 'SEND', 'SEND_CANCEL', 'VALIDATED', 'DRAFT_CANCEL'];
      /*
       * ข้อความบนหน้านี้ต้องสั้น — เทสต์ worker สร้าง Draft อ่านข้อความทั้งหน้า (ตัดที่ 300 ตัวอักษร)
       * เพื่อหาข้อความ error ของ Import ที่อยู่ใน iframe ท้ายหน้า ตัวเลือก Status จึงไม่มีข้อความ มีแต่ value
       * ช่อง "จาก" มี "เลขที่ใบขนฯ" (มี ฯ) ไว้ตรวจว่าตัว monitor ไม่เลือกผิดช่องตอนตั้งชื่อไฟล์
       */
      return html(`<html><body>
<form method="get" action="/import">
 <select name="sFrom"><option value="decl">เลขที่ใบขนฯ</option></select>
 <select name="sStatus"><option value=""></option>${codes.map((c) => `<option value="${c}"></option>`).join('')}</select>
 <input type="text" id="invno1TXT" name="sREF"><input type="submit" id="refreshBTN" value="Search"></form>
<table><tbody><tr><td></td><td></td><td></td><td></td><td>DECLARATION NO</td></tr>${rows}</tbody></table>
<input type="button" value="Save XML"> <input type="button" value="Save PDF" onclick="savePdf()">
ชื่อไฟล์ <select id="fileNameSel"><option value="0">default</option><option value="1">เลขที่ใบขน</option></select>
<script>function editID(id) { location = "/workspace?SELITEM=ImDclCtrl:" + id; }
function savePdf() {
  const ids = Array.from(document.querySelectorAll('input[name=sel]:checked')).map(b => b.value);
  if (!ids.length) { alert('กรุณาเลือกรายการ'); return; }
  location = '/save_pdf?ids=' + ids.join(',') + '&name=' + document.getElementById('fileNameSel').value;
}</script>
<button id="newBTN" onclick="document.getElementById('area').style.display='block';detailfrm.location='/decl?ImDclCtrl=16399'">New</button>
<div id="area" style="display:none">
 <div id="outLineTree"><font><div><table><tbody><tr><td><div><font><b>
   <span onclick="detailfrm.location='/decl?ImDclCtrl=16399'">ROOT</span></b></font></div></td></tr></tbody></table></div></font></div>
 <iframe id="detailfrm" name="detailfrm" width="900" height="700"></iframe>
 <input id="sendCustomsBTN" type="button" value="Send to Customs" onclick="fetch('/send_customs')">
</div></body></html>`);
    }
    if (p === '/decl') { state.created += 1; return html(declPage()); }      // กด New = NETBAY สร้างใบขน 1 ใบ
    if (p === '/save_decl') {
      state.decl = Object.fromEntries(new URLSearchParams((await readBody(req)).toString()));
      return html('ok');
    }
    if (p === '/upload_form') return html(UPLOAD_FORM);
    if (p === '/upload') {
      state.upload = multipartFile(await readBody(req), req.headers['content-type'] ?? '');
      return html(`<html><body>${state.importOk ? 'Success!! Please check your invoice' : 'Error: invalid file format'}
<input id="refreshInvBTN" type="button" value="Refresh"></body></html>`);
    }
    if (p === '/workspace') {
      const id = (url.searchParams.get('SELITEM') ?? '').split(':')[1];
      return html(`<html><body><div id="outLineTree">ROOT</div><iframe id="detailfrm" name="detailfrm" src="/edit?ImDclCtrl=${id}"></iframe></body></html>`);
    }
    if (p === '/edit') return html(`<html><body><input id="referenceNo" value="${state.declarations[url.searchParams.get('ImDclCtrl') ?? '']}"></body></html>`);
    if (p === '/save') { state.saved += 1; return html('ok'); }
    if (p === '/send_customs') { state.sentToCustoms = true; return html('ok'); }
    if (p === '/save_pdf') {
      // ได้ zip ที่มี PDF ต่อใบ ชื่อไฟล์ตามช่อง "ชื่อไฟล์": เลขที่ใบขน = <เลขใบขน>.pdf · default = <Ref No.>.pdf
      const refs = (url.searchParams.get('ids') ?? '').split(',').map((id) => state.declarations[id]).filter(Boolean);
      const byDecl = url.searchParams.get('name') === '1';
      state.pdfRequests.push({ refs, fileName: byDecl ? 'เลขที่ใบขน' : 'default' });
      const zip = new JSZip();
      const folder = zip.folder('_runtime_temp_20261030034633')!;
      for (const r of refs) {
        const decl = statusOf(r).declarationNo ?? r;
        folder.file(`${byDecl ? decl : r}.pdf`, mockPdf(`ใบขน ${decl}`));
      }
      const body = await zip.generateAsync({ type: 'nodebuffer' });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="_runtime_temp_20261030034633.zip"',
      });
      return res.end(body);
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`, state,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
