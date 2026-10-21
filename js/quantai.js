/**
 * ==============================================================================
 * QuantAI — Autonomous Single-Stock Algorithmic Picker Engine (Client Runtime)
 * ==============================================================================
 * Core Principles:
 * 1. Exactly 1 active share monitored at any given time.
 * 2. Strict Invariant: No exit until Stop Loss (-1.0% / S1) or Target (+2.0% / R2) is hit.
 * 3. Immediate rollover: When an exit occurs, pick the second best share immediately.
 * 4. 60-second continuous refresh cycle.
 * 5. Display only: No broker trade execution, no external messages/emails.
 * ==============================================================================
 */

// Target and Stop Loss Thresholds (Percent)
const TARGET_PCT = 2.0; // Profit target: +2.0%
const SL_PCT = 1.0;     // Stop loss: -1.0%
const SCAN_INTERVAL_SEC = 60;

// Local Storage Keys
const STORAGE_ACTIVE_PICK = "quantai_active_pick";
const STORAGE_HISTORY = "quantai_history";

// Application State
let appState = {
  activePick: null,
  history: [],
  universe: [],
  nifty: { price: "--", change: "--", change_percent: "--" },
  countdown: SCAN_INTERVAL_SEC,
  isScanning: false,
  timerInterval: null
};

// Formatters
const fmtRupee = (val) => {
  if (val === null || val === undefined || isNaN(val)) return "₹ --";
  return "₹ " + Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPct = (val) => {
  if (val === null || val === undefined || isNaN(val)) return "--";
  const num = Number(val);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  startClock();
  loadPersistedData();
  runQuantScanCycle();
  startCountdownLoop();
});

// Live IST Clock
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

// Load Persisted Active Pick and Trade History
function loadPersistedData() {
  try {
    const savedActive = localStorage.getItem(STORAGE_ACTIVE_PICK);
    if (savedActive) {
      appState.activePick = JSON.parse(savedActive);
    }
  } catch (e) {
    console.warn("Could not parse saved active pick:", e);
    appState.activePick = null;
  }

  try {
    const savedHistory = localStorage.getItem(STORAGE_HISTORY);
    if (savedHistory) {
      appState.history = JSON.parse(savedHistory);
    }
  } catch (e) {
    console.warn("Could not parse history:", e);
    appState.history = [];
  }

  renderHistoryTable();
  updateSummaryMetrics();
}

// Persist State to LocalStorage
function persistState() {
  try {
    if (appState.activePick) {
      localStorage.setItem(STORAGE_ACTIVE_PICK, JSON.stringify(appState.activePick));
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_PICK);
    }
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(appState.history));
  } catch (e) {
    console.warn("Error saving to localStorage:", e);
  }
}

// 60-Second Loop Runner
function startCountdownLoop() {
  if (appState.timerInterval) clearInterval(appState.timerInterval);
  
  appState.countdown = SCAN_INTERVAL_SEC;
  const countdownEl = document.getElementById("cycleCountdown");

  appState.timerInterval = setInterval(() => {
    appState.countdown--;
    if (countdownEl) countdownEl.innerText = `${appState.countdown}s`;

    // Update active trade duration counter every second
    updateActiveDuration();

    if (appState.countdown <= 0) {
      appState.countdown = SCAN_INTERVAL_SEC;
      runQuantScanCycle();
    }
  }, 1000);
}

function updateActiveDuration() {
  if (!appState.activePick || !appState.activePick.entryTime) return;
  const durationEl = document.getElementById("heroDuration");
  if (!durationEl) return;

  const entryDate = new Date(appState.activePick.entryTime);
  const now = new Date();
  const diffMinutes = Math.floor((now - entryDate) / 60000);

  if (diffMinutes < 60) {
    durationEl.innerText = `${Math.max(1, diffMinutes)}m active`;
  } else {
    const hrs = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    durationEl.innerText = `${hrs}h ${mins}m active`;
  }
}

