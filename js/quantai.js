/**
 * QuantAI: Client Runtime Engine (Zero Loading Delay)
 * Max 5 Active Shares Concurrently | Dynamic Swing Model (Target ~1.5%-2.0%, SL 0.5%-1.5%, min 1:2.0 R:R)
 */

const SCAN_INTERVAL_SEC = 60;
const STORAGE_STATE = "quantai_state";

let appState = {
  activePicks: [],
  history: [],
  nifty: { price: "22,944.50", change: "+55.55", change_percent: "+0.24%" },
  countdown: SCAN_INTERVAL_SEC,
  isScanning: false,
  timerInterval: null
};

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadPersistedData();
  startCountdownLoop();
  runQuantScanCycle();
});

function startClock() {
  const clockEl = document.getElementById("clockDisplay");
  const updateClock = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
    const hrs = String(istTime.getHours()).padStart(2, "0");
    const mins = String(istTime.getMinutes()).padStart(2, "0");
    const secs = String(istTime.getSeconds()).padStart(2, "0");
    if (clockEl) clockEl.innerText = `${hrs}:${mins}:${secs} IST`;
  };
  updateClock();
  setInterval(updateClock, 1000);
}

function loadPersistedData() {
  // 1. Instant Embedded Initial State (Zero Loading Screen)
  if (window.QUANT_INITIAL_STATE) {
    applyState(window.QUANT_INITIAL_STATE);
  }

  // 2. Local storage fallback
  try {
    const saved = localStorage.getItem(STORAGE_STATE);
    if (saved) {
      applyState(JSON.parse(saved));
    }
  } catch (e) {
    console.warn("Could not read local storage state:", e);
  }
}

function applyState(state) {
  if (!state) return;
  if (state.active_picks && Array.isArray(state.active_picks)) {
    appState.activePicks = state.active_picks;
  } else if (state.active_pick) {
    appState.activePicks = [state.active_pick];
  }

  if (state.nifty50) {
    appState.nifty = state.nifty50;
    renderNiftyTicker(appState.nifty);
  }

  updatePortfolioBadge();
}

function startCountdownLoop() {
  if (appState.timerInterval) clearInterval(appState.timerInterval);
  appState.countdown = SCAN_INTERVAL_SEC;

  appState.timerInterval = setInterval(() => {
    appState.countdown--;
    const el = document.getElementById("cycleCountdown");
    if (el) el.innerText = `${appState.countdown}s`;

    if (appState.countdown <= 0) {
      appState.countdown = SCAN_INTERVAL_SEC;
      runQuantScanCycle();
    }
  }, 1000);
}

async function runQuantScanCycle() {
  if (appState.isScanning) return;
  appState.isScanning = true;

  try {
    const resp = await fetch("data/quant_state.json?_t=" + Date.now());
    if (resp.ok) {
      const state = await resp.json();
      applyState(state);
      localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
      renderActiveGrid();
    }
    
    // Also fetch history
    const histResp = await fetch("data/quant_history.json?_t=" + Date.now());
    if (histResp.ok) {
      appState.history = await histResp.json();
      renderHistoryTable();
      updateSummaryMetrics();
    }
  } catch (e) {
    console.warn("Background fetch error:", e);
  } finally {
    appState.isScanning = false;
  }
}

function triggerManualRefresh() {
  appState.countdown = SCAN_INTERVAL_SEC;
  const el = document.getElementById("cycleCountdown");
  if (el) el.innerText = `${appState.countdown}s`;
  runQuantScanCycle();
}

