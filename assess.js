// ふらここラボ　アセスメントシート（紙のシートを端末で記入し、PDFにして子どものフォルダに保存する）
// 項目と判断基準はApps Script（コード.gs の ASSESS_SHEET）にあり、職員コードを付けて読み込む。
// 署名の本体（app.js）とは別のファイルにして、署名の画面に影響しないようにしている。
'use strict';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxkxmKBZKmotlZ1VZzkgJIE3wsmdUoNKnrctFxH4T2y3kWxXSUL9lULzHm0ROl8iy2t/exec';

const OFFICE = 'labAssess';
const LAB_NAME = '心を育てるふらここラボ';
const FOOTER = '株式会社ふらここ　心を育てるふらここラボ　秋田市保戸野中町6番13号';
const FOLDER_LABEL = { user: '01_利用者（子どもごと）', trial: '03_相談会・体験（契約前）' };   // 共有ドライブ「ふらここラボ」の中の保存先
const KEY_CODE = 'furakoko_staff_code';
const KEY_STAFF = 'furakoko_staff_name';
const KEY_SHEET = 'furakoko_assess_sheet';
const KEY_DRAFT = 'furakoko_assess_draft';
const MARKS = ['〇', '△', '✕'];
const DAKKO = '抱っこ姿勢';
const FONT_FAMILY = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif';

