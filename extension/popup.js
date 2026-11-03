const $ = (id) => document.getElementById(id);
const A = window.ClaudeUsageApi;
let data = null;
let lastError = null;

const color = (p) => (p >= 85 ? "var(--bad)" : p >= 60 ? "var(--warn)" : "var(--ok)");

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

function render() {
  const rows = $("rows");
  rows.textContent = "";
  if (!data || !data.entries || !data.entries.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = lastError ? A.errorText(lastError) : "Waiting for data. Keep a claude.ai tab open and it will appear here.";
    rows.appendChild(p);
    $("status").textContent = "";
    return;
  }
  for (const e of data.entries) {
    const row = document.createElement("div");
    row.className = "row " + e.kind;
    const head = document.createElement("div");
    head.className = "head";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent =
      e.kind === "session" ? "Session"
      : e.kind === "weekly" ? "Weekly · " + e.label
      : e.label;
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = e.kind === "extra"
      ? A.money(e.used, e.currency) + (e.limit != null ? " / " + A.money(e.limit, e.currency) : "")
      : Math.round(e.percent) + "%";
    if (e.kind === "extra") pct.style.fontSize = "16px";
    head.append(label, pct);
    row.appendChild(head);

    if (e.kind !== "extra" || e.limit != null) {
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = Math.min(100, e.percent) + "%";
      fill.style.background = color(e.percent);
      bar.appendChild(fill);
      row.appendChild(bar);
    }

    const reset = document.createElement("div");
    reset.className = "reset";
    reset.dataset.resetAt = e.resetAt || "";
    row.appendChild(reset);
    rows.appendChild(row);
  }
  tick();
}

function tick() {
  document.querySelectorAll(".reset").forEach((el) => {
    const at = +el.dataset.resetAt;
    el.textContent = at ? `Resets in ${A.duration(at - Date.now())} · ${A.clock(at)}` : "";
  });
  if (data && data.updatedAt) $("status").textContent = "Updated " + ago(data.updatedAt);
}

function lastReplyText(r) {
  if (!r) return "";
  const fmt = (x) => (x <= 0 ? "<1%" : "+" + Math.round(x * 10) / 10 + "%");
  const parts = [];
  if (r.session != null) parts.push(fmt(r.session) + " session");
  if (r.week != null && r.week > 0) parts.push(fmt(r.week) + " week");
  return parts.length ? "Last reply: " + parts.join(", ") + " (" + ago(r.at) + ")" : "";
}

async function load() {
  const s = await chrome.storage.local.get([
    "usage", "statusLineEnabled", "alertsEnabled", "alertReset",
    "lastReply", "apiError", "apiErrorRaw", "apiDebug", "orgFrom",
  ]);
  data = s.usage || null;
  lastError = s.apiError || null;
  $("statusline").checked = s.statusLineEnabled !== false;
  $("alerts").checked = s.alertsEnabled !== false;
  $("alertReset").checked = s.alertReset !== false;
  $("last").textContent = lastReplyText(s.lastReply);
  $("raw").textContent = [
    "Last error: " + (s.apiError ? s.apiError + " (" + (s.apiErrorRaw || "") + ")" : "none"),
    "Org found via: " + (s.orgFrom || "n/a"),
    "Response fields: " + ((s.apiDebug && s.apiDebug.keys.join(", ")) || "n/a"),
  ].join("\n");
  render();
}

$("refresh").addEventListener("click", async () => {
  const btn = $("refresh");
  btn.disabled = true;
  btn.textContent = "Updating…";
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (!tabs.length) {
    $("status").textContent = "Open claude.ai in a tab to update.";
  } else {
    try { await chrome.tabs.sendMessage(tabs[0].id, { type: "pollNow" }); } catch (e) {}
  }
  btn.disabled = false;
  btn.textContent = "Update now";
  load();
});

$("test").addEventListener("click", () => chrome.runtime.sendMessage({ type: "testAlert" }));

const bind = (id, key) =>
  $(id).addEventListener("change", (e) => chrome.storage.local.set({ [key]: e.target.checked }));
bind("statusline", "statusLineEnabled");
bind("alerts", "alertsEnabled");
bind("alertReset", "alertReset");

chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local") load();
});

load();
setInterval(tick, 1000);
