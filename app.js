/* ═══════════════════════════════════════════════════════
   KEUANGAN HARIMAS — app.js
   Backend: Google Apps Script (Web App) + Google Sheets
════════════════════════════════════════════════════════ */

// ── CONFIG ──────────────────────────────────────────────
// Ganti nilai GAS_URL dengan URL Web App Google Apps Script kamu
const GAS_URL = "https://script.google.com/macros/s/AKfycbwO5VV482ep3nvsdGWOJ6KsPtuFHuTNvVSEqOJmvbG1HlBBLM2skNBFPwC4oc_qQEPt/exec";

// ── KONSTANTA KATEGORI ──────────────────────────────────
const KAT_PEMASUKAN = ["Gaji", "Tukin", "Uang Makan", "Lain-lain"];

const KAT_PENGELUARAN = [
  "Makanan Pokok", "Bensin", "Sewa Kost", "Main Bola",
  "Investasi", "Belanja Bulanan", "Jajan", "Kas Kantor",
  "Iuran Kantor", "Kopi Kantor", "Sedekah", "Lain-lain"
];

// Tipe budget per kategori pengeluaran
const BUDGET_TYPE = {
  "Makanan Pokok":  "batas_atas",
  "Bensin":         "batas_atas",
  "Sewa Kost":      "min_wajib",
  "Main Bola":      "batas_atas",
  "Investasi":      "min_wajib",
  "Belanja Bulanan":"batas_atas",
  "Jajan":          "batas_atas",
  "Kas Kantor":     "min_wajib",
  "Iuran Kantor":   "min_wajib",
  "Kopi Kantor":    "min_wajib",
  "Sedekah":        "fixed_pct",   // 2.5% dari total pemasukan
  "Lain-lain":      null
};

const EMOJI_KAT = {
  "Gaji":"💼","Tukin":"🏛️","Uang Makan":"🍽️","Lain-lain":"📌",
  "Makanan Pokok":"🛒","Bensin":"⛽","Sewa Kost":"🏠","Main Bola":"⚽",
  "Investasi":"📈","Belanja Bulanan":"🛍️","Jajan":"☕","Kas Kantor":"🏢",
  "Iuran Kantor":"📋","Kopi Kantor":"☕","Sedekah":"🤲",
  "Tarik Tunai":"💳"
};

// ── STATE ────────────────────────────────────────────────
let state = {
  saldoRekening: 0,
  saldoCash: 0,
  transaksi: [],          // [{id, tanggal, tipe, kategori, jumlah, sumber, keterangan}]
  budget: {},             // {"YYYY-MM": {kategori: jumlah}}
  carryOver: {},          // {"YYYY-MM": {kategori: lebih}}
  currentBudgetMonth: "", // "YYYY-MM"
};

// ── UTIL ─────────────────────────────────────────────────
function fmt(n) {
  return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");
}
function fmtShort(n) {
  if (Math.abs(n) >= 1_000_000) return "Rp " + (n/1_000_000).toFixed(1) + "jt";
  if (Math.abs(n) >= 1_000)     return "Rp " + (n/1_000).toFixed(0) + "rb";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["Januari","Februari","Maret","April","Mei","Juni",
                 "Juli","Agustus","September","Oktober","November","Desember"];
  return `${names[parseInt(m)-1]} ${y}`;
}
function prevMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m-1-1, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function nextMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m-1+1, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function today() {
  return new Date().toISOString().slice(0,10);
}
function showToast(msg, type="success") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = "toast hidden"; }, 2800);
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

// ── SPLASH SCREEN ─────────────────────────────────────────
function startSplash() {
  const tagEl  = document.getElementById("splashTagline");
  const barEl  = document.getElementById("splashBar");
  const baseText = "kemana perginya uangku";
  let qCount = 0;
  let progress = 0;

  const qInterval = setInterval(() => {
    qCount = (qCount % 4) + 1;
    tagEl.textContent = baseText + "?".repeat(qCount);
  }, 400);

  const barInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 88);
    barEl.style.width = progress + "%";
  }, 300);

  return { qInterval, barInterval, barEl };
}

function finishSplash({ qInterval, barInterval, barEl }) {
  clearInterval(qInterval);
  clearInterval(barInterval);
  barEl.style.width = "100%";
  const tagEl = document.getElementById("splashTagline");
  tagEl.textContent = "siap digunakan ✓";

  setTimeout(() => {
    document.getElementById("splash").classList.add("fade-out");
    document.getElementById("app").classList.remove("hidden");
    renderAll();
  }, 600);
}