let SHEET = null, ROWS = [];                // 項目（読み込んだ物）と、それを1行ずつに並べた物
let marks = {}, memos = {};                 // 記入の内容（項目ごと）
let lastPdfBlob = null, lastFileName = '', saveCount = 0, draftTimer = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = id => ($(id) ? $(id).value.trim() : '');
const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '');
function kind() { const r = document.querySelector('input[name="kind"]:checked'); return r ? r.value : ''; }
function setKind(v) { document.querySelectorAll('input[name="kind"]').forEach(r => { r.checked = r.value === v; }); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function jpDate(s) {
  const p = String(s).split('-');
  return '令和' + (Number(p[0]) - 2018) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
}

// 項目を1行ずつに並べる。判断基準が複数行にまたがるところは span・span2 で指定されている。
function flatten(sheet) {
  const rows = [];
  sheet.groups.forEach((g, gi) => {
    let left = 0, c = '', cid = '', span = 1, left2 = 0, c2 = '', c2id = '';
    g.rows.forEach((r, ri) => {
      if (left <= 0) { c = r.c || ''; cid = gi + '_' + ri; span = left = r.span || 1; left2 = 0; c2 = ''; c2id = ''; }
      if (r.c2) { c2 = r.c2; c2id = gi + '_' + ri; left2 = r.span2 || 1; }
      left--; left2--;
      rows.push({ key: (r.sub || '') + r.q, area: g.area, gi, mihon: r.m || '', sub: r.sub || '', q: r.q, c, cid, span, c2, c2id });
    });
  });
  return rows;
}

// ---------------- 画面を組み立てる ----------------
function build() {
  document.title = LAB_NAME + '　アセスメントシート';
  let h = '';
  h += '<div class="loading-overlay hidden" id="loading"><div class="spinner"></div><div class="loading-text" id="loadingText">処理中...</div></div>';
  h += '<div class="pending-banner" id="pendingBanner">⚠️ まだ送れていない記録が <span id="pendingCount">0</span> 件あります。通信できるときに自動で送ります。</div>';
  h += '<div class="header"><h1>' + esc(LAB_NAME) + '</h1><p>アセスメントシート　<span id="countText"></span></p><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div></div>';

  h += '<div class="step" id="stepCode"><div class="container"><div class="section-title">職員コードの入力</div>' +
    '<p style="font-size:14px;line-height:1.8;margin-bottom:16px">はじめて使う端末では、職員コードを入れてください。次回からは入力不要です。</p>' +
    '<div class="form-group"><input class="form-input" type="password" inputmode="numeric" autocomplete="off" id="staffCode" placeholder="職員コード"></div>' +
    '<div class="error-text" id="codeError"></div>' +
    '<button type="button" class="btn-primary" id="codeBtn">確認する</button></div></div>';

  h += '<div class="step" id="stepForm"><div class="container" id="formBox"></div></div>';

  h += '<div class="step" id="stepDone"><div class="container"><div class="complete-screen">' +
    '<div class="complete-icon" id="completeIcon">✅</div><div class="complete-title" id="completeTitle"></div>' +
    '<div class="status-badge" id="statusBadge"></div><div class="complete-message" id="completeMessage"></div>' +
    '<button type="button" class="btn-share" id="shareBtn">📄 PDFを見る・送る</button>' +
    '<button type="button" class="btn-secondary" id="editBtn">内容を直して保存し直す</button>' +
    '<button type="button" class="btn-primary" id="newBtn" style="margin-top:12px">次の方の記入へ</button>' +
    '</div></div></div>';

  document.body.innerHTML = h;
  $('codeBtn').addEventListener('click', submitCode);
  $('staffCode').addEventListener('keydown', e => { if (e.key === 'Enter') submitCode(); });
  $('shareBtn').addEventListener('click', sharePDF);
  $('editBtn').addEventListener('click', () => { showStep('stepForm'); updateCount(); });
  $('newBtn').addEventListener('click', () => resetForm());
}

function markButtons(key) {
  return '<div class="marks" role="group" aria-label="正誤">' + MARKS.map(m =>
    '<button type="button" class="mark" data-key="' + esc(key) + '" data-mark="' + m + '" aria-pressed="false">' + m + '</button>').join('') + '</div>';
}
function renderForm() {
  let h = '';
  h += '<div class="info-grid">';
  h += '<div class="form-group"><label class="form-label" for="assessDate">実施日<span class="required">必須</span></label><input class="form-input" type="date" id="assessDate"></div>';
  h += '<div class="form-group"><label class="form-label" for="staffName">実施した職員<span class="required">必須</span></label><input class="form-input" type="text" id="staffName" placeholder="例：村越　美也子"></div>';
  h += '<div class="form-group"><label class="form-label" for="childName">氏名<span class="required">必須</span></label><input class="form-input" type="text" id="childName" autocomplete="off" placeholder="例：田中　さくら"></div>';
  h += '<div class="form-group"><label class="form-label" for="childFurigana">フリガナ<span class="required">必須</span></label><input class="form-input" type="text" id="childFurigana" autocomplete="off" placeholder="例：タナカ　サクラ"><div class="form-hint">※フォルダ名とファイル名に使います（全角カタカナ）</div></div>';
  h += '<div class="form-group"><div class="form-label">年齢</div><div class="age">' +
    '<input class="form-input" type="number" inputmode="numeric" min="0" max="20" id="ageY" aria-label="年齢（歳）"><span>歳</span>' +
    '<input class="form-input" type="number" inputmode="numeric" min="0" max="11" id="ageM" aria-label="年齢（ヶ月）"><span>ヶ月</span></div></div>';
  h += '<div class="form-group wide"><div class="form-label">お子さんの状況<span class="required">必須</span></div><div class="kinds">' +
    '<label class="kind"><input type="radio" name="kind" value="user">利用中（契約済み）</label>' +
    '<label class="kind"><input type="radio" name="kind" value="trial">相談会・体験（契約前）</label></div>' +
    '<div class="form-hint">※保存先のフォルダが変わります</div></div>';
  h += '</div>';

  let gi = -1, mihon = '';
  ROWS.forEach(r => {
    if (r.gi !== gi) { gi = r.gi; mihon = ''; h += '<div class="area-title">' + esc(r.area) + '</div>'; }
    if (r.mihon !== mihon) { mihon = r.mihon; if (mihon) h += '<div class="sub-title">' + esc(mihon) + '</div>'; }
    const q = r.sub ? r.sub + '　' + r.q : r.q;
    const c = [r.c, r.c2].filter(Boolean).join('／');
    h += '<div class="item" data-item="' + esc(r.key) + '"><div class="item-text"><div class="item-q">' + esc(q) + '</div>' +
      (c ? '<div class="item-c">' + esc(c) + '</div>' : '') + '</div>' +
      '<div class="item-ctrl">' + markButtons(r.key) + '<button type="button" class="memo-btn" data-memo="' + esc(r.key) + '">メモ</button></div>' +
      '<textarea class="form-input memo" rows="2" maxlength="400" data-memofield="' + esc(r.key) + '" placeholder="メモ" style="display:none"></textarea></div>';
  });

  h += '<div class="area-title">そのほか</div>';
  h += '<div class="item"><div class="item-text"><div class="item-q">※抱っこ姿勢</div><div class="item-c">' + esc(SHEET.dakko) + '</div></div>' +
    '<div class="item-ctrl">' + markButtons(DAKKO) + '</div>' +
    '<textarea class="form-input memo" rows="3" data-memofield="' + DAKKO + '" placeholder="気づいたこと"></textarea></div>';
  h += '<div class="item"><div class="item-text"><div class="item-q">※その他</div><div class="item-c">' + esc(SHEET.other) + '</div></div>' +
    '<textarea class="form-input memo" rows="5" id="otherNote" placeholder="気になること、保護者から聞いたこと"></textarea></div>';

  h += '<button type="button" class="btn-primary" id="saveBtn">PDFにして保存する</button>';
  h += '<div class="footer-link"><a href="#" id="clearLink">白紙に戻す</a>　<a href="#" class="resetCode">職員コードを入れ直す</a></div>';

  const box = $('formBox');
  box.innerHTML = h;
  box.addEventListener('click', onFormClick);
  box.addEventListener('input', onFormInput);
  $('saveBtn').addEventListener('click', submitAll);
  $('clearLink').addEventListener('click', e => { e.preventDefault(); if (confirm('記入した内容を消して、白紙に戻しますか？')) resetForm(); });
  box.querySelector('.resetCode').addEventListener('click', e => {
    e.preventDefault();
    if (confirm('職員コードを入れ直しますか？')) { try { localStorage.removeItem(KEY_CODE); } catch (_) { } showStep('stepCode'); }
  });
}
function onFormClick(e) {
  const m = e.target.closest('.mark');
  if (m) {
    const k = m.dataset.key;
    if (marks[k] === m.dataset.mark) delete marks[k]; else marks[k] = m.dataset.mark;   // 同じ印をもう一度押すと取り消す
    paintMarks(k); updateCount(); saveDraftSoon();
    return;
  }
  const b = e.target.closest('.memo-btn');
  if (b) {
    const f = memoField(b.dataset.memo);
    const open = f.style.display === 'none';
    f.style.display = open ? 'block' : 'none';
    if (open) f.focus();
  }
}
function onFormInput(e) {
  const k = e.target.dataset ? e.target.dataset.memofield : null;
  if (k) {
    memos[k] = e.target.value;
    const b = document.querySelector('.memo-btn[data-memo="' + cssEsc(k) + '"]');
    if (b) b.classList.toggle('has', !!e.target.value.trim());
  }
  saveDraftSoon();
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function memoField(k) { return document.querySelector('[data-memofield="' + cssEsc(k) + '"]'); }
function paintMarks(k) {
  document.querySelectorAll('.mark[data-key="' + cssEsc(k) + '"]').forEach(b => {
    const on = marks[k] === b.dataset.mark;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function updateCount() {
  const done = ROWS.filter(r => marks[r.key]).length;
  $('countText').textContent = '記入 ' + done + ' / ' + ROWS.length;
  $('progressFill').style.width = Math.round(done / ROWS.length * 100) + '%';
}
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ---------------- 途中の記録（子どもが中断しても消えないように、端末に残す。保存が済んだら消す） ----------------
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}
function saveDraft() {
  try {
    localStorage.setItem(KEY_DRAFT, JSON.stringify({
      date: val('assessDate'), name: val('childName'), furigana: val('childFurigana'), staff: val('staffName'), kind: kind(), ageY: val('ageY'), ageM: val('ageM'),
      other: $('otherNote').value, marks, memos, saveCount
    }));
  } catch (e) { }
}
function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY_DRAFT) || 'null'); } catch (e) { }
  if (!d) return false;
  $('assessDate').value = d.date || todayStr();
  $('childName').value = d.name || '';
  $('childFurigana').value = d.furigana || '';
  $('staffName').value = d.staff || '';
  $('otherNote').value = d.other || '';
  setKind(d.kind || '');
  $('ageY').value = d.ageY || '';
  $('ageM').value = d.ageM || '';
  marks = d.marks || {}; memos = d.memos || {}; saveCount = d.saveCount || 0;
  applyState();
  return true;
}
function applyState() {
  ROWS.map(r => r.key).concat(DAKKO).forEach(k => {
    paintMarks(k);
    const f = memoField(k);
    if (!f) return;
    f.value = memos[k] || '';
    if (k !== DAKKO) f.style.display = memos[k] ? 'block' : 'none';
    const b = document.querySelector('.memo-btn[data-memo="' + cssEsc(k) + '"]');
    if (b) b.classList.toggle('has', !!(memos[k] || '').trim());
  });
  updateCount();
}
function clearDraft() { clearTimeout(draftTimer); try { localStorage.removeItem(KEY_DRAFT); } catch (e) { } }
function resetForm() {
  marks = {}; memos = {}; saveCount = 0; lastPdfBlob = null; lastFileName = '';
  clearDraft();
  ['childName', 'childFurigana', 'ageY', 'ageM', 'otherNote'].forEach(id => { $(id).value = ''; });
  setKind('');
  $('assessDate').value = todayStr();
  applyState();
  showStep('stepForm');
  checkPendingUploads();
}