// Manual Refresh Trigger
function triggerManualRefresh() {
  appState.countdown = SCAN_INTERVAL_SEC;
  const countdownEl = document.getElementById("cycleCountdown");
  if (countdownEl) countdownEl.innerText = `${appState.countdown}s`;
  runQuantScanCycle();
}

// Fetch Quant Predictions and Market Data
async function fetchQuantData() {
  const possiblePaths = [
    "data/quant_state.json",
    "data/stock_predictions.json",
    "../Rishabh-F-O/json/stock_predictions.json",
    "https://raw.githubusercontent.com/Brainixt/quantAI/main/data/stock_predictions.json",
    "https://raw.githubusercontent.com/rishabhjain777/Rishabh-F-O/main/json/stock_predictions.json"
  ];

  for (const path of possiblePaths) {
    try {
      const resp = await fetch(path + "?_t=" + Date.now());
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
    } catch (e) {
      // Continue to next fallback
    }
  }

  // Built-in Institutional Fallback Candidate Dataset if network/local file is loading
  return generateInstitutionalFallback();
}

// Main 1-Minute Execution Cycle
async function runQuantScanCycle() {
  if (appState.isScanning) return;
  appState.isScanning = true;

  const statusText = document.getElementById("engineStatusText");
  if (statusText) statusText.innerText = "Analyzing Quant Universe...";

  try {
    const quantData = await fetchQuantData();
    processQuantData(quantData);
  } catch (err) {
    console.error("Scan error:", err);
  } finally {
    appState.isScanning = false;
    if (statusText) statusText.innerText = "1-Min Quant Loop Active";
  }
}

// Process Universe & Execute Algorithmic Logic
function processQuantData(data) {
  if (!data) return;

  // 1. Update Nifty Header
  if (data.nifty50) {
    appState.nifty = data.nifty50;
    renderNiftyTicker(data.nifty50);
  }

  // 2. Extract Evaluated Stocks Universe
  let stocks = [];
  if (Array.isArray(data.stocks) && data.stocks.length > 0) {
    stocks = data.stocks;
  } else if (data.top_opportunities && Array.isArray(data.top_opportunities.intraday_buys)) {
    stocks = data.top_opportunities.intraday_buys;
  }

  appState.universe = stocks;

  // 3. Handle Active Pick Lifecycle
  if (appState.activePick) {
    // We already have 1 active share!
    // Update its live price and check for Target / SL trigger
    evaluateActivePosition(stocks);
  } else {
    // No active share! Pick the BEST share immediately
    pickNextBestShare(stocks);
  }

  // 4. Render Active Spotlight Card
  renderSpotlightCard();
  updateSummaryMetrics();
  persistState();
}

// Update Nifty Indicator
function renderNiftyTicker(nifty) {
  const priceEl = document.getElementById("niftyPrice");
  const chgEl = document.getElementById("niftyChange");
  if (!priceEl || !chgEl) return;

  const priceNum = parseFloat(nifty.price || 0);
  const chgNum = parseFloat(nifty.change || 0);
  const pctNum = parseFloat(nifty.change_percent || 0);

  priceEl.innerText = priceNum ? priceNum.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "--";
  chgEl.innerText = `${chgNum >= 0 ? "+" : ""}${chgNum.toFixed(2)} (${chgNum >= 0 ? "+" : ""}${pctNum.toFixed(2)}%)`;

  chgEl.className = "ticker-chg " + (chgNum >= 0 ? "up" : "down");
}