// ── GAS API ───────────────────────────────────────────────
async function syncFromSheet() {
  if (!GAS_URL || GAS_URL.includes("GANTI_DENGAN")) {
    console.warn("URL GAS belum diisi!");
    loadLocal();
    return;
  }
  try {
    const res  = await fetch(GAS_URL + "?action=getAll", { method: "GET" });
    const data = await res.json();
    if (data.ok) {
      state.saldoRekening = data.saldoRekening || 0;
      state.saldoCash     = data.saldoCash     || 0;
      state.transaksi     = data.transaksi      || [];
      state.budget        = data.budget         || {};
      state.carryOver     = data.carryOver      || {};
    }
    saveLocal();
  } catch(e) {
    console.warn("Gagal sync dari Sheet, pakai data lokal.", e);
    loadLocal();
  }
}

async function pushToSheet(payload) {
  if (GAS_URL === "GANTI_DENGAN_URL_GAS_KAMU") {
    saveLocal();
    return { ok: true };
  }
  try {
    const res  = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    return data;
  } catch(e) {
    console.warn("Push ke Sheet gagal:", e);
    saveLocal();
    return { ok: false, msg: e.message };
  }
}

// ── LOCAL STORAGE ─────────────────────────────────────────
function saveLocal() {
  try { localStorage.setItem("kh_state", JSON.stringify(state)); } catch {}
}
function loadLocal() {
  try {
    const raw = localStorage.getItem("kh_state");
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch {}
}

// ── KALKULASI ─────────────────────────────────────────────
function txOfMonth(monthKey) {
  return state.transaksi.filter(t => t.tanggal && t.tanggal.startsWith(monthKey));
}

function totalPemasukanMonth(monthKey) {
  return txOfMonth(monthKey)
    .filter(t => t.tipe === "pemasukan")
    .reduce((s, t) => s + t.jumlah, 0);
}

function totalPengeluaranMonth(monthKey) {
  return txOfMonth(monthKey)
    .filter(t => t.tipe === "pengeluaran")
    .reduce((s, t) => s + t.jumlah, 0);
}

function pengeluaranPerKat(monthKey) {
  const out = {};
  txOfMonth(monthKey)
    .filter(t => t.tipe === "pengeluaran")
    .forEach(t => { out[t.kategori] = (out[t.kategori] || 0) + t.jumlah; });
  return out;
}

// Hitung carry-over dari bulan sebelumnya (batas atas)
function getCarryOver(monthKey) {
  const prevKey = prevMonthKey(monthKey);
  const prevPkt = pengeluaranPerKat(prevKey);
  const prevBudget = state.budget[prevKey] || {};
  const carry = {};
  KAT_PENGELUARAN.forEach(kat => {
    if (BUDGET_TYPE[kat] === "batas_atas") {
      const budget  = prevBudget[kat] || 0;
      const actual  = prevPkt[kat]    || 0;
      const lebih   = actual - budget;
      if (lebih > 0 && budget > 0) carry[kat] = lebih;
    }
  });
  return carry;
}

// ── RENDER ALL ────────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderDashboard();
  renderBudgetTab();
  renderRiwayat();
}

function renderHeader() {
  document.getElementById("headerMonth").textContent = monthLabel(thisMonthKey());
}

function renderDashboard() {
  const mk = thisMonthKey();

  // Saldo
  document.getElementById("saldoRekening").textContent = fmt(state.saldoRekening);
  document.getElementById("saldoCash").textContent     = fmt(state.saldoCash);
  document.getElementById("saldoTotal").textContent    = fmt(state.saldoRekening + state.saldoCash);

  // Monthly
  const inc  = totalPemasukanMonth(mk);
  const exp  = totalPengeluaranMonth(mk);
  const net  = inc - exp;
  document.getElementById("totalPemasukan").textContent  = fmt(inc);
  document.getElementById("totalPengeluaran").textContent = fmt(exp);
  const selEl = document.getElementById("totalSelisih");
  selEl.textContent = fmt(net);
  selEl.className   = "summary-val " + (net >= 0 ? "positive" : "negative");

  // Budget status
  renderBudgetStatus(mk);

  // Budget month label
  document.getElementById("budgetMonthLabel").textContent = monthLabel(mk);
}