// ---------------- PDF（紙のシートと同じ表の形。canvasに描いて画像としてA4に貼る） ----------------
const PPM = 8;                                  // 1mmあたりの点の数
const PAGE_W = 210, PAGE_H = 297, MX = 12, TOP = 12, BOTTOM = 283;
const COL = { area: 9, mihon: 6, q: 66, sub: 22, mark: 16, memo: 33, crit: 56, critL: 20 };   // 表の列の幅（mm）。area＋mihon＋q＋mark＋memo＋crit＝186mm
const FS = 2.8, LH = 3.7, ROW_MIN = 5.2;        // 文字の大きさ・行の高さ・1行の最低の高さ（mm）

function wrapText(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const ch of String(text)) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    if (ctx.measureText(cur + ch).width > maxW && cur !== '') { lines.push(cur); cur = ch; } else { cur += ch; }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}
function newPage() {
  const c = document.createElement('canvas');
  c.width = PAGE_W * PPM; c.height = PAGE_H * PPM;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'middle'; ctx.lineWidth = 1.5; ctx.strokeStyle = '#555555'; ctx.fillStyle = '#111111';
  return { c, ctx };
}
function setFont(ctx, mm, bold) { ctx.font = (bold ? 'bold ' : '') + Math.round(mm * PPM) + 'px ' + FONT_FAMILY; }
function drawText(ctx, text, x, y, opt) {
  opt = opt || {};
  setFont(ctx, opt.size || FS, opt.bold);
  ctx.fillStyle = opt.color || '#111111';
  ctx.textAlign = opt.align || 'left';
  ctx.fillText(text, x * PPM, y * PPM);
  ctx.textAlign = 'left';
}
function box(ctx, x, y, w, h, fill) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x * PPM, y * PPM, w * PPM, h * PPM); }
  ctx.strokeRect(x * PPM, y * PPM, w * PPM, h * PPM);
}
// 枠の中に、折り返した文字を上下の中央にそろえて書く
function cellText(ctx, text, x, y, w, h, opt) {
  opt = opt || {};
  if (!text) return;
  setFont(ctx, opt.size || FS, opt.bold);
  const lines = wrapText(ctx, text, (w - 2) * PPM);
  let ty = y + h / 2 - (lines.length - 1) * LH / 2;
  lines.forEach(l => {
    drawText(ctx, l, opt.center ? x + w / 2 : x + 1, ty, { size: opt.size, bold: opt.bold, align: opt.center ? 'center' : 'left', color: opt.color });
    ty += LH;
  });
}
// 領域など、縦書きの枠。高さが足りないときは横書きにする。
function vText(ctx, text, x, y, w, h) {
  const step = Math.min(FS + 0.9, (h - 1) / text.length);
  if (step < FS * 0.95) { cellText(ctx, text, x, y, w, h, { center: true, bold: true }); return; }
  let ty = y + h / 2 - (text.length - 1) * step / 2;
  for (const ch of text) { drawText(ctx, ch, x + w / 2, ty, { align: 'center', bold: true }); ty += step; }
}
function drawMarks(ctx, x, y, w, h, chosen) {
  const cx = x + w / 2, cy = y + h / 2, gap = 5;
  MARKS.forEach((m, i) => {
    const px = cx + (i - 1) * gap, on = chosen === m;
    if (on) {     // 選んだ印は黒い丸に白抜きにする（〇に輪を付けると◎に見えるため）
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(px * PPM, cy * PPM, 2.3 * PPM, 0, Math.PI * 2); ctx.fill();
    }
    drawText(ctx, m, px, cy, { align: 'center', size: FS + 0.4, bold: on, color: on ? '#ffffff' : (chosen ? '#c4c4c4' : '#777777') });
  });
}
function tableHeader(ctx, y) {
  const h = 5.4, fill = '#f0ecea';
  let x = MX;
  [['領域', COL.area], ['質問・課題', COL.mihon + COL.q], ['正誤', COL.mark], ['メモ', COL.memo], ['判断基準', COL.crit]].forEach(([t, w]) => {
    box(ctx, x, y, w, h, fill); ctx.fillStyle = '#111111';
    cellText(ctx, t, x, y, w, h, { center: true, bold: true });
    x += w;
  });
  return y + h;
}
// 質問の枠の幅：見本の列があれば見本の右、じゃんけん等は見出しの右、それ以外は見本の列まで広げる
function qWidth(r) { return r.sub ? COL.mihon + COL.q - COL.sub : r.mihon ? COL.q : COL.mihon + COL.q; }
function rowHeight(ctx, r) {
  setFont(ctx, FS);
  const n = Math.max(
    wrapText(ctx, r.q, (qWidth(r) - 2) * PPM).length,
    r.memo ? wrapText(ctx, r.memo, (COL.memo - 2) * PPM).length : 1,
    (r.span === 1 && r.c) ? wrapText(ctx, r.c, (COL.crit - 2) * PPM).length : 1
  );
  return Math.max(ROW_MIN, n * LH + 1.4);
}
// 同じ領域・同じ見本・同じ判断基準が続くところを1つの枠にまとめて描く
function drawSpans(page, keyFn, drawFn) {
  let i = 0;
  while (i < page.length) {
    let j = i, h = 0;
    const k = keyFn(page[i]);
    while (j < page.length && keyFn(page[j]) === k) { h += page[j].h; j++; }
    drawFn(page[i], page[i].y, h);
    i = j;
  }
}
function drawRows(ctx, rows) {
  const xArea = MX, xM = xArea + COL.area, xMark = xM + COL.mihon + COL.q, xMemo = xMark + COL.mark, xCrit = xMemo + COL.memo, xC2 = xCrit + COL.critL;
  drawSpans(rows, r => r.gi, (r, y, h) => { box(ctx, xArea, y, COL.area, h); vText(ctx, r.area, xArea, y, COL.area, h); });
  drawSpans(rows, r => r.mihon || ('n' + r.key), (r, y, h) => {
    if (r.mihon) { box(ctx, xM, y, COL.mihon, h); vText(ctx, r.mihon, xM, y, COL.mihon, h); }
  });
  rows.forEach(r => {
    const w = qWidth(r), x = xMark - w;
    if (r.sub) { box(ctx, xM, r.y, COL.sub, r.h); cellText(ctx, r.sub, xM, r.y, COL.sub, r.h); }
    box(ctx, x, r.y, w, r.h); cellText(ctx, r.q, x, r.y, w, r.h);
    box(ctx, xMark, r.y, COL.mark, r.h);
    drawMarks(ctx, xMark, r.y, COL.mark, r.h, r.mark);
    box(ctx, xMemo, r.y, COL.memo, r.h);
    cellText(ctx, r.memo, xMemo, r.y, COL.memo, r.h);
  });
  drawSpans(rows, r => r.cid, (r, y, h) => {
    const w = r.c2id ? COL.critL : COL.crit;
    box(ctx, xCrit, y, w, h); cellText(ctx, r.c, xCrit, y, w, h);
  });
  drawSpans(rows, r => r.c2id || ('n' + r.key), (r, y, h) => {
    if (r.c2id) { box(ctx, xC2, y, COL.crit - COL.critL, h); cellText(ctx, r.c2, xC2, y, COL.crit - COL.critL, h); }
  });
}
// 下の2つの欄（抱っこ姿勢・その他）
function noteBox(pages, st, label, text, chosen, minH) {
  const W = PAGE_W - MX * 2, PAD = 8.5;
  setFont(st.ctx, FS);
  const lines = text ? wrapText(st.ctx, text, (W - 3) * PPM) : [];
  const full = BOTTOM - TOP;
  // 全部入る大きさがこのページに無ければ次のページへ。1ページでも足りない長さなら、続きを次のページへ送る。
  if (PAD + lines.length * LH > BOTTOM - st.y && st.y > TOP) addPage(pages, st);
  let first = true;
  do {
    const room = BOTTOM - st.y;
    const chunk = lines.splice(0, Math.floor((Math.min(room, full) - PAD) / LH));
    const h = Math.min(Math.max(first ? minH : 0, PAD + chunk.length * LH), room);
    box(st.ctx, MX, st.y, W, h);
    drawText(st.ctx, first ? label : label + '（続き）', MX + 1.2, st.y + 3.2);
    if (first && chosen !== undefined) drawMarks(st.ctx, MX + W - 19, st.y + 0.6, 16, 5.2, chosen);
    let ty = st.y + 7.5;
    chunk.forEach(l => { drawText(st.ctx, l, MX + 1.5, ty); ty += LH; });
    st.y += h + 2;
    first = false;
    if (lines.length) addPage(pages, st);
  } while (lines.length);
}
function addPage(pages, st) {
  const p = newPage();
  pages.push(p.c); st.ctx = p.ctx; st.y = TOP;
}
function renderPages(data) {
  const pages = [];
  const st = { ctx: null, y: 0 };
  addPage(pages, st);
  const head = ctx => {
    drawText(ctx, 'アセスメントシート', PAGE_W / 2, TOP + 2.5, { size: 4.6, bold: true, align: 'center' });
    drawText(ctx, '実施日時：' + jpDate(data.date) + '　氏名：' + data.name + '（' + data.furigana + '）　（年齢 ' + (data.ageY || '　') + '歳 ' + (data.ageM || '　') + 'ヶ月）　実施：' + data.staff, PAGE_W - MX, TOP + 9, { size: 3, align: 'right' });
    return TOP + 12.5;
  };
  st.y = tableHeader(st.ctx, head(st.ctx));
  const rows = ROWS.map(r => Object.assign({}, r, { mark: marks[r.key] || '', memo: (memos[r.key] || '').trim() }));
  let page = [];
  rows.forEach(r => {
    r.h = rowHeight(st.ctx, r);
    if (st.y + r.h > BOTTOM) {
      drawRows(st.ctx, page); page = [];
      addPage(pages, st);
      st.y = tableHeader(st.ctx, st.y);
    }
    r.y = st.y; st.y += r.h; page.push(r);
  });
  drawRows(st.ctx, page);
  st.y += 3;
  noteBox(pages, st, '※抱っこ姿勢：' + SHEET.dakko, (memos[DAKKO] || '').trim(), marks[DAKKO] || '', 20);
  noteBox(pages, st, '※その他：' + SHEET.other, data.other, undefined, 30);
  pages.forEach((c, i) => {
    const ctx = c.getContext('2d');
    drawText(ctx, FOOTER, MX, PAGE_H - 8, { size: 2.5, color: '#999999' });
    drawText(ctx, (i + 1) + ' / ' + pages.length, PAGE_W - MX, PAGE_H - 8, { size: 2.5, color: '#999999', align: 'right' });
  });
  return pages;
}
function generatePDF(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  renderPages(data).forEach((c, i) => {
    if (i > 0) doc.addPage();
    doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
  });
  const uri = doc.output('datauristring');
  return uri.substring(uri.indexOf(',') + 1);
}

