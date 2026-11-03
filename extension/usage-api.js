// Parses claude.ai's usage response and formats times and money. Shared by the page and the background worker.
(function (g) {
  const KNOWN = {
    five_hour: ["session", "Session"],
    seven_day: ["weekly", "All models"],
    seven_day_sonnet: ["weekly", "Sonnet"],
    seven_day_opus: ["weekly", "Opus"],
    seven_day_omelette: ["weekly", "Design"],
    seven_day_oauth_apps: ["weekly", "OAuth apps"],
    seven_day_cowork: ["weekly", "Cowork"],
  };
  const ORDER = { session: 0, weekly: 1, other: 2, extra: 3 };

  function percentOf(w) {
    for (const k of ["utilization", "used_percentage", "percent_used", "percentage"]) {
      if (typeof w[k] === "number") return w[k];
    }
    return null;
  }

  function human(key) {
    const s = key.replace(/^seven_day_?/, "").replace(/_/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "All models";
  }

  // Pay-as-you-go credits. The API reports amounts in cents.
  function extraEntry(w) {
    if (!w || typeof w !== "object" || w.is_enabled === false) return null;
    const used = typeof w.used_credits === "number" ? w.used_credits / 100 : null;
    const limit = typeof w.monthly_limit === "number" ? w.monthly_limit / 100 : null;
    if (used == null && limit == null) return null;
    let percent = 0;
    if (limit && used != null) percent = (used / limit) * 100;
    else if (typeof w.utilization === "number") percent = w.utilization;
    return {
      label: "Extra usage",
      kind: "extra",
      percent: Math.max(0, Math.min(100, percent)),
      used: used == null ? 0 : used,
      limit,
      currency: typeof w.currency === "string" ? w.currency : null,
      resetText: null,
      resetAt: null,
    };
  }

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

  function toEntries(d) {
    const out = [];
    if (!d || typeof d !== "object") return out;
    for (const [key, w] of Object.entries(d)) {
      if (UNSAFE.has(key)) continue;
      if (key === "extra_usage") {
        const x = extraEntry(w);
        if (x) out.push(x);
        continue;
      }
      if (!w || typeof w !== "object") continue;
      const p = percentOf(w);
      if (p == null) continue;

      let kind, label;
      if (own(KNOWN, key)) [kind, label] = KNOWN[key];
      else if (/five_hour|session/.test(key)) [kind, label] = ["session", "Session"];
      else if (/seven_day|week/.test(key)) [kind, label] = ["weekly", human(key)];
      else continue;

      out.push({
        label,
        kind,
        percent: Math.max(0, Math.min(100, p)),
        resetText: null,
        resetAt: (w.resets_at && Date.parse(w.resets_at)) || null,
      });
    }
    return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  }

  function duration(ms) {
    if (ms <= 0) return "now";
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m % 60}m`;
    return `${m}m`;
  }

  // Countdown as hh:mm, e.g. "03:58"; "2d 03:12" when a day or more away.
  function hhmm(ms) {
    if (!(ms > 0)) return "00:00";
    const total = Math.floor(ms / 60000);
    const d = Math.floor(total / 1440);
    const h = Math.floor((total % 1440) / 60);
    const m = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return (d ? `${d}d ` : "") + `${pad(h)}:${pad(m)}`;
  }

  // "3:40 PM", "tomorrow 9:40 AM" or "Sat 9:40 AM", in your own time zone.
  function clock(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return "tomorrow " + time;
    return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  }

  function money(v, currency) {
    if (v == null) return "";
    try {
      if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
    } catch (e) {}
    return v.toFixed(2);
  }

  // Plain-language text for every way reading usage can fail, so the bar never looks broken.
  const MESSAGES = {
    "signed-out": "Sign in to claude.ai to see your usage",
    "forbidden": "This account doesn't share usage limits",
    "not-found": "This plan doesn't report usage limits",
    "no-limits": "No usage limits reported for this plan",
    "no-org": "No Claude account found in this browser",
    "rate-limited": "claude.ai asked to slow down. Updates after your next reply",
    "server": "claude.ai had a problem. Updates after your next reply",
    "timeout": "claude.ai didn't answer in time. Updates after your next reply",
    "network": "Couldn't reach claude.ai. Updates after your next reply",
    "bad-response": "claude.ai sent something unexpected. Updates after your next reply",
  };
  const QUIET = new Set(["forbidden", "not-found", "no-limits"]); // states of the plan, not failures

  function errorText(code) {
    return MESSAGES[code] || "Usage unavailable. Updates after your next reply";
  }

  g.ClaudeUsageApi = { toEntries, duration, clock, money, hhmm, errorText, isQuiet: (c) => QUIET.has(c) };
})(typeof window !== "undefined" ? window : globalThis);
