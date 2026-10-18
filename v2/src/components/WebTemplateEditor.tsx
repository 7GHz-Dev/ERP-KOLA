'use client';

import { useState, type FormEvent } from 'react';
import { saveWebTemplate } from '@/lib/actions/web-template';
import {
  BUTTON_PAGES, definitionSchema, describeTarget, firstIssue, INPUT_ASSISTS, JOB_VARS, STEP_TYPES,
  type Step, type StepType, type Target, type TemplateInput, type WebTemplateDefinition,
} from '@/lib/web-template';

/**
 * หน้าแก้ Template กรอกเว็บ
 *
 * แก้ทั้งชุดในเบราว์เซอร์ แล้วส่งเป็น JSON ก้อนเดียวตอนกดบันทึก
 * ตรวจด้วยตัวตรวจเดียวกับฝั่งเซิร์ฟเวอร์ก่อนส่ง จะได้เห็นว่าผิดขั้นไหนโดยไม่ต้องรอโหลดหน้าใหม่
 * มีแท็บ JSON ไว้ให้คนที่อยากแก้ตรง ๆ หรือคัดลอก Template ไปอีกเครื่อง
 */

type Draft = WebTemplateDefinition;
type AnyStep = Step & Record<string, any>;

const ROLE_HINTS = ['button', 'link', 'textbox', 'combobox', 'option', 'checkbox', 'radio', 'tab', 'menuitem'];

/** ขั้นใหม่ตามชนิด — เปลี่ยนชนิดแล้วยังเก็บวิธีหาช่องเดิมไว้ */
function blankStep(type: StepType, from?: AnyStep): Step {
  const target: Target = from?.target ?? { role: 'button', name: '' };
  switch (type) {
    case 'goto': return { type, url: 'https://' };
    case 'click': return { type, target };
    case 'fill': return { type, target, value: from?.value ?? '' };
    case 'select': return { type, target, value: from?.value ?? '' };
    case 'upload': return { type, target: from?.target ?? { css: 'input[type="file"]', nth: 0 }, file: 'DO_MERGED' };
    case 'waitText': return { type, text: from?.text ?? '' };
    case 'waitFor': return { type, target };
    case 'press': return { type, target, key: 'Enter' };
    case 'submit': return { type, target: from?.target ?? { role: 'button', name: 'Submit' } };
    case 'pause': return { type, message: 'ทำขั้นนี้เอง แล้วกดทำต่อ' };
  }
}