function renderNiftyTicker(nifty) {
  const priceEl = document.getElementById("niftyPrice");
  const chgEl = document.getElementById("niftyChange");
  if (!priceEl || !chgEl) return;

  priceEl.innerText = Number(nifty.price || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const chgPct = parseFloat(nifty.change_percent || 0);
  const sign = chgPct >= 0 ? "+" : "";
  chgEl.innerText = `${sign}${nifty.change || 0} (${sign}${chgPct.toFixed(2)}%)`;
  chgEl.className = chgPct >= 0 ? "ticker-chg up" : "ticker-chg down";
}

function updatePortfolioBadge() {
  const badge = document.getElementById("activeStateBadge");
  if (!badge) return;
  const count = appState.activePicks.length;
  badge.innerText = `${count} / 5 POSITIONS ACTIVE`;
  badge.className = count >= 5 ? "active-badge locked" : "active-badge scanning";
}

function renderActiveGrid() {
  const container = document.getElementById("activeGrid");
  if (!container) return;

  const picks = appState.activePicks || [];
  let html = "";

  picks.forEach((p, idx) => {
    const sym = p.symbol;
    const comp = p.company || sym;
    const entry = parseFloat(p.entry_price || 0);
    const curr = parseFloat(p.current_price || entry);
    const sl = parseFloat(p.sl_price || 0);
    const tgt = parseFloat(p.target_price || 0);
    const sl_pct = parseFloat(p.sl_pct || 0.75);
    const tgt_pct = parseFloat(p.target_pct || 1.80);
    const rr = parseFloat(p.rr_ratio || 2.2);
    const pnl_pct = parseFloat(p.pnl_pct || 0);
    const pnl_cls = pnl_pct >= 0 ? "profit" : "loss";
    const sign = pnl_pct >= 0 ? "+" : "";
    const score = p.composite_score || p.buy_score || 85.0;
    const entry_time = (p.entry_time || "").substring(0, 19).replace("T", " ");

    const dist_total = Math.max(0.001, tgt - sl);
    const pct_pos = Math.max(0, Math.min(100, ((curr - sl) / dist_total) * 100));

    html += `
      <div class="active-portfolio-card">
        <div class="card-top-header">
          <div class="card-sym-group">
            <span class="card-slot-badge">#${idx + 1}</span>
            <span class="card-symbol">${sym}</span>
            <span class="badge badge-long">LONG SWING</span>
            <span class="badge badge-score">SCORE ${score}</span>
          </div>
          <div class="card-pnl ${pnl_cls}">
            <span class="pnl-lbl">P&amp;L</span>
            <span class="pnl-val">${sign}${pnl_pct.toFixed(2)}%</span>
          </div>
        </div>

        <div class="card-company-name">${comp}</div>

        <div class="card-metrics-grid">
          <div class="c-metric">
            <span class="cm-label">Entry Price</span>
            <span class="cm-value">₹${entry.toLocaleString("en-IN", {minimumFractionDigits: 2})}</span>
          </div>
          <div class="c-metric">
            <span class="cm-label">Live Spot</span>
            <span class="cm-value highlight">₹${curr.toLocaleString("en-IN", {minimumFractionDigits: 2})}</span>
          </div>
          <div class="c-metric danger">
            <span class="cm-label">Dynamic SL (-${sl_pct.toFixed(2)}%)</span>
            <span class="cm-value">₹${sl.toLocaleString("en-IN", {minimumFractionDigits: 2})}</span>
          </div>
          <div class="c-metric success">
            <span class="cm-label">Dynamic Target (+${tgt_pct.toFixed(2)}%)</span>
            <span class="cm-value">₹${tgt.toLocaleString("en-IN", {minimumFractionDigits: 2})}</span>
          </div>
        </div>

        <div class="card-progress-wrap">
          <div class="card-progress-labels">
            <span class="lbl-sl">SL: ₹${sl.toFixed(2)}</span>
            <span class="lbl-curr">Spot: ₹${curr.toFixed(2)}</span>
            <span class="lbl-tgt">TGT: ₹${tgt.toFixed(2)}</span>
          </div>
          <div class="card-progress-bar">
            <div class="card-progress-fill" style="width: ${pct_pos.toFixed(1)}%"></div>
          </div>
        </div>

        <div class="card-footer-meta">
          <span class="meta-tag">R:R 1:${rr.toFixed(2)}</span>
          <span class="meta-tag">Entry: ${entry_time}</span>
          <span class="meta-tag status-locked">LOCKED UNTIL HIT</span>
        </div>
      </div>
    `;
  });

  // Empty slots up to 5
  for (let s = picks.length + 1; s <= 5; s++) {
    html += `
      <div class="active-portfolio-card empty-slot">
        <div class="empty-slot-content">
          <div class="empty-icon">⏱️</div>
          <div class="empty-title">Scanning for Slot #${s}</div>
          <div class="empty-desc">Evaluating high-conviction delivery swing candidates on 1-min cycle.</div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  updatePortfolioBadge();
}

function renderHistoryTable() {
  const tbody = document.getElementById("historyTbody");
  const counter = document.getElementById("historyCounter");
  if (!tbody) return;

  const hist = appState.history || [];
  if (counter) counter.innerText = `(${hist.length} Completed)`;

  if (hist.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No completed trades recorded yet. Audit log is permanent and immutable.</td></tr>';
    return;
  }

  let rows = "";
  hist.slice(0, 15).forEach(h => {
    const pnl = parseFloat(h.pnl_pct || 0);
    const pnl_cls = pnl >= 0 ? "text-green" : "text-red";
    const sign = pnl >= 0 ? "+" : "";
    const isTarget = (h.outcome || "").includes("TARGET");
    const badge_cls = isTarget ? "badge-profit" : "badge-sl";
    const exitTime = (h.exit_time || "").substring(0, 19).replace("T", " ");

    rows += `
      <tr>
        <td><strong>${h.symbol}</strong></td>
        <td><span class="badge ${badge_cls}">${h.outcome || "RESOLVED"}</span></td>
        <td>₹${Number(h.entry_price || 0).toLocaleString("en-IN", {minimumFractionDigits: 2})}</td>
        <td>₹${Number(h.exit_price || 0).toLocaleString("en-IN", {minimumFractionDigits: 2})}</td>
        <td class="${pnl_cls}"><strong>${sign}${pnl.toFixed(2)}%</strong></td>
        <td>1:${h.rr_ratio || "2.0"}</td>
        <td>${exitTime}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rows;
}

function updateSummaryMetrics() {
  const hist = appState.history || [];
  const total = hist.length;
  let targets = 0;
  let sls = 0;
  let netPnl = 0;

  hist.forEach(h => {
    const pnl = parseFloat(h.pnl_pct || 0);
    netPnl += pnl;
    if ((h.outcome || "").includes("TARGET")) targets++;
    else if ((h.outcome || "").includes("STOP")) sls++;
  });

  const winRate = total > 0 ? ((targets / total) * 100).toFixed(1) : "0.0";
  const pnlSign = netPnl >= 0 ? "+" : "";

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setVal("statTotalPicks", total);
  setVal("statTargetHits", targets);
  setVal("statSlHits", sls);
  setVal("statWinRate", `${winRate}%`);
  setVal("statNetPnl", `${pnlSign}${netPnl.toFixed(2)}%`);
}