// ---------------- 保存 ----------------
async function submitAll() {
  const missing = [];
  if (!val('assessDate')) missing.push('実施日');
  if (!val('staffName')) missing.push('実施した職員');
  if (!val('childName')) missing.push('氏名');
  if (!val('childFurigana')) missing.push('フリガナ');
  if (!kind()) missing.push('お子さんの状況（利用中か、相談会・体験か）');
  if (missing.length) { alert('次の項目を入力してください。\n・' + missing.join('\n・')); window.scrollTo(0, 0); return; }
  const blank = ROWS.filter(r => !marks[r.key]).length;
  if (blank && !confirm('〇△✕ が付いていない項目が ' + blank + ' か所あります。このまま保存しますか？')) return;

  try { localStorage.setItem(KEY_STAFF, val('staffName')); } catch (e) { }
  saveDraft();
  showLoading('PDFを作成しています...');
  try {
    const d = { date: val('assessDate'), name: val('childName'), furigana: val('childFurigana'), staff: val('staffName'), ageY: val('ageY'), ageM: val('ageM'), other: $('otherNote').value.trim() };
    const pdfBase64 = generatePDF(d);
    const fileName = 'アセスメント_' + safeName(d.furigana) + '_' + safeName(d.name) + '_' + d.date.replace(/-/g, '') + (saveCount ? '_修正' + saveCount : '') + '.pdf';
    const bin = atob(pdfBase64);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    lastPdfBlob = new Blob([bytes], { type: 'application/pdf' }); lastFileName = fileName;
    updateLoading('Googleドライブに保存しています...');
    const item = { office: OFFICE, fileName, pdfBase64, childFolder: safeName(d.furigana) + '_' + safeName(d.name), trial: kind() === 'trial' };
    const r = await upload(item);
    if (!r.ok) await savePending(item);
    saveCount++;
    clearDraft();
    hideLoading();
    showComplete(r, item);
  } catch (e) { hideLoading(); alert('エラーが起きました：' + e.message); }
}
function getCode() { try { return localStorage.getItem(KEY_CODE) || ''; } catch (e) { return ''; } }
async function post(body) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plainにすると事前確認（CORS）が不要になる
    body: JSON.stringify(body)
  });
  return res.json();
}
async function upload(item) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    const j = await post(Object.assign({ action: 'save', code: getCode() }, item));
    if (j && j.success) return { ok: true };
    if (j && j.error === 'code') return { ok: false, reason: 'code' };
    return { ok: false, reason: 'server' };
  } catch (e) { return { ok: false, reason: 'network' }; }
}
// 送れなかったPDFは、署名の画面と同じ端末内の保存場所（IndexedDB）に入れておき、あとで自動で送る。
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('furakoko-sign', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('pending').objectStore('pending').getAll();
    q.onsuccess = () => res(q.result.filter(x => x.office === OFFICE));
    q.onerror = () => rej(q.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('pending', mode);
    fn(tx.objectStore('pending'));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function savePending(item) {
  try { await idbDo('readwrite', st => st.add(item)); }
  catch (e) { alert('端末に一時保存できませんでした。完了画面の「PDFを見る・送る」で、PDFを必ず残してください。'); }
  updatePendingBanner();
}
let checking = false;
async function checkPendingUploads() {
  if (checking || !navigator.onLine || !getCode()) return;
  checking = true;
  try {
    for (const item of await idbAll()) {
      const r = await upload(item);
      if (r.ok) await idbDo('readwrite', st => st.delete(item.id));
    }
  } catch (e) { }
  checking = false;
  updatePendingBanner();
}
async function updatePendingBanner() {
  let n = 0;
  try { n = (await idbAll()).length; } catch (e) { }
  if (!$('pendingCount')) return;
  $('pendingCount').textContent = n;
  $('pendingBanner').style.display = n > 0 ? 'block' : 'none';
}
function showComplete(r, item) {
  showStep('stepDone');
  if (r.ok) {
    $('completeIcon').textContent = '✅';
    $('completeTitle').textContent = '保存しました';
    $('statusBadge').textContent = 'Googleドライブに保存しました';
    $('statusBadge').className = 'status-badge status-saved';
    $('completeMessage').textContent = item.fileName + '\n\n共有ドライブ「ふらここラボ」の ' + FOLDER_LABEL[item.trial ? 'trial' : 'user'] + ' の「' + item.childFolder + '」フォルダに入りました。';
  } else {
    $('completeIcon').textContent = '📥';
    $('completeTitle').textContent = '端末に一時保存しました';
    $('statusBadge').textContent = '通信できるときに自動で送ります';
    $('statusBadge').className = 'status-badge status-pending';
    $('completeMessage').textContent = r.reason === 'code'
      ? '職員コードが違うため、保存できませんでした。\n職員コードを入れ直すと、自動で送ります。'
      : 'いまは保存できなかったため、この端末に一時保存しました。\n通信できる状態でこの画面を開くと、自動で送ります。';
  }
}
async function sharePDF() {
  if (!lastPdfBlob || !lastFileName) return;
  try {
    const file = new File([lastPdfBlob], lastFileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'アセスメントシート' });
    } else {
      const url = URL.createObjectURL(lastPdfBlob);
      const a = document.createElement('a'); a.href = url; a.download = lastFileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) { if (e.name !== 'AbortError') alert('送れませんでした：' + e.message); }
}

// ---------------- 項目の読み込みと職員コード ----------------
function applySheet(s) {
  if (!s || !Array.isArray(s.groups)) return false;
  SHEET = s; ROWS = flatten(s);
  renderForm();
  return true;
}
async function loadSheet() {
  let ok = false;
  try { ok = applySheet(JSON.parse(localStorage.getItem(KEY_SHEET) || 'null')); } catch (e) { }
  if (navigator.onLine) {
    try {
      const j = await post({ action: 'assessSheet', code: getCode() });
      if (j && j.error === 'code') return 'code';
      if (j && j.success && applySheet(j.sheet)) { ok = true; try { localStorage.setItem(KEY_SHEET, JSON.stringify(j.sheet)); } catch (e) { } }
    } catch (e) { }
  }
  return ok ? 'ok' : 'none';
}
async function enterApp() {
  showLoading('シートを読み込んでいます...');
  const r = await loadSheet();
  hideLoading();
  if (r === 'ok') {
    $('assessDate').value = todayStr();
    try { const s = localStorage.getItem(KEY_STAFF); if (s) $('staffName').value = s; } catch (e) { }
    restoreDraft();
    updateCount();
    showStep('stepForm');
    checkPendingUploads();
    return;
  }
  if (r === 'code') { try { localStorage.removeItem(KEY_CODE); } catch (e) { } showStep('stepCode'); $('codeError').textContent = '職員コードが変わりました。新しいコードを入れてください。'; return; }
  showStep('stepCode');
  $('codeError').textContent = 'シートを読み込めませんでした。通信できる場所で、もう一度「確認する」を押してください。';
}
async function submitCode() {
  const code = $('staffCode').value.trim();
  $('codeError').textContent = '';
  if (!code) { $('codeError').textContent = '職員コードを入れてください。'; return; }
  showLoading('確認しています...');
  try {
    const j = await post({ action: 'check', code });
    hideLoading();
    if (j && j.success) { saveCode(code); return; }
    $('codeError').textContent = '職員コードが違います。もう一度入れてください。';
  } catch (e) {
    hideLoading();
    saveCode(code);    // 通信できないときは、いったん保存しておき、送信のときに確かめる
  }
}
function saveCode(code) {
  try { localStorage.setItem(KEY_CODE, code); } catch (e) { }
  $('staffCode').value = '';
  enterApp();
}
function showLoading(t) { $('loadingText').textContent = t; $('loading').classList.remove('hidden'); }
function updateLoading(t) { $('loadingText').textContent = t; }
function hideLoading() { $('loading').classList.add('hidden'); }

// ---------------- 起動 ----------------
window.addEventListener('load', () => {
  build();
  updatePendingBanner();
  if (getCode()) enterApp(); else showStep('stepCode');
  window.addEventListener('online', checkPendingUploads);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
});