export function WebTemplateEditor({
  id, name: initialName, isActive: initialActive, raw, definition, fileCategories, roles,
}: {
  id: string;
  name: string;
  isActive: boolean;
  raw: string | null;
  definition: WebTemplateDefinition | null;
  /** [หมวด, ชื่อที่อ่านออก] */
  fileCategories: [string, string][];
  roles: string[];
}) {
  const [name, setName] = useState(initialName);
  const [isActive, setIsActive] = useState(initialActive);
  const [def, setDef] = useState<Draft | null>(definition);
  const [tab, setTab] = useState<'form' | 'json'>(definition ? 'form' : 'json');
  const [json, setJson] = useState(() => (definition ? JSON.stringify(definition, null, 2) : raw ?? ''));
  const [problem, setProblem] = useState('');

  const patch = (p: Partial<Draft>) => setDef((d) => (d ? { ...d, ...p } : d));
  const patchButton = (p: Partial<Draft['button']>) => setDef((d) => (d ? { ...d, button: { ...d.button, ...p } } : d));
  const setSteps = (fn: (steps: Step[]) => Step[]) => setDef((d) => (d ? { ...d, steps: fn(d.steps) } : d));
  const setInputs = (fn: (inputs: TemplateInput[]) => TemplateInput[]) => setDef((d) => (d ? { ...d, inputs: fn(d.inputs) } : d));

  const openJson = () => {
    if (def) setJson(JSON.stringify(def, null, 2));
    setTab('json');
  };
  /** ใช้ JSON ที่แก้ — ผ่านตัวตรวจแล้วจึงกลับไปหน้าฟอร์ม */
  const applyJson = () => {
    try {
      const parsed = definitionSchema.safeParse(JSON.parse(json));
      if (!parsed.success) { setProblem(firstIssue(parsed.error)); return false; }
      setDef(parsed.data);
      setProblem('');
      return true;
    } catch {
      setProblem('JSON อ่านไม่ได้');
      return false;
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (tab === 'json' && !applyJson()) { event.preventDefault(); return; }
    const current = tab === 'json' ? JSON.parse(json) : def;
    const parsed = definitionSchema.safeParse(current);
    if (!parsed.success) {
      event.preventDefault();
      setProblem(firstIssue(parsed.error));
      return;
    }
    (event.currentTarget.elements.namedItem('definition') as HTMLInputElement).value = JSON.stringify(parsed.data);
  };

  const varOptions = [
    ...JOB_VARS.map((v) => ({ token: `{{job.${v.key}}}`, label: `งาน: ${v.label}` })),
    ...(def?.inputs ?? []).map((i) => ({ token: `{{input.${i.key}}}`, label: `ถาม: ${i.label}` })),
  ];

  return (
    <form action={saveWebTemplate} onSubmit={onSubmit} className="doc-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="definition" defaultValue="" />
      <datalist id="wt-roles">{ROLE_HINTS.map((r) => <option key={r} value={r} />)}</datalist>
      <datalist id="wt-keys">{['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Space'].map((k) => <option key={k} value={k} />)}</datalist>

      <div className="doc-form-bar">
        <span>{def ? `${def.steps.length} ขั้นตอน` : 'JSON ยังไม่ผ่านตัวตรวจ'}</span>
        <div className="tabs wt-tabs">
          <a href="#form" aria-current={tab === 'form' ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); if (tab === 'json' && !applyJson()) return; setTab('form'); }}>ฟอร์ม</a>
          <a href="#json" aria-current={tab === 'json' ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); openJson(); }}>JSON</a>
        </div>
        <button className="button primary" type="submit">บันทึก</button>
      </div>
      {problem ? <div className="alert-bar bad" role="alert"><span>{problem}</span></div> : null}

      <fieldset className="doc-form-group">
        <legend>ทั่วไป</legend>
        <div className="doc-form-grid">
          <label className="field">
            <span>ชื่อ Template</span>
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </label>
          <label className="field wt-check">
            <input type="checkbox" name="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>เปิดใช้ — ปุ่มขึ้นในหน้างาน</span>
          </label>
          {def && tab === 'form' ? (
            <>
              <label className="field wide">
                <span>ลิงก์หน้าแรก</span>
                <input value={def.startUrl} onChange={(e) => patch({ startUrl: e.target.value })} />
              </label>
              <label className="field">
                <span>ข้อความที่เห็นเมื่อล็อกอินแล้ว</span>
                <input value={def.loggedInText ?? ''} onChange={(e) => patch({ loggedInText: e.target.value })}
                  placeholder="เช่น Create new request" />
                <small>ไม่เห็นใน 20 วินาที worker จะรอให้คนล็อกอินก่อน · ว่าง = ไม่ตรวจ</small>
              </label>
              <label className="field">
                <span>รูปแบบเลขอ้างอิงหลังส่ง (regex)</span>
                <input value={def.refPattern ?? ''} onChange={(e) => patch({ refPattern: e.target.value })}
                  placeholder="Request number[:\s]+([A-Z0-9-]+)" />
                <small>กลุ่มแรกในวงเล็บคือเลขที่เก็บ · ว่าง = ไม่เก็บ</small>
              </label>
            </>
          ) : null}
        </div>
      </fieldset>

      {tab === 'json' ? (
        <fieldset className="doc-form-group">
          <legend>JSON</legend>
          <textarea className="wt-json" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} rows={28} />
        </fieldset>
      ) : def ? (
        <>
          <fieldset className="doc-form-group">
            <legend>ปุ่ม</legend>
            <div className="doc-form-grid">
              <label className="field">
                <span>ข้อความบนปุ่ม</span>
                <input value={def.button.label} onChange={(e) => patchButton({ label: e.target.value })} maxLength={60} />
              </label>
              <label className="field">
                <span>วางปุ่มที่หน้า</span>
                <select value={def.button.page} onChange={(e) => patchButton({ page: e.target.value as 'do-exchange' })}>
                  {BUTTON_PAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>แสดงเฉพาะงานที่ SHIPLINE ตรงกับ (regex)</span>
                <input value={def.button.shiplinePattern ?? ''} onChange={(e) => patchButton({ shiplinePattern: e.target.value })}
                  placeholder="\b(ONE)\b — ว่าง = ทุกงาน" />
              </label>
              <label className="field">
                <span>ต้องมีไฟล์ก่อนจึงกดได้</span>
                <select value={def.button.requireFile ?? ''} onChange={(e) => patchButton({ requireFile: e.target.value })}>
                  <option value="">- ไม่บังคับ -</option>
                  {fileCategories.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <div className="field wide">
                <span>คนที่เห็นปุ่ม (ADMIN เห็นเสมอ)</span>
                <div className="wt-roles">
                  {roles.map((r) => (
                    <label key={r} className="wt-check">
                      <input type="checkbox" checked={def.button.roles.includes(r)}
                        onChange={(e) => patchButton({
                          roles: e.target.checked ? [...def.button.roles, r] : def.button.roles.filter((x) => x !== r),
                        })} />
                      <span>{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="field wide wt-check">
                <input type="checkbox" checked={def.button.markDoExchanged}
                  onChange={(e) => patchButton({ markDoExchanged: e.target.checked })} />
                <span>ส่งสำเร็จแล้วย้ายงานไปแท็บ “ส่งแลก DO แล้ว” (เก็บภาพหน้าจอเป็นหลักฐานทุกครั้ง)</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="doc-form-group">
            <legend>ช่องที่ถามตอนกดปุ่ม</legend>
            <p className="meta wt-help">
              ค่าที่ระบบไม่รู้เอง เช่นเลขอ้างอิงในสลิป · ใช้ในขั้นตอนด้วย <code>{'{{input.ชื่อตัวแปร}}'}</code>
            </p>
            {def.inputs.map((input, i) => (
              <div key={i} className="wt-input-row">
                <input value={input.key} placeholder="ชื่อตัวแปร (a-z)" aria-label="ชื่อตัวแปร"
                  onChange={(e) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <input value={input.label} placeholder="ข้อความที่ถาม" aria-label="ข้อความที่ถาม" className="grow"
                  onChange={(e) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <select value={input.assist ?? ''} aria-label="ตัวช่วย"
                  onChange={(e) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, assist: e.target.value as TemplateInput['assist'] } : x)))}>
                  {INPUT_ASSISTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <label className="wt-check">
                  <input type="checkbox" checked={Boolean(input.multiline)}
                    onChange={(e) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, multiline: e.target.checked } : x)))} />
                  <span>หลายบรรทัด</span>
                </label>
                <button type="button" className="button tiny" aria-label="ลบ"
                  onClick={() => setInputs((list) => list.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="button tiny"
              onClick={() => setInputs((list) => [...list, { key: `value${list.length + 1}`, label: '' }])}>+ เพิ่มช่อง</button>
          </fieldset>

          <fieldset className="doc-form-group">
            <legend>ขั้นตอน</legend>
            <p className="meta wt-help">
              worker เล่นจากบนลงล่าง · ช่องหาจากชื่อปุ่ม/ป้ายช่องก่อน แล้วค่อยถอยไป CSS ·
              คลิกจะรอให้ปุ่มกดได้เอง · “ปุ่มส่ง” คือขั้นที่โหมดปกติรอคนกดเอง และทดลองรันจะหยุดก่อนถึง
            </p>
            {def.steps.length === 0 ? <p className="empty">ยังไม่มีขั้นตอน — กด “บันทึกขั้นตอน” ด้านบน หรือเพิ่มเอง</p> : null}
            <ol className="wt-steps">
              {def.steps.map((step, i) => (
                <StepRow
                  key={i}
                  index={i}
                  step={step as AnyStep}
                  last={i === def.steps.length - 1}
                  varOptions={varOptions}
                  fileCategories={fileCategories}
                  onChange={(next) => setSteps((s) => s.map((x, j) => (j === i ? next : x)))}
                  onMove={(dir) => setSteps((s) => {
                    const copy = [...s];
                    const [item] = copy.splice(i, 1);
                    copy.splice(i + dir, 0, item);
                    return copy;
                  })}
                  onRemove={() => setSteps((s) => s.filter((_, j) => j !== i))}
                  onInsert={() => setSteps((s) => [...s.slice(0, i + 1), blankStep('click'), ...s.slice(i + 1)])}
                />
              ))}
            </ol>
            <div className="wt-add">
              {STEP_TYPES.map((t) => (
                <button key={t.key} type="button" className="button tiny"
                  onClick={() => setSteps((s) => [...s, blankStep(t.key)])}>+ {t.label}</button>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}
    </form>
  );
}

function StepRow({
  index, step, last, varOptions, fileCategories, onChange, onMove, onRemove, onInsert,
}: {
  index: number;
  step: AnyStep;
  last: boolean;
  varOptions: { token: string; label: string }[];
  fileCategories: [string, string][];
  onChange: (s: Step) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onInsert: () => void;
}) {
  const set = (p: Record<string, unknown>) => onChange({ ...step, ...p } as Step);
  const setTarget = (p: Partial<Target>) => set({ target: { ...step.target, ...p } });
  const hasTarget = 'target' in step;

  /** ช่องค่าที่แทรกตัวแปรได้ */
  const valueField = (key: 'value' | 'text', label: string) => (
    <div className="field wide wt-value">
      <span>{label}</span>
      <div className="wt-value-row">
        <input value={step[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} />
        <select value="" aria-label="แทรกตัวแปร" onChange={(e) => { if (e.target.value) set({ [key]: `${step[key] ?? ''}${e.target.value}` }); }}>
          <option value="">+ ตัวแปร</option>
          {varOptions.map((v) => <option key={v.token} value={v.token}>{v.label}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <li className={`wt-step wt-${step.type}`}>
      <div className="wt-step-head">
        <b>{index + 1}</b>
        <select value={step.type} onChange={(e) => onChange(blankStep(e.target.value as StepType, step))} aria-label="ชนิดขั้น">
          {STEP_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        {hasTarget ? <span className="wt-target-sum">{describeTarget(step.target)}</span> : <span className="wt-target-sum" />}
        <div className="wt-step-tools">
          <button type="button" className="button tiny" disabled={index === 0} onClick={() => onMove(-1)} aria-label="เลื่อนขึ้น">↑</button>
          <button type="button" className="button tiny" disabled={last} onClick={() => onMove(1)} aria-label="เลื่อนลง">↓</button>
          <button type="button" className="button tiny" onClick={onInsert} title="แทรกขั้นใหม่ด้านล่าง">+</button>
          <button type="button" className="button tiny" onClick={onRemove} aria-label="ลบขั้น">✕</button>
        </div>
      </div>

      <div className="doc-form-grid wt-step-body">
        {step.type === 'goto' ? (
          <label className="field wide"><span>ลิงก์</span>
            <input value={step.url} onChange={(e) => set({ url: e.target.value })} />
          </label>
        ) : null}
        {step.type === 'fill' ? valueField('value', 'ค่าที่กรอก') : null}
        {step.type === 'select' ? valueField('value', 'ตัวเลือกที่เลือก') : null}
        {step.type === 'waitText' ? valueField('text', 'ข้อความที่รอให้ขึ้น') : null}
        {step.type === 'press' ? (
          <label className="field"><span>คีย์</span>
            <input value={step.key} list="wt-keys" onChange={(e) => set({ key: e.target.value })} />
          </label>
        ) : null}
        {step.type === 'pause' ? (
          <label className="field wide"><span>บอกคนว่าต้องทำอะไร</span>
            <input value={step.message} onChange={(e) => set({ message: e.target.value })} />
          </label>
        ) : null}
        {step.type === 'upload' ? (
          <label className="field"><span>ไฟล์ของงานที่แนบ</span>
            <select value={step.file} onChange={(e) => set({ file: e.target.value })}>
              {fileCategories.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        ) : null}
        {step.type === 'click' ? (
          <label className="field wt-check">
            <input type="checkbox" checked={Boolean(step.optional)} onChange={(e) => set({ optional: e.target.checked || undefined })} />
            <span>ถ้ามี — หาไม่เจอก็ข้าม</span>
          </label>
        ) : null}
        <label className="field"><span>รอสูงสุด (วินาที)</span>
          <input type="number" min={1} max={600} value={step.timeout ?? ''} placeholder="30"
            onChange={(e) => set({ timeout: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <label className="field"><span>หมายเหตุ</span>
          <input value={step.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>

      {hasTarget ? (
        <details className="wt-target">
          <summary>วิธีหาช่องบนหน้า</summary>
          <div className="doc-form-grid">
            <label className="field wide"><span>Playwright locator (แม่นที่สุด — ลองทางนี้ก่อน)</span>
              <input value={step.target.locator ?? ''} onChange={(e) => setTarget({ locator: e.target.value })}
                placeholder="getByRole('button', { name: 'Add' })" spellCheck={false} />
              <small>คัดลอกจาก Playwright codegen ปุ่ม Pick locator ได้เลย · ช่องอื่นด้านล่างเป็นทางสำรอง</small>
            </label>
            <label className="field"><span>role</span>
              <input list="wt-roles" value={step.target.role ?? ''} onChange={(e) => setTarget({ role: e.target.value })} />
            </label>
            <label className="field"><span>ชื่อปุ่ม/ช่อง (name)</span>
              <input value={step.target.name ?? ''} onChange={(e) => setTarget({ name: e.target.value })} />
              <small>ปุ่ม/ลิงก์ = ตัวหนังสือบนปุ่ม · ช่องกรอก = ป้ายข้างช่อง</small>
            </label>
            <label className="field"><span>ป้ายช่อง (label)</span>
              <input value={step.target.label ?? ''} onChange={(e) => setTarget({ label: e.target.value })} />
              <small>ใช้กับช่องกรอก/เลือก — ตัวหนังสือที่เขียนกำกับช่อง</small>
            </label>
            <label className="field"><span>placeholder</span>
              <input value={step.target.placeholder ?? ''} onChange={(e) => setTarget({ placeholder: e.target.value })} />
            </label>
            <label className="field"><span>ข้อความ (text)</span>
              <input value={step.target.text ?? ''} onChange={(e) => setTarget({ text: e.target.value })} />
            </label>
            <label className="field wide"><span>CSS หรือ XPath (ทางสุดท้าย)</span>
              <input value={step.target.css ?? ''} onChange={(e) => setTarget({ css: e.target.value })}
                placeholder='เช่น #search-btn หรือ //button[@id="search"]' />
              <small>คลิกขวาที่ช่อง → Inspect → คลิกขวาที่โค้ด → Copy → Copy selector หรือ Copy XPath</small>
            </label>
            <label className="field"><span>ลำดับที่ (ถ้า CSS ซ้ำ เริ่ม 0)</span>
              <input type="number" min={0} max={50} value={step.target.nth ?? ''}
                onChange={(e) => setTarget({ nth: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </label>
            <label className="field"><span>iframe (ต้นของลิงก์)</span>
              <input value={step.target.frame ?? ''} onChange={(e) => setTarget({ frame: e.target.value })} />
            </label>
          </div>
        </details>
      ) : null}
    </li>
  );
}