function renderBudgetStatus(mk) {
  const list      = document.getElementById("budgetStatusList");
  const pkt       = pengeluaranPerKat(mk);
  const budget    = state.budget[mk] || {};
  const carryOver = getCarryOver(mk);
  const totalInc  = totalPemasukanMonth(mk);
  let   items     = [];
  let   carryNote = [];

  // Carry-over notice
  Object.entries(carryOver).forEach(([kat, lebih]) => {
    if (lebih > 0) carryNote.push(`<b>${kat}</b>: kelebihan ${fmtShort(lebih)} dari bulan lalu`);
  });
  const noticeEl = document.getElementById("carryOverNotice");
  if (carryNote.length) {
    noticeEl.innerHTML = "⚠️ Carry-over dari bulan lalu:<br>" + carryNote.join("<br>");
    noticeEl.classList.remove("hidden");
  } else {
    noticeEl.classList.add("hidden");
  }

  KAT_PENGELUARAN.forEach(kat => {
    const btype = BUDGET_TYPE[kat];
    if (!btype) return;

    let budgetAmt, actual, pct, statusClass, statusLabel;
    actual = (pkt[kat] || 0) + (carryOver[kat] || 0);

    if (btype === "fixed_pct") {
      budgetAmt = Math.round(totalInc * 0.025);
    } else {
      budgetAmt = budget[kat] || 0;
    }
    if (!budgetAmt && btype !== "fixed_pct") return; // belum diset

    if (btype === "batas_atas") {
      pct = budgetAmt > 0 ? Math.min((actual / budgetAmt) * 100, 100) : 0;
      const rawPct = budgetAmt > 0 ? (actual / budgetAmt) * 100 : 0;
      if (rawPct <= 75)       { statusClass = "ok";   statusLabel = "Aman"; }
      else if (rawPct <= 100) { statusClass = "warn"; statusLabel = "Hampir"; }
      else                    { statusClass = "over"; statusLabel = "Melebihi"; }
      items.push({ kat, btype, actual, budgetAmt, pct, statusClass, statusLabel });
    } else { // min_wajib or fixed_pct
      const met = actual >= budgetAmt;
      statusClass = met ? "met" : "unmet";
      statusLabel = met ? "Terpenuhi" : "Belum";
      pct = budgetAmt > 0 ? Math.min((actual / budgetAmt) * 100, 100) : 0;
      const barClass = met ? "ok" : "over";
      items.push({ kat, btype, actual, budgetAmt, pct, statusClass, statusLabel, barClass });
    }
  });

  if (!items.length) {
    list.innerHTML = `<div class="rv-empty">Belum ada budget diatur. Set budget di tab Budget.</div>`;
    return;
  }

  list.innerHTML = items.map(i => {
    const emoji = EMOJI_KAT[i.kat] || "📌";
    const barCls = i.barClass || i.statusClass;
    const typeLabel = i.btype === "batas_atas" ? "Batas Atas" :
                      i.btype === "fixed_pct"  ? "2.5% Pemasukan" : "Min. Wajib";
    return `
      <div class="bsi-item">
        <div class="bsi-top">
          <div class="bsi-name">${emoji} ${i.kat} <small style="color:var(--text-muted);font-size:10px">[${typeLabel}]</small></div>
          <div class="bsi-badge ${i.statusClass}">${i.statusLabel}</div>
        </div>
        <div class="bsi-bar-bg"><div class="bsi-bar-fill ${barCls}" style="width:${i.pct}%"></div></div>
        <div class="bsi-amounts">
          <span>${fmtShort(i.actual)}</span>
          <span class="highlight">/ ${fmtShort(i.budgetAmt)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ── BUDGET TAB ────────────────────────────────────────────
function renderBudgetTab() {
  if (!state.currentBudgetMonth) state.currentBudgetMonth = thisMonthKey();
  const mk = state.currentBudgetMonth;
  document.getElementById("budgetNavLabel").textContent = monthLabel(mk);
  document.getElementById("budgetEditMonthLabel").textContent = monthLabel(mk);

  const budget = state.budget[mk] || {};
  const totalInc = totalPemasukanMonth(mk);
  const sedekahFixed = Math.round(totalInc * 0.025);

  const list = document.getElementById("budgetFormList");
  list.innerHTML = KAT_PENGELUARAN.map(kat => {
    const btype = BUDGET_TYPE[kat];
    if (!btype) return `
      <div class="bfl-item">
        <div class="bfl-info">
          <div class="bfl-name">${EMOJI_KAT[kat]||"📌"} ${kat}</div>
          <div class="bfl-type" style="color:var(--text-muted)">Tanpa budget</div>
        </div>
        <input class="bfl-input" disabled placeholder="—">
      </div>`;

    const typeLabel  = btype === "batas_atas" ? "Batas Atas" :
                       btype === "fixed_pct"  ? "2.5% dari pemasukan" : "Min. Wajib";
    const typeCls    = btype === "batas_atas" ? "batas-atas" :
                       btype === "fixed_pct"  ? "fixed-note" : "min-wajib";
    const isFixed    = btype === "fixed_pct";
    const val        = isFixed ? fmt(sedekahFixed) : (budget[kat] || "");
    return `
      <div class="bfl-item">
        <div class="bfl-info">
          <div class="bfl-name">${EMOJI_KAT[kat]||"📌"} ${kat}</div>
          <div class="bfl-type ${typeCls}">${typeLabel}</div>
        </div>
        <input class="bfl-input" data-kat="${kat}"
               ${isFixed ? 'disabled' : ''}
               type="${isFixed ? 'text' : 'number'}"
               value="${isFixed ? val : val}"
               placeholder="0"
               min="0">
      </div>`;
  }).join("");
}

// ── RIWAYAT TAB ───────────────────────────────────────────
function renderRiwayat() {
  // Populate bulan filter
  const months = [...new Set(state.transaksi.map(t => t.tanggal?.slice(0,7)))].sort().reverse();
  const cur = thisMonthKey();
  if (!months.includes(cur)) months.unshift(cur);
  const selBulan = document.getElementById("filterBulan");
  selBulan.innerHTML = months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");

  renderRiwayatList();
}
function renderRiwayatList() {
  const mk   = document.getElementById("filterBulan").value || thisMonthKey();
  const tipe = document.getElementById("filterTipe").value;
  let   list = txOfMonth(mk).slice().sort((a,b) => b.tanggal.localeCompare(a.tanggal));
  if (tipe) list = list.filter(t => t.tipe === tipe);

  const el = document.getElementById("riwayatList");
  if (!list.length) {
    el.innerHTML = `<div class="rv-empty">Tidak ada transaksi.</div>`;
    return;
  }
  el.innerHTML = list.map(t => {
    const isIncome = t.tipe === "pemasukan";
    const isTarik  = t.tipe === "tarik_tunai";
    const cls      = isIncome ? "income" : isTarik ? "transfer" : "expense";
    const emoji    = isTarik ? "💳" : (EMOJI_KAT[t.kategori] || "📌");
    const sign     = isIncome ? "+" : isTarik ? "⇄" : "−";
    const katLabel = isTarik ? "Tarik Tunai" : t.kategori;
    const meta     = [t.tanggal, t.sumber ? `via ${t.sumber}` : null, t.keterangan]
                      .filter(Boolean).join(" · ");
    return `
      <div class="rv-item">
        <div class="rv-icon ${cls}">${emoji}</div>
        <div class="rv-info">
          <div class="rv-kat">${katLabel}</div>
          <div class="rv-meta">${meta}</div>
        </div>
        <div class="rv-amount ${cls}">${sign}${fmtShort(t.jumlah)}</div>
      </div>`;
  }).join("");
}

// ── FORM: KATEGORI DROPDOWN ───────────────────────────────
function populateKategori(selectEl, tipe) {
  const list = tipe === "pemasukan" ? KAT_PEMASUKAN : KAT_PENGELUARAN;
  selectEl.innerHTML = list.map(k => `<option value="${k}">${k}</option>`).join("");
}

// ── TRANSAKSI FORM (TAB) ──────────────────────────────────
let txTipe = "pemasukan";
function initTxForm() {
  const segTipe  = document.getElementById("segTipe");
  const rowSumber = document.getElementById("rowSumber");
  populateKategori(document.getElementById("txKategori"), "pemasukan");
  document.getElementById("txTanggal").value = today();
  document.getElementById("ttTanggal").value = today();

  segTipe.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      segTipe.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      txTipe = btn.dataset.val;
      populateKategori(document.getElementById("txKategori"), txTipe);
      rowSumber.style.display = txTipe === "pengeluaran" ? "flex" : "none";
    });
  });
  rowSumber.style.display = "none";

  initSegCtrl(document.getElementById("segSumber"));
  initSegCtrl(document.getElementById("mSegSumber"));

  document.getElementById("btnSimpanTx").addEventListener("click", saveTx);
  document.getElementById("btnSimpanTT").addEventListener("click", saveTarik);
}

function initSegCtrl(seg) {
  seg.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      seg.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function getActiveVal(seg) {
  return seg.querySelector(".seg-btn.active")?.dataset.val || "";
}

async function saveTx() {
  const tanggal    = document.getElementById("txTanggal").value;
  const jumlah     = parseFloat(document.getElementById("txJumlah").value);
  const kategori   = document.getElementById("txKategori").value;
  const keterangan = document.getElementById("txKeterangan").value.trim();
  const sumber     = txTipe === "pengeluaran"
                       ? getActiveVal(document.getElementById("segSumber"))
                       : "rekening";

  if (!tanggal || !jumlah || jumlah <= 0) {
    showToast("Isi tanggal dan jumlah dengan benar", "error"); return;
  }

  const tx = { id: genId(), tanggal, tipe: txTipe, kategori, jumlah, sumber, keterangan };
  applyTx(tx);
  state.transaksi.push(tx);

  document.getElementById("txJumlah").value      = "";
  document.getElementById("txKeterangan").value  = "";

  await pushToSheet({ action: "addTx", tx, saldoRekening: state.saldoRekening, saldoCash: state.saldoCash });
  renderAll();
  showToast("Transaksi tersimpan ✓");
}

async function saveTarik() {
  const tanggal    = document.getElementById("ttTanggal").value;
  const jumlah     = parseFloat(document.getElementById("ttJumlah").value);
  const keterangan = document.getElementById("ttKeterangan").value.trim();
  if (!tanggal || !jumlah || jumlah <= 0) {
    showToast("Isi tanggal dan jumlah", "error"); return;
  }
  if (state.saldoRekening < jumlah) {
    showToast("Saldo rekening tidak cukup", "error"); return;
  }
  const tx = { id: genId(), tanggal, tipe: "tarik_tunai", kategori: "Tarik Tunai", jumlah, sumber: "rekening", keterangan };
  state.saldoRekening -= jumlah;
  state.saldoCash     += jumlah;
  state.transaksi.push(tx);

  document.getElementById("ttJumlah").value      = "";
  document.getElementById("ttKeterangan").value  = "";

  await pushToSheet({ action: "addTx", tx, saldoRekening: state.saldoRekening, saldoCash: state.saldoCash });
  renderAll();
  showToast("Tarik tunai dicatat ✓");
}

function applyTx(tx) {
  if (tx.tipe === "pemasukan") {
    state.saldoRekening += tx.jumlah;
  } else if (tx.tipe === "pengeluaran") {
    if (tx.sumber === "rekening") state.saldoRekening -= tx.jumlah;
    else                          state.saldoCash     -= tx.jumlah;
  }
}

// ── MODAL QUICK ADD ───────────────────────────────────────
let modalTipe = "pemasukan";
function initModals() {
  // Open via data-open buttons
  document.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => {
      const modalId  = btn.dataset.open;
      const typePref = btn.dataset.type;
      if (modalId === "modal-transaksi" && typePref) {
        modalTipe = typePref;
        openModalTx(typePref);
      }
      document.getElementById(modalId).classList.remove("hidden");
    });
  });

  // Close buttons
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  // Close on overlay click
  document.querySelectorAll(".modal-overlay").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target === el) el.classList.add("hidden");
    });
  });

  document.getElementById("btnModalSimpan").addEventListener("click", saveModalTx);
  document.getElementById("btnModalTarik").addEventListener("click", saveModalTarik);
}

function openModalTx(tipe) {
  modalTipe = tipe;
  const title = tipe === "pemasukan" ? "Tambah Pemasukan" : "Tambah Pengeluaran";
  document.getElementById("modalTxTitle").textContent = title;
  populateKategori(document.getElementById("mTxKategori"), tipe);
  const rowS = document.getElementById("mRowSumber");
  rowS.style.display = tipe === "pengeluaran" ? "flex" : "none";
}

async function saveModalTx() {
  const jumlah     = parseFloat(document.getElementById("mTxJumlah").value);
  const kategori   = document.getElementById("mTxKategori").value;
  const keterangan = document.getElementById("mTxKet").value.trim();
  const sumber     = modalTipe === "pengeluaran"
                       ? getActiveVal(document.getElementById("mSegSumber"))
                       : "rekening";
  if (!jumlah || jumlah <= 0) { showToast("Isi jumlah dengan benar", "error"); return; }

  const tx = { id: genId(), tanggal: today(), tipe: modalTipe, kategori, jumlah, sumber, keterangan };
  applyTx(tx);
  state.transaksi.push(tx);

  document.getElementById("mTxJumlah").value = "";
  document.getElementById("mTxKet").value    = "";
  document.getElementById("modal-transaksi").classList.add("hidden");

  await pushToSheet({ action: "addTx", tx, saldoRekening: state.saldoRekening, saldoCash: state.saldoCash });
  renderAll();
  showToast("Tersimpan ✓");
}

async function saveModalTarik() {
  const jumlah     = parseFloat(document.getElementById("mTTJumlah").value);
  const keterangan = document.getElementById("mTTKet").value.trim();
  if (!jumlah || jumlah <= 0) { showToast("Isi jumlah", "error"); return; }
  if (state.saldoRekening < jumlah) { showToast("Saldo rekening tidak cukup", "error"); return; }

  const tx = { id: genId(), tanggal: today(), tipe: "tarik_tunai", kategori: "Tarik Tunai", jumlah, sumber: "rekening", keterangan };
  state.saldoRekening -= jumlah;
  state.saldoCash     += jumlah;
  state.transaksi.push(tx);

  document.getElementById("mTTJumlah").value = "";
  document.getElementById("mTTKet").value    = "";
  document.getElementById("modal-tarik").classList.add("hidden");

  await pushToSheet({ action: "addTx", tx, saldoRekening: state.saldoRekening, saldoCash: state.saldoCash });
  renderAll();
  showToast("Tarik tunai dicatat ✓");
}

// ── BUDGET SAVE ───────────────────────────────────────────
async function saveBudget() {
  const mk = state.currentBudgetMonth;
  if (!state.budget[mk]) state.budget[mk] = {};
  document.querySelectorAll(".bfl-input[data-kat]").forEach(inp => {
    if (!inp.disabled) {
      const val = parseFloat(inp.value);
      if (!isNaN(val) && val >= 0) state.budget[mk][inp.dataset.kat] = val;
    }
  });
  await pushToSheet({ action: "saveBudget", month: mk, budget: state.budget[mk] });
  renderDashboard();
  showToast("Budget tersimpan ✓");
}

// ── BUDGET NAV ────────────────────────────────────────────
function initBudgetNav() {
  document.getElementById("btnBudgetPrev").addEventListener("click", () => {
    state.currentBudgetMonth = prevMonthKey(state.currentBudgetMonth);
    renderBudgetTab();
  });
  document.getElementById("btnBudgetNext").addEventListener("click", () => {
    state.currentBudgetMonth = nextMonthKey(state.currentBudgetMonth);
    renderBudgetTab();
  });
  document.getElementById("btnSimpanBudget").addEventListener("click", saveBudget);
}

// ── SYNC BUTTON ───────────────────────────────────────────
function initSyncBtn() {
  const btn = document.getElementById("btnSync");
  btn.addEventListener("click", async () => {
    btn.classList.add("syncing");
    await syncFromSheet();
    renderAll();
    btn.classList.remove("syncing");
    showToast("Data tersinkronkan ✓", "info");
  });
}

// ── TABS ──────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
      if (tab.dataset.tab === "riwayat") renderRiwayat();
      if (tab.dataset.tab === "budget")  renderBudgetTab();
    });
  });
}

// ── RIWAYAT FILTERS ───────────────────────────────────────
function initFilters() {
  document.getElementById("filterBulan").addEventListener("change", renderRiwayatList);
  document.getElementById("filterTipe").addEventListener("change",  renderRiwayatList);
}

// ── BOOTSTRAP ─────────────────────────────────────────────
async function boot() {
  const splash = startSplash();

  // Init UI while loading
  initTabs();
  initTxForm();
  initModals();
  initBudgetNav();
  initSyncBtn();
  initFilters();
  state.currentBudgetMonth = thisMonthKey();

  // Sync data
  await syncFromSheet();

  finishSplash(splash);
}

window.addEventListener("DOMContentLoaded", boot);
