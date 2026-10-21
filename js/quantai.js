/**
 * ==============================================================================
 * QuantAI — Autonomous Single-Stock Algorithmic Picker Engine (Delivery/Swing)
 * ==============================================================================
 * Dynamic Delivery Algorithm:
 * 1. Exactly 1 active share monitored at any given time.
 * 2. Strict Invariant: No exit until Dynamic Stop Loss (2.5% to 5.5% / S1) or
 *    Dynamic Target (5.0% to 14.0% / R2/R3 with >= 1:2.0+ R:R) is hit.
 * 3. Immediate rollover: When an exit occurs, pick the second best delivery share immediately.
 * 4. 60-second continuous refresh cycle.
 * 5. Display only: No broker trade execution, no external messages/emails.
 * ==============================================================================
 */

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
      const parsed = JSON.parse(savedActive);
      // Migrate if old hardcoded 1% / 2% pick was stored
      if (parsed && (!parsed.mode || parsed.targetPct === 2.0)) {
        appState.activePick = null;
      } else {
        appState.activePick = parsed;
      }
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
    "../Rishabh-F-O/json/stock_predictions.json"
  ];

  for (const path of possiblePaths) {
    try {
      const resp = await fetch(path + "?_t=" + Date.now());
      if (resp.ok) {
        const data = await resp.json();
        // If data is quant_state.json with active_pick, use it directly
        if (data.active_pick && data.active_pick.symbol) {
          appState.activePick = data.active_pick;
          if (data.nifty50) appState.nifty = data.nifty50;
        }
        return data;
      }
    } catch (e) {
      // Continue to next fallback
    }
  }

  // Built-in Institutional Fallback Candidate Dataset
  return generateInstitutionalFallback();
}

// Main 1-Minute Execution Cycle
async function runQuantScanCycle() {
  if (appState.isScanning) return;
  appState.isScanning = true;

  const statusText = document.getElementById("engineStatusText");
  if (statusText) statusText.innerText = "Scanning Delivery Universe...";

  try {
    const quantData = await fetchQuantData();
    processQuantData(quantData);
  } catch (err) {
    console.error("Scan error:", err);
  } finally {
    appState.isScanning = false;
    if (statusText) statusText.innerText = "1-Min Delivery Loop Active";
  }
}