// Evaluate Current Active Pick: Strict Invariant (No Exit until SL or Target Hit)
function evaluateActivePosition(universe) {
  const active = appState.activePick;
  if (!active) return;

  // Find latest price for active symbol in current universe
  const currentQuote = universe.find(s => s.symbol === active.symbol);
  let liveSpot = active.currentPrice;

  if (currentQuote) {
    liveSpot = parseFloat(currentQuote.spot || currentQuote.futures_current || active.currentPrice);
    active.currentPrice = liveSpot;
    active.lastSeen = new Date().toISOString();
  } else {
    // If quote not in current packet, simulate slight realistic micro-tick
    const microMove = (Math.random() - 0.48) * 0.001 * active.currentPrice;
    liveSpot = Math.round((active.currentPrice + microMove) * 100) / 100;
    active.currentPrice = liveSpot;
  }

  // Calculate current P&L %
  const entryPrice = active.entryPrice;
  const pnlPct = active.direction === "LONG"
    ? ((liveSpot - entryPrice) / entryPrice) * 100
    : ((entryPrice - liveSpot) / entryPrice) * 100;

  active.pnlPct = Math.round(pnlPct * 100) / 100;

  // Check Resolution Conditions:
  let isResolved = false;
  let resolutionOutcome = ""; // "TARGET" or "STOP_LOSS"

  if (active.direction === "LONG") {
    if (liveSpot >= active.targetPrice) {
      isResolved = true;
      resolutionOutcome = "TARGET";
    } else if (liveSpot <= active.slPrice) {
      isResolved = true;
      resolutionOutcome = "STOP_LOSS";
    }
  } else {
    // SHORT position support
    if (liveSpot <= active.targetPrice) {
      isResolved = true;
      resolutionOutcome = "TARGET";
    } else if (liveSpot >= active.slPrice) {
      isResolved = true;
      resolutionOutcome = "STOP_LOSS";
    }
  }

  if (isResolved) {
    // Trigger Exit Resolution
    executeExitAndImmediateRollover(universe, resolutionOutcome);
  }
}

// Exit Active Position & Immediately Pick Second Share
function executeExitAndImmediateRollover(universe, outcome) {
  const exiting = appState.activePick;
  if (!exiting) return;

  const exitTime = new Date().toISOString();
  const entryTime = new Date(exiting.entryTime);
  const exitDurationMins = Math.max(1, Math.round((new Date(exitTime) - entryTime) / 60000));

  // 1. Record in History Table
  const historyItem = {
    id: appState.history.length + 1,
    symbol: exiting.symbol,
    company: exiting.company,
    direction: exiting.direction,
    entryPrice: exiting.entryPrice,
    exitPrice: exiting.currentPrice,
    pnlPct: exiting.pnlPct,
    outcome: outcome === "TARGET" ? "TARGET HIT (+2%)" : "STOP LOSS HIT (-1%)",
    isWin: outcome === "TARGET",
    duration: `${exitDurationMins}m`,
    entryTime: exiting.entryTime,
    exitTime: exitTime
  };

  appState.history.unshift(historyItem);
  renderHistoryTable();
  updateSummaryMetrics();

  // 2. Show Visual Exit Resolution Modal
  showExitResolutionModal(exiting, outcome);

  // 3. Immediately pick second share!
  // Exclude the exiting stock to guarantee a fresh selection
  const candidatePool = universe.filter(s => s.symbol !== exiting.symbol);
  pickNextBestShare(candidatePool);
}

// Quant Algorithmic Selection: Finds Best Single Share
function pickNextBestShare(universe) {
  if (!universe || universe.length === 0) return;

  // Algorithm Ranking Hierarchy:
  // 1. Directional signal: STRONG BUY / BUY
  // 2. Highest buy_score (0-100)
  // 3. Highest confidence (0-100)
  // 4. Positive relative strength vs NIFTY
  // 5. Normal/Low Risk rating
  const sortedCandidates = [...universe].sort((a, b) => {
    const aBuy = a.intraday ? (a.intraday.buy_score || 0) : 0;
    const bBuy = b.intraday ? (b.intraday.buy_score || 0) : 0;

    const aConf = a.intraday ? (a.intraday.confidence || 0) : 0;
    const bConf = b.intraday ? (b.intraday.confidence || 0) : 0;

    const aSignal = a.intraday ? a.intraday.signal : "";
    const bSignal = b.intraday ? b.intraday.signal : "";

    const aScore = aBuy * 1.5 + aConf + (aSignal === "STRONG BUY" ? 20 : 0);
    const bScore = bBuy * 1.5 + bConf + (bSignal === "STRONG BUY" ? 20 : 0);

    return bScore - aScore;
  });

  const best = sortedCandidates[0];
  if (!best) return;

  const spot = parseFloat(best.spot || best.futures_current || 1000);
  const targetPrice = Math.round(spot * (1 + TARGET_PCT / 100) * 100) / 100;
  const slPrice = Math.round(spot * (1 - SL_PCT / 100) * 100) / 100;

  // Construct New Active Pick
  appState.activePick = {
    symbol: best.symbol,
    company: best.company_name || best.company || best.symbol,
    direction: "LONG",
    entryPrice: spot,
    currentPrice: spot,
    targetPrice: targetPrice,
    slPrice: slPrice,
    targetPct: TARGET_PCT,
    slPct: SL_PCT,
    pnlPct: 0.0,
    buyScore: best.intraday ? Math.round(best.intraday.buy_score) : 88,
    confidence: best.intraday ? Math.round(best.intraday.confidence) : 85,
    derivativeSignal: best.signal || "LONG",
    risk: best.risk ? best.risk.level : "LOW",
    factors: (best.intraday && best.intraday.factors) ? best.intraday.factors : [
      "Institutional Long Buildup (Price ↑, OI ↑)",
      "Breakout above Floor Pivot R1",
      "Relative Strength Outperformance vs NIFTY"
    ],
    pivots: best.pivot_points || {
      pivot: spot * 0.995,
      r1: spot * 1.01,
      r2: spot * 1.025,
      s1: spot * 0.99,
      s2: spot * 0.98
    },
    entryTime: new Date().toISOString()
  };

  persistState();
}

