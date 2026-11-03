importScripts("usage-api.js");
const API = globalThis.ClaudeUsageApi;

const LEVELS = [80, 90, 100];

function levelColor(p) {
  if (p >= 85) return "#d6453d";
  if (p >= 60) return "#e9a23b";
  return "#2a9d8f";
}

async function updateBadge() {
  const { usage } = await chrome.storage.local.get("usage");
  const s = usage && usage.entries && usage.entries.find((e) => e.kind === "session");
  if (!s) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: String(Math.round(s.percent)) });
  chrome.action.setBadgeBackgroundColor({ color: levelColor(s.percent) });
}

function notify(id, title, message) {
  chrome.notifications.create(`${id}:${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 1,
  });
}

const keyOf = (e, org) => `${org || "default"}|${e.kind}:${e.label}`;
const nameOf = (e) =>
  e.kind === "session" ? "Session"
  : e.kind === "weekly" ? (/all models/i.test(e.label) ? "Weekly" : `Weekly ${e.label}`)
  : e.label;

function resetLine(e) {
  return e.resetAt
    ? `Resets in ${API.duration(e.resetAt - Date.now())} (${API.clock(e.resetAt)}).`
    : "";
}

// Fires once per threshold per usage window, and once when a window resets.
async function checkAlerts(usage) {
  if (!usage || !Array.isArray(usage.entries)) return;
  const s = await chrome.storage.local.get(["alertsEnabled", "alertReset", "alertState"]);
  const enabled = s.alertsEnabled !== false;
  const notifyReset = s.alertReset !== false;
  const state = s.alertState || {};

  for (const e of usage.entries) {
    const key = keyOf(e, usage.org);
    const crossed = LEVELS.filter((t) => e.percent >= (t === 100 ? 99.5 : t));
    let st = state[key];

    if (!st) {
      // First sighting: remember where things stand, don't alert about the past.
      state[key] = { percent: e.percent, resetAt: e.resetAt, fired: crossed };
      continue;
    }

    // A new window means the reset time jumped forward. Without reset times, only a big drop counts,
    // so numbers wobbling around a threshold can't trigger repeat alerts.
    const newWindow =
      e.resetAt && st.resetAt
        ? e.resetAt - st.resetAt > 30 * 60000
        : e.percent + 20 < st.percent;
    if (newWindow) {
      if (enabled && notifyReset && (e.kind === "session" || e.kind === "weekly") && st.percent >= 10) {
        notify("reset", `${nameOf(e)} limit has reset`, `You're back to ${Math.round(e.percent)}% used.`);
      }
      st.fired = [];
    }

    const fresh = crossed.filter((t) => !st.fired.includes(t));
    if (fresh.length) {
      if (enabled) {
        const top = Math.max(...fresh);
        if (e.kind === "extra") {
          const cap = e.limit != null ? ` of ${API.money(e.limit, e.currency)}` : "";
          notify("level", top >= 100 ? "Extra usage cap reached" : `Extra usage at ${top}% of your monthly cap`,
            `${API.money(e.used, e.currency)}${cap} used this month.`);
        } else {
          notify("level", top >= 100 ? `${nameOf(e)} limit reached` : `${nameOf(e)} usage at ${top}%`, resetLine(e));
        }
      }
      st.fired = [...new Set([...st.fired, ...crossed])];
    }

    st.percent = e.percent;
    if (e.resetAt) st.resetAt = e.resetAt;
  }

  await chrome.storage.local.set({ alertState: state });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.usage) return;
  if (!changes.usage.newValue) return updateBadge();
  updateBadge();
  checkAlerts(changes.usage.newValue);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === "testAlert") {
    notify("test", "Usage Counter for Claude", "Alerts are working. You'll see one like this at 80%, 90% and when a limit is hit.");
  }
});

// After an install or update, attach to claude.ai tabs that are already open, so nothing needs a reload.
async function attachToOpenTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: "https://claude.ai/*" }); } catch (e) { return; }
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["intercept.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["usage-api.js", "shape.js", "statusline.js"] });
    } catch (e) {}
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  updateBadge();
  if (details && (details.reason === "install" || details.reason === "update")) attachToOpenTabs();
});
chrome.runtime.onStartup.addListener(updateBadge);

