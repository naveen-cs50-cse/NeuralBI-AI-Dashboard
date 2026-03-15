/* ── Enter key ── */
document.getElementById("input").addEventListener("keydown", function(e) {
  if (e.key === "Enter") { 
    e.preventDefault(); 
    document.getElementById("button").click(); 
  }
});

/* ── Spin keyframe ── */
const _s = document.createElement("style");
_s.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(_s);

/* ── Main entry point ── */
async function process_start() {
  const inputEl = document.getElementById("input");
  const query = inputEl.value.trim();
  if (!query) { inputEl.focus(); return; }

  window._lastQuestion = query; // save BEFORE clearing

  setLoading(true);
  const t0 = performance.now();

  try {
    await loadChart(query);
    addHistory(query);
    document.getElementById("m-time").textContent = Math.round(performance.now() - t0) + "ms";
  } catch (err) {
    console.error("Pipeline error:", err);
    showError(err.message);
  } finally {
    setLoading(false);
    inputEl.value = "";
  }
}

/* ── Loading state ── */
function setLoading(on) {
  const btn = document.getElementById("button");
  if (on) {
    btn.classList.add("loading");
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Running...`;
  } else {
    btn.classList.remove("loading");
    btn.innerHTML = `Run Query`;
  }
}

/* ── Stage label (updates button text mid-loading) ── */
function setStage(label) {
  if (!label) return;
  const btn = document.getElementById("button");
  if (btn.classList.contains("loading")) {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .7s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> ${label}`;
  }
}

/* ── Error display ── */
function showError(msg) {
  const placeholder = document.getElementById("chartPlaceholder");
  placeholder.style.display = "flex";
  placeholder.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p style="color:#EF4444;font-size:14px;text-align:center;max-width:260px;margin-top:12px;">${msg}</p>
  `;
  document.getElementById("chartWrap").style.display = "none";
  document.getElementById("dataTable").style.display = "none";
  if (document.getElementById("insightBanner")) {
    document.getElementById("insightBanner").style.display = "none";
  }
}

/* ── Step 1: NL → SQL via Groq ── */
async function loadChart(userQuestion) {
  setStage("Generating SQL...");

  const endpoint = window._csvMode ? "/api/groq-csv" : "/api/groq";
const queryEndpoint = window._csvMode ? "/api/query-csv" : "/api/query";

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: userQuestion })
});


  if (!res.ok) throw new Error(`SQL generation failed (${res.status})`);
  const sqlQuery = await res.json();

  const qa = document.getElementById("queryarea");
  qa.innerHTML = "";
  qa.textContent = sqlQuery;

  await createjsondata(sqlQuery);
}

/* ── Step 2: SQL → rows → AI chart config ── */
async function createjsondata(sqlQuery) {
  setStage("Running query...");

  const res = await fetch(window._csvMode ? "/api/query-csv" : "/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: sqlQuery })
  });
  if (!res.ok) throw new Error(`Query execution failed (${res.status})`);
  const data = await res.json();

  if (!data || data.length === 0) {
    showError("Query returned no data. Try a different question.");
    document.getElementById("m-rows").textContent = "0";
    document.getElementById("m-cols").textContent = "0";
    return;
  }
  
  window._lastData = data;
  document.getElementById("m-rows").textContent = data.length;
  document.getElementById("m-cols").textContent = Object.keys(data[0]).length;

  // Step 3: AI builds Chart.js config
  setStage("Building chart...");

  const chartRes = await fetch("/api/groq-chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data,
      userQuestion: window._lastQuestion,
      sqlQuery
    })
  });
  if (!chartRes.ok) throw new Error(`Chart AI failed (${chartRes.status})`);
  const chartConfig = await chartRes.json();

  document.getElementById("m-type").textContent = (chartConfig.type || "bar").toUpperCase();
  
  if (chartConfig.insight) showInsight(chartConfig.insight);

  document.getElementById("chartPlaceholder").style.display = "none";
  document.getElementById("chartWrap").style.display = "block";
  document.getElementById("chartTypePills").style.display = "flex";

  renderAIChart(chartConfig);
  showDataTable(data);
  setStage(null);
}

/* ── Insight banner (injected above chart) ── */
function showInsight(text) {
  let banner = document.getElementById("insightBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "insightBanner";
    banner.style.cssText = [
      "margin: 20px 24px 0",
      "padding: 12px 16px",
      "background: #EFF6FF", 
      "border: 1px solid #BFDBFE",
      "border-radius: 8px",
      "font-size: 13px",
      "color: #1E3A8A", 
      "line-height: 1.5",
      "display: flex",
      "align-items: flex-start",
      "gap: 10px",
      "font-weight: 500"
    ].join(";");
    const chartCard = document.querySelector(".card-main");
    const chartWrap = document.getElementById("chartWrap");
    chartCard.insertBefore(banner, chartWrap);
  }
  banner.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" style="flex-shrink:0;margin-top:2px">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
    <span>${text}</span>
  `;
  banner.style.display = "flex";
}