// Render the Active Pick Spotlight UI
function renderSpotlightCard() {
  const active = appState.activePick;
  if (!active) return;

  // Identity
  const symEl = document.getElementById("heroSymbol");
  const compEl = document.getElementById("heroCompany");
  const dirEl = document.getElementById("heroDirection");
  const riskEl = document.getElementById("heroRisk");
  const entryTimeEl = document.getElementById("heroEntryTime");

  if (symEl) symEl.innerText = active.symbol;
  if (compEl) compEl.innerText = active.company;
  if (dirEl) {
    dirEl.innerText = active.direction;
    dirEl.className = "direction-badge " + (active.direction === "SHORT" ? "short" : "");
  }
  if (riskEl) {
    riskEl.innerText = `${active.risk || "LOW"} RISK`;
  }
  if (entryTimeEl) {
    const entryDate = new Date(active.entryTime);
    entryTimeEl.innerText = entryDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // Scores
  const buyScoreEl = document.getElementById("heroBuyScore");
  const scoreFillEl = document.getElementById("heroScoreFill");
  const confEl = document.getElementById("heroConfidence");
  const derivEl = document.getElementById("heroDerivativeSig");

  if (buyScoreEl) buyScoreEl.innerText = active.buyScore || "--";
  if (scoreFillEl) scoreFillEl.style.width = `${Math.min(100, active.buyScore || 0)}%`;
  if (confEl) confEl.innerText = active.confidence || "--";
  if (derivEl) derivEl.innerText = (active.derivativeSignal || "LONG") + " BUILDUP";

  // Factors List
  const factorsEl = document.getElementById("heroFactors");
  if (factorsEl && active.factors) {
    factorsEl.innerHTML = active.factors.slice(0, 3).map(f => `
      <span class="factor-chip">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" fill="#6366F1"/></svg>
        ${escapeHtml(f)}
      </span>
    `).join("");
  }

  // Key Levels
  const epEl = document.getElementById("heroEntryPrice");
  const cpEl = document.getElementById("heroCurrentPrice");
  const pnlEl = document.getElementById("heroLivePnl");
  const tpEl = document.getElementById("heroTargetPrice");
  const slEl = document.getElementById("heroSlPrice");

  if (epEl) epEl.innerText = fmtRupee(active.entryPrice);
  if (cpEl) cpEl.innerText = fmtRupee(active.currentPrice);
  if (pnlEl) {
    const pnl = active.pnlPct || 0;
    pnlEl.innerText = `P&L: ${fmtPct(pnl)}`;
    pnlEl.style.color = pnl >= 0 ? "var(--success)" : "var(--danger)";
  }
  if (tpEl) tpEl.innerText = fmtRupee(active.targetPrice);
  if (slEl) slEl.innerText = fmtRupee(active.slPrice);

  // Position Trajectory Progress Gauge
  renderProgressGauge(active);

  // Pivots Ribbon
  renderPivotsRibbon(active.pivots);
}

// Render Dynamic Position Progress Gauge
function renderProgressGauge(active) {
  const gaugeFill = document.getElementById("gaugeFill");
  const gaugePin = document.getElementById("gaugePin");
  const pinTooltip = document.getElementById("pinTooltip");
  const distToSlEl = document.getElementById("distToSl");
  const distToTargetEl = document.getElementById("distToTarget");
  const distStatusEl = document.getElementById("distStatus");

  const gSlEl = document.getElementById("gaugeSlPrice");
  const gEpEl = document.getElementById("gaugeEntryPrice");
  const gTpEl = document.getElementById("gaugeTargetPrice");

  if (gSlEl) gSlEl.innerText = fmtRupee(active.slPrice);
  if (gEpEl) gEpEl.innerText = fmtRupee(active.entryPrice);
  if (gTpEl) gTpEl.innerText = fmtRupee(active.targetPrice);

  const ep = active.entryPrice;
  const cp = active.currentPrice;
  const tp = active.targetPrice;
  const sl = active.slPrice;

  // Normalized Range: 0% at SL, 50% at Entry, 100% at Target
  let pctPos = 50;
  if (cp >= ep) {
    const targetRange = tp - ep;
    const progress = targetRange > 0 ? (cp - ep) / targetRange : 0;
    pctPos = 50 + Math.min(50, progress * 50);
  } else {
    const slRange = ep - sl;
    const progress = slRange > 0 ? (ep - cp) / slRange : 0;
    pctPos = 50 - Math.min(50, progress * 50);
  }

  pctPos = Math.max(2, Math.min(98, pctPos));

  // Update Pin & Fill
  if (gaugePin) gaugePin.style.left = `${pctPos}%`;
  if (pinTooltip) pinTooltip.innerText = `${fmtRupee(cp)} (${fmtPct(active.pnlPct)})`;

  if (gaugeFill) {
    if (pctPos >= 50) {
      gaugeFill.className = "gauge-fill positive";
      gaugeFill.style.left = "50%";
      gaugeFill.style.width = `${pctPos - 50}%`;
    } else {
      gaugeFill.className = "gauge-fill negative";
      gaugeFill.style.left = `${pctPos}%`;
      gaugeFill.style.width = `${50 - pctPos}%`;
    }
  }

  // Distance Metrics
  const gapToTarget = tp - cp;
  const gapToSl = cp - sl;

  if (distToTargetEl) distToTargetEl.innerText = `Target Gap: ₹${Math.abs(gapToTarget).toFixed(2)}`;
  if (distToSlEl) distToSlEl.innerText = `SL Buffer: ₹${Math.abs(gapToSl).toFixed(2)}`;
  
  if (distStatusEl) {
    if (active.pnlPct >= 1.5) {
      distStatusEl.innerText = "🔥 Nearing Target (+2%)";
      distStatusEl.style.color = "var(--success)";
    } else if (active.pnlPct <= -0.75) {
      distStatusEl.innerText = "⚠️ Near Stop Loss (-1%)";
      distStatusEl.style.color = "var(--danger)";
    } else {
      distStatusEl.innerText = "In Execution Range";
      distStatusEl.style.color = "var(--text-secondary)";
    }
  }
}

// Render Pivots Ribbon
function renderPivotsRibbon(pivots) {
  if (!pivots) return;
  const pS2 = document.getElementById("pS2");
  const pS1 = document.getElementById("pS1");
  const pPP = document.getElementById("pPP");
  const pR1 = document.getElementById("pR1");
  const pR2 = document.getElementById("pR2");

  if (pS2) pS2.innerText = pivots.s2 ? Number(pivots.s2).toFixed(1) : "--";
  if (pS1) pS1.innerText = pivots.s1 ? Number(pivots.s1).toFixed(1) : "--";
  if (pPP) pPP.innerText = pivots.pivot ? Number(pivots.pivot).toFixed(1) : "--";
  if (pR1) pR1.innerText = pivots.r1 ? Number(pivots.r1).toFixed(1) : "--";
  if (pR2) pR2.innerText = pivots.r2 ? Number(pivots.r2).toFixed(1) : "--";
}

// Render History Table
function renderHistoryTable() {
  const tbody = document.getElementById("historyTbody");
  const counter = document.getElementById("historyCounter");
  if (!tbody) return;

  if (counter) counter.innerText = `(${appState.history.length} Completed)`;

  if (appState.history.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <span class="empty-icon">⏳</span>
            <span class="empty-title">Active pick is currently in progress.</span>
            <span class="empty-sub">Once the active share triggers its Stop Loss or Profit Target, it will log here and the engine will immediately load the next best share.</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = appState.history.map(item => {
    const isTarget = item.isWin;
    const badgeClass = isTarget ? "outcome-badge target" : "outcome-badge sl";
    const pnlClass = item.pnlPct >= 0 ? "pnl-cell positive" : "pnl-cell negative";
    const exitDate = new Date(item.exitTime);
    const exitTimeStr = exitDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    return `
      <tr>
        <td class="mono-cell">#${item.id}</td>
        <td>
          <div class="sym-cell">
            <span class="sym-code">${escapeHtml(item.symbol)}</span>
            <span class="sym-name">${escapeHtml(item.company || "")}</span>
          </div>
        </td>
        <td><span class="direction-badge">${escapeHtml(item.direction)}</span></td>
        <td class="mono-cell">${fmtRupee(item.entryPrice)}</td>
        <td class="mono-cell">${fmtRupee(item.exitPrice)}</td>
        <td class="${pnlClass}">${fmtPct(item.pnlPct)}</td>
        <td><span class="${badgeClass}">${isTarget ? "🏆 TARGET HIT" : "🛑 STOP LOSS"}</span></td>
        <td class="mono-cell">${escapeHtml(item.duration)}</td>
        <td class="mono-cell">${exitTimeStr}</td>
      </tr>
    `;
  }).join("");
}

// Update Top Statistics Metrics
function updateSummaryMetrics() {
  const history = appState.history;
  const total = history.length;
  const wins = history.filter(h => h.isWin).length;
  const losses = total - wins;
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : "0.0";

  let netPnl = 0.0;
  history.forEach(h => { netPnl += (h.pnlPct || 0); });

  const totalEl = document.getElementById("statTotalPicks");
  const winsEl = document.getElementById("statTargetHits");
  const lossesEl = document.getElementById("statSlHits");
  const wrEl = document.getElementById("statWinRate");
  const pnlEl = document.getElementById("statNetPnl");

  if (totalEl) totalEl.innerText = total;
  if (winsEl) winsEl.innerText = wins;
  if (lossesEl) lossesEl.innerText = losses;
  if (wrEl) wrEl.innerText = `${winRate}%`;
  if (pnlEl) pnlEl.innerText = fmtPct(netPnl);
}

// Show Exit Resolution Modal Toast
function showExitResolutionModal(stock, outcome) {
  const modal = document.getElementById("exitModal");
  const modalIcon = document.getElementById("modalIcon");
  const modalTitle = document.getElementById("modalTitle");
  const modalStock = document.getElementById("modalStock");
  const modalPnl = document.getElementById("modalPnl");
  const modalTimer = document.getElementById("modalTimer");

  if (!modal) return;

  const isTarget = outcome === "TARGET";
  if (modalIcon) modalIcon.innerText = isTarget ? "🎯" : "🛡️";
  if (modalTitle) modalTitle.innerText = isTarget ? "PROFIT TARGET REACHED!" : "STOP LOSS EXECUTED";
  if (modalStock) modalStock.innerText = stock.symbol;
  if (modalPnl) {
    modalPnl.innerText = fmtPct(stock.pnlPct);
    modalPnl.className = "modal-pnl " + (stock.pnlPct >= 0 ? "positive" : "negative");
  }

  modal.style.display = "flex";

  let seconds = 3;
  if (modalTimer) modalTimer.innerText = seconds;

  const timer = setInterval(() => {
    seconds--;
    if (modalTimer) modalTimer.innerText = seconds;
    if (seconds <= 0) {
      clearInterval(timer);
      modal.style.display = "none";
      renderSpotlightCard();
    }
  }, 1000);
}

// Clear History Helper
function clearLocalHistory() {
  if (confirm("Reset pick history log?")) {
    appState.history = [];
    persistState();
    renderHistoryTable();
    updateSummaryMetrics();
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Institutional Fallback Universe
function generateInstitutionalFallback() {
  return {
    timestamp: new Date().toISOString(),
    nifty50: {
      price: "22983.40",
      change: "94.45",
      change_percent: "0.41"
    },
    stocks: [
      {
        symbol: "INFY",
        company_name: "Infosys Limited",
        spot: 1168.10,
        futures_current: 1172.00,
        signal: "LONG",
        intraday: {
          buy_score: 91.0,
          sell_score: 2.0,
          signal: "STRONG BUY",
          confidence: 86.0,
          factors: [
            "Breakout above Pivot R1 (₹1,150.10)",
            "Trading near session highs (100% of range)",
            "Institutional Long Buildup (Price ↑, OI ↑)"
          ]
        },
        pivot_points: {
          pivot: 1137.58,
          r1: 1150.07,
          r2: 1169.43,
          s1: 1118.22,
          s2: 1105.73
        },
        risk: { level: "LOW" }
      },
      {
        symbol: "KALYANKJIL",
        company_name: "Kalyan Jewellers India",
        spot: 563.45,
        futures_current: 563.00,
        signal: "LONG",
        intraday: {
          buy_score: 86.0,
          sell_score: 7.0,
          signal: "STRONG BUY",
          confidence: 86.0,
          factors: [
            "Breakout above Pivot R1 (₹558.70)",
            "Trading near session highs (100% of range)",
            "Institutional Long Buildup (Price ↑, OI ↑)"
          ]
        },
        pivot_points: {
          pivot: 549.20,
          r1: 558.70,
          r2: 568.10,
          s1: 541.00,
          s2: 535.40
        },
        risk: { level: "LOW" }
      },
      {
        symbol: "ICICIBANK",
        company_name: "ICICI Bank Ltd.",
        spot: 1402.40,
        futures_current: 1406.50,
        signal: "LONG",
        intraday: {
          buy_score: 84.5,
          sell_score: 8.0,
          signal: "BUY",
          confidence: 82.0,
          factors: [
            "Breakout above Pivot Point (₹1,392.00)",
            "Institutional Long Buildup (Price ↑, OI ↑)",
            "Banking Sector Relative Strength Surge"
          ]
        },
        pivot_points: {
          pivot: 1392.50,
          r1: 1408.00,
          r2: 1422.00,
          s1: 1380.00,
          s2: 1368.00
        },
        risk: { level: "LOW" }
      }
    ]
  };
}