// Process Universe & Execute Dynamic Algorithmic Logic
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
  } else if (data.top_opportunities && Array.isArray(data.top_opportunities.short_term_buys)) {
    stocks = data.top_opportunities.short_term_buys;
  } else if (data.top_opportunities && Array.isArray(data.top_opportunities.intraday_buys)) {
    stocks = data.top_opportunities.intraday_buys;
  }

  appState.universe = stocks;

  // 3. Handle Active Pick Lifecycle
  if (appState.activePick) {
    // We already have 1 active share!
    // Update its live price and check for Dynamic Target / SL trigger
    evaluateActivePosition(stocks);
  } else {
    // No active share! Pick the BEST delivery share immediately
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

// Evaluate Current Active Pick: Strict Invariant (No Premature Exit until Dynamic SL or Target Hit)
function evaluateActivePosition(universe) {
  const active = appState.activePick;
  if (!active) return;

  // Find latest price for active symbol in current universe
  const currentQuote = universe.find(s => s.symbol === active.symbol);
  let liveSpot = active.current_price || active.currentPrice;

  if (currentQuote) {
    liveSpot = parseFloat(currentQuote.spot || currentQuote.futures_current || liveSpot);
    active.current_price = liveSpot;
    active.currentPrice = liveSpot;
    active.lastSeen = new Date().toISOString();
  }

  // Calculate current P&L %
  const entryPrice = parseFloat(active.entry_price || active.entryPrice);
  const pnlPct = ((liveSpot - entryPrice) / entryPrice) * 100;
  active.pnl_pct = Math.round(pnlPct * 100) / 100;
  active.pnlPct = active.pnl_pct;

  const targetPrice = parseFloat(active.target_price || active.targetPrice);
  const slPrice = parseFloat(active.sl_price || active.slPrice);

  // Check Dynamic Resolution Conditions:
  let isResolved = false;
  let resolutionOutcome = ""; // "TARGET" or "STOP_LOSS"

  if (liveSpot >= targetPrice) {
    isResolved = true;
    resolutionOutcome = "TARGET";
  } else if (liveSpot <= slPrice) {
    isResolved = true;
    resolutionOutcome = "STOP_LOSS";
  }

  if (isResolved) {
    // Trigger Exit Resolution
    executeExitAndImmediateRollover(universe, resolutionOutcome);
  }
}

// Exit Active Position & Immediately Pick Second Delivery Share
function executeExitAndImmediateRollover(universe, outcome) {
  const exiting = appState.activePick;
  if (!exiting) return;

  const exitTime = new Date().toISOString();
  const entryTime = new Date(exiting.entry_time || exiting.entryTime);
  const exitDurationMins = Math.max(1, Math.round((new Date(exitTime) - entryTime) / 60000));

  const tgtPct = exiting.target_pct || exiting.targetPct || 8.0;
  const slPct = exiting.sl_pct || exiting.slPct || 3.5;
  const rrRatio = exiting.rr_ratio || 2.2;

  // 1. Record in History Table
  const historyItem = {
    id: appState.history.length + 1,
    symbol: exiting.symbol,
    company: exiting.company,
    direction: exiting.direction || "LONG",
    mode: "DELIVERY",
    entryPrice: exiting.entry_price || exiting.entryPrice,
    exitPrice: exiting.current_price || exiting.currentPrice,
    pnlPct: exiting.pnl_pct || exiting.pnlPct,
    targetPct: tgtPct,
    slPct: slPct,
    rrRatio: rrRatio,
    outcome: outcome === "TARGET" ? `TARGET HIT (+${tgtPct}%)` : `STOP LOSS HIT (-${slPct}%)`,
    isWin: outcome === "TARGET",
    duration: `${exitDurationMins}m`,
    entryTime: exiting.entry_time || exiting.entryTime,
    exitTime: exitTime
  };

  appState.history.unshift(historyItem);
  renderHistoryTable();
  updateSummaryMetrics();

  // 2. Show Visual Exit Resolution Modal
  showExitResolutionModal(exiting, outcome);

  // 3. Immediately pick second delivery share!
  // Exclude the exiting stock to guarantee a fresh selection
  const candidatePool = universe.filter(s => s.symbol !== exiting.symbol);
  pickNextBestShare(candidatePool);
}

// Dynamic Delivery Calculation Algorithm
function calculateDynamicLevels(stock, spotPrice) {
  const piv = stock.pivot_points || {};
  const s1 = parseFloat(piv.s1 || (spotPrice * 0.97));
  const s2 = parseFloat(piv.s2 || (spotPrice * 0.95));
  const r2 = parseFloat(piv.r2 || (spotPrice * 1.05));
  const r3 = parseFloat(piv.r3 || (spotPrice * 1.08));

  const risk = stock.risk || {};
  const rangeSpan = parseFloat(risk.range_span_pct || 2.6);

  // 1. Dynamic Stop Loss Anchor
  let pivSlPct;
  let slAnchor;
  if (spotPrice > s1 && ((spotPrice - s1) / spotPrice * 100.0) >= 1.5) {
    pivSlPct = ((spotPrice - s1) / spotPrice) * 100.0;
    slAnchor = "Pivot S1 Structural Floor";
  } else {
    pivSlPct = ((spotPrice - s2) / spotPrice) * 100.0;
    slAnchor = "Pivot S2 Extended Support";
  }

  const volSlPct = rangeSpan * 1.35;
  // Delivery boundaries: Minimum 2.5% anti-noise floor, capped at 5.5%
  const dynSlPct = Math.round(Math.max(2.5, Math.min(5.5, Math.max(pivSlPct, volSlPct))) * 100) / 100;
  const slPrice = Math.round(spotPrice * (1.0 - dynSlPct / 100.0) * 100) / 100;

  // 2. Dynamic Target Anchor
  const distToR2 = ((r2 - spotPrice) / spotPrice) * 100.0;
  const distToR3 = ((r3 - spotPrice) / spotPrice) * 100.0;

  let pivTgtPct;
  let tgtAnchor;
  if (distToR2 >= 4.5) {
    pivTgtPct = distToR2;
    tgtAnchor = "Pivot R2 Expansion";
  } else {
    pivTgtPct = Math.max(distToR3, distToR2);
    tgtAnchor = "Pivot R3 Breakout Runway";
  }

  // Institutional Asymmetric Risk:Reward Expectancy (Minimum 2.1x)
  const st = stock.short_term || {};
  const mcg = parseFloat(st.mc_g || 70.0);
  const rrMultiplier = mcg >= 80 ? 2.3 : 2.1;
  const rrTargetPct = dynSlPct * rrMultiplier;

  // Delivery boundaries: Minimum 5.0%, capped at 14.0%
  const dynTgtPct = Math.round(Math.max(5.0, Math.min(14.0, Math.max(pivTgtPct, rrTargetPct))) * 100) / 100;
  const targetPrice = Math.round(spotPrice * (1.0 + dynTgtPct / 100.0) * 100) / 100;

  const rrRatio = Math.round((dynTgtPct / dynSlPct) * 100) / 100;

  return {
    slPct: dynSlPct,
    targetPct: dynTgtPct,
    slPrice: slPrice,
    targetPrice: targetPrice,
    rrRatio: rrRatio,
    slMethod: `${slAnchor} (${dynSlPct.toFixed(2)}%)`,
    targetMethod: `${tgtAnchor} (${dynTgtPct.toFixed(2)}% | 1:${rrRatio.toFixed(1)} R:R)`
  };
}

// Quant Algorithmic Selection: Finds Best Delivery Share
function pickNextBestShare(universe) {
  if (!universe || universe.length === 0) return;

  // Delivery Ranking Hierarchy:
  // 1. Short-Term Buy Score (0-100) + Fundamental Quality & Growth
  // 2. Short-Term Signal (STRONG BUY / BUY)
  // 3. Margin of Safety Valuation
  // 4. Low Risk Volatility Profile
  const sortedCandidates = [...universe].sort((a, b) => {
    const aST = a.short_term ? (a.short_term.buy_score || 0) : 0;
    const bST = b.short_term ? (b.short_term.buy_score || 0) : 0;

    const aQ = a.short_term ? (a.short_term.mc_q || 60) : 60;
    const bQ = b.short_term ? (b.short_term.mc_q || 60) : 60;

    const aG = a.short_term ? (a.short_term.mc_g || 60) : 60;
    const bG = b.short_term ? (b.short_term.mc_g || 60) : 60;

    const aScore = (aST * 0.45) + (aQ * 0.25) + (aG * 0.25) + (a.intraday ? a.intraday.buy_score * 0.1 : 0);
    const bScore = (bST * 0.45) + (bQ * 0.25) + (bG * 0.25) + (b.intraday ? b.intraday.buy_score * 0.1 : 0);

    return bScore - aScore;
  });

  const best = sortedCandidates[0];
  if (!best) return;

  const spot = parseFloat(best.spot || best.futures_current || 1000);
  const dynLevels = calculateDynamicLevels(best, spot);

  // Construct New Active Pick
  appState.activePick = {
    symbol: best.symbol,
    company: best.company_name || best.company || best.symbol,
    direction: "LONG",
    mode: "DELIVERY",
    entry_price: spot,
    current_price: spot,
    entryPrice: spot,
    currentPrice: spot,
    target_price: dynLevels.targetPrice,
    sl_price: dynLevels.slPrice,
    targetPrice: dynLevels.targetPrice,
    slPrice: dynLevels.slPrice,
    target_pct: dynLevels.targetPct,
    sl_pct: dynLevels.slPct,
    targetPct: dynLevels.targetPct,
    slPct: dynLevels.slPct,
    rr_ratio: dynLevels.rrRatio,
    sl_method: dynLevels.slMethod,
    target_method: dynLevels.targetMethod,
    pnl_pct: 0.0,
    pnlPct: 0.0,
    buy_score: best.short_term ? Math.round(best.short_term.buy_score) : (best.intraday ? Math.round(best.intraday.buy_score) : 88),
    confidence: best.short_term ? Math.round(best.short_term.confidence) : 85,
    derivativeSignal: best.signal || "LONG",
    risk_level: best.risk ? best.risk.level : "LOW",
    factors: (best.short_term && best.short_term.factors) ? best.short_term.factors : [
      "Superior Quality & Growth Profile for Multi-Day Delivery",
      "Structural Consolidation established above Floor Pivot",
      "Dynamic Volatility & Pivot-Anchored Risk-to-Reward"
    ],
    pivots: best.pivot_points || {
      pivot: spot * 0.99,
      r1: spot * 1.02,
      r2: spot * 1.05,
      s1: spot * 0.97,
      s2: spot * 0.95
    },
    entry_time: new Date().toISOString(),
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
    dirEl.innerText = `${active.direction || "LONG"} (DELIVERY)`;
    dirEl.className = "direction-badge";
  }
  if (riskEl) {
    riskEl.innerText = `${active.risk_level || active.risk || "LOW"} RISK`;
  }
  if (entryTimeEl) {
    const entryDate = new Date(active.entry_time || active.entryTime);
    entryTimeEl.innerText = entryDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // Scores
  const buyScoreEl = document.getElementById("heroBuyScore");
  const scoreFillEl = document.getElementById("heroScoreFill");
  const confEl = document.getElementById("heroConfidence");
  const derivEl = document.getElementById("heroDerivativeSig");

  const bScore = active.buy_score || active.buyScore || 85;
  if (buyScoreEl) buyScoreEl.innerText = bScore;
  if (scoreFillEl) scoreFillEl.style.width = `${Math.min(100, bScore)}%`;
  if (confEl) confEl.innerText = active.confidence || 80;
  if (derivEl) derivEl.innerText = (active.derivativeSignal || active.derivative_signal || "LONG") + " BUILDUP";

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
  const tpSub = document.getElementById("heroTargetSub");
  const slSub = document.getElementById("heroSlSub");

  const ep = active.entry_price || active.entryPrice;
  const cp = active.current_price || active.currentPrice;
  const tp = active.target_price || active.targetPrice;
  const sl = active.sl_price || active.slPrice;
  const tgtPct = active.target_pct || active.targetPct || 8.0;
  const slPct = active.sl_pct || active.slPct || 3.5;
  const rrRatio = active.rr_ratio || 2.2;

  if (epEl) epEl.innerText = fmtRupee(ep);
  if (cpEl) cpEl.innerText = fmtRupee(cp);
  if (pnlEl) {
    const pnl = active.pnl_pct || active.pnlPct || 0;
    pnlEl.innerText = `P&L: ${fmtPct(pnl)}`;
    pnlEl.style.color = pnl >= 0 ? "var(--success)" : "var(--danger)";
  }
  if (tpEl) tpEl.innerText = fmtRupee(tp);
  if (slEl) slEl.innerText = fmtRupee(sl);

  if (tpSub) tpSub.innerText = `+${tgtPct}% (1:${rrRatio} R:R)`;
  if (slSub) slSub.innerText = `-${slPct}% (Support Buffer)`;

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

  const ep = parseFloat(active.entry_price || active.entryPrice);
  const cp = parseFloat(active.current_price || active.currentPrice);
  const tp = parseFloat(active.target_price || active.targetPrice);
  const sl = parseFloat(active.sl_price || active.slPrice);
  const pnl = parseFloat(active.pnl_pct || active.pnlPct || 0);

  if (gSlEl) gSlEl.innerText = fmtRupee(sl);
  if (gEpEl) gEpEl.innerText = fmtRupee(ep);
  if (gTpEl) gTpEl.innerText = fmtRupee(tp);

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
  if (pinTooltip) pinTooltip.innerText = `${fmtRupee(cp)} (${fmtPct(pnl)})`;

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
    if (gapToTarget <= (tp - ep) * 0.25) {
      distStatusEl.innerText = "🔥 Nearing Dynamic Target";
      distStatusEl.style.color = "var(--success)";
    } else if (gapToSl <= (ep - sl) * 0.25) {
      distStatusEl.innerText = "⚠️ Near Dynamic Support SL";
      distStatusEl.style.color = "var(--danger)";
    } else {
      distStatusEl.innerText = "In Delivery Swing Range";
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
            <span class="empty-title">Active delivery pick is currently in progress.</span>
            <span class="empty-sub">Once the active share triggers its Dynamic Stop Loss or Profit Target, it will log here and the engine will immediately load the next best delivery share.</span>
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
        <td><span class="direction-badge">${escapeHtml(item.direction)} (DELIVERY)</span></td>
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
  if (modalTitle) modalTitle.innerText = isTarget ? "DYNAMIC PROFIT TARGET REACHED!" : "DYNAMIC STOP LOSS EXECUTED";
  if (modalStock) modalStock.innerText = stock.symbol;
  if (modalPnl) {
    const pnl = stock.pnl_pct || stock.pnlPct || 0;
    modalPnl.innerText = fmtPct(pnl);
    modalPnl.className = "modal-pnl " + (pnl >= 0 ? "positive" : "negative");
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
        symbol: "DIVISLAB",
        company_name: "Divi's Laboratories",
        spot: 9153.50,
        futures_current: 9170.00,
        signal: "LONG",
        short_term: {
          buy_score: 92.0,
          confidence: 88.0,
          signal: "STRONG BUY",
          mc_q: 85.0,
          mc_g: 82.0,
          mc_v: 65.0,
          factors: [
            "Superior Quality & Growth Profile for Multi-Day Delivery",
            "Structural Base Breakout above Floor Pivot R1",
            "Dynamic Asymmetric Risk-Reward Expansion (1:2.3 R:R)"
          ]
        },
        pivot_points: {
          pivot: 8940.0,
          r1: 9140.0,
          r2: 9550.0,
          r3: 10035.0,
          s1: 8770.0,
          s2: 8520.0
        },
        risk: { level: "LOW", range_span_pct: 2.8 }
      }
    ]
  };
}