/* ── Query history ── */
function addHistory(q) {
  const list = document.getElementById("historyList");
  const empty = list.querySelector(".history-empty");
  if (empty) empty.remove();

  const li = document.createElement("li");
  li.textContent = q;
  li.onclick = () => { document.getElementById("input").value = q; };
  list.insertBefore(li, list.firstChild);

  if (list.children.length > 8) list.removeChild(list.lastChild);
}

/* ── Render AI-generated Chart.js config ── */
let chartInstance = null;

function renderAIChart(config) {
  document.getElementById("downloadBtn").style.display = "flex";
  
  const ctx = document.getElementById("chart");
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // Guarantee light-theme tooltip and polished aesthetics
  config.options = config.options || {};
  config.options.responsive = true;
  config.options.maintainAspectRatio = false;
  config.options.animation = config.options.animation || { duration: 700, easing: "easeOutQuart" };

  if (config.type === "bar") {
    config.data.datasets.forEach(ds => {
      ds.borderSkipped = "bottom"; 
      ds.borderRadius = 4; // Add a slight curve to bars for a modern look
    });
  }
  
  config.options.plugins = config.options.plugins || {};
  config.options.plugins.tooltip = Object.assign({
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    titleColor: "#0F172A",
    bodyColor: "#475569",
    padding: 12,
    cornerRadius: 8,
    boxPadding: 4,
  }, config.options.plugins.tooltip || {});

  try {
    chartInstance = new Chart(ctx, {
      type: config.type || "bar",
      data: config.data,
      options: config.options
    });
  } catch (err) {
    console.error("Chart render failed:", err);
    showError("Chart rendering failed — the AI returned an invalid config.");
  }
}

/* ── Data Table ── */
function showDataTable(data) {
  const div = document.getElementById("dataTable");
  if (!data || data.length === 0) return;
  const cols = Object.keys(data[0]);
  
  let html = `<table>`;
  html += `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  
  data.slice(0, 10).forEach(row => {
    html += `<tr>${cols.map(c => `<td>${row[c] ?? "—"}</td>`).join("")}</tr>`;
  });
  
  html += "</table>";
  div.innerHTML = html;
  div.style.display = "block";
}



// darkmode()



//csvvv

window._csvMode = false;

async function handleCSVUpload(file) {
  if (!file || !file.name.endsWith('.csv')) return;

  document.getElementById("csvStatus").textContent = "Uploading...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/upload-csv", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    window._csvMode = true;
    document.getElementById("csvStatus").textContent = `✓ ${file.name} — ${data.rowCount} rows, ${data.columns.length} cols`;
    document.getElementById("csvStatus").style.color = "#15803d";
    document.getElementById("csvClearBtn").style.display = "block";
    document.querySelector(".csv-upload-btn").classList.add("active");
    document.getElementById("input").placeholder = `Ask about your CSV — e.g. "Show ${data.columns[0]} distribution"`;

  } catch (err) {
    document.getElementById("csvStatus").textContent = "Error: " + err.message;
    document.getElementById("csvStatus").style.color = "#ef4444";
  }
}

function clearCSV() {
  window._csvMode = false;
  document.getElementById("csvStatus").textContent = "";
  document.getElementById("csvClearBtn").style.display = "none";
  document.querySelector(".csv-upload-btn").classList.remove("active");
  document.getElementById("input").placeholder = "e.g., Show average online spend vs store spend by city tier...";
}