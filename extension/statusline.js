// Usage line merged with the claude.ai chat box.
// - Needs no setup: uses your existing claude.ai login.
// - Reads usage on events only (page open, reply finished, tab revisited, manual), never on a timer.
// - Follows the chat box in the same frame it changes size, so it never lags or flickers.
(() => {
  if (window.top !== window) return;
  const A = window.ClaudeUsageApi;
  if (!A || !window.ClaudeShape) return;

  const MIN_GAP_MS = 5000;          // several tabs share one request
  const FETCH_TIMEOUT_MS = 10000;   // a hung request can never freeze the bar
  const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HOST_ID = "claude-usage-statusline";

  // Take over from any copy left behind by an older version of the extension.
  const token = Math.random().toString(36).slice(2);
  document.documentElement.setAttribute("data-claude-usage-owner", token);
  document.querySelectorAll("#" + HOST_ID).forEach((n) => n.remove());

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;z-index:40;display:none;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .wrap { position:relative; }
      svg.shape { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; shape-rendering:geometricPrecision; }
      .bar { position:relative; box-sizing:border-box; display:flex; align-items:center; gap:12px; padding:7px 10px 8px 16px;
             font-family:inherit; font-size:12px; line-height:1.35; color:var(--fg, CanvasText); }
      :host([data-pos="float"]) svg.shape { display:none; }
      :host([data-pos="float"]) .bar { background:var(--bg, Canvas); border:1px solid var(--bc, rgba(127,127,127,.35)); border-radius:12px; padding:6px 8px 6px 14px; }
      .segs { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; flex:1; min-width:0; }
      .seg { display:flex; align-items:center; gap:7px; white-space:nowrap; }
      .name { font-weight:600; }
      .track { display:block; width:44px; height:4px; border-radius:2px; background:rgba(127,127,127,.3); overflow:hidden; flex-shrink:0; }
      .track.wide { width:100%; height:5px; }
      .fill { display:block; height:100%; border-radius:2px; } /* spans ignore width/height unless they are blocks */
      .pct { font-variant-numeric:tabular-nums; font-weight:600; }
      .hot { color:#d6453d; }
      .muted { opacity:.65; }
      button { pointer-events:auto; background:none; border:0; color:inherit; font:inherit; cursor:pointer; border-radius:6px; }
      button:focus-visible { outline:2px solid #2a9d8f; outline-offset:1px; }
      .more { position:relative; display:grid; place-items:center; width:26px; height:22px; padding:0; opacity:.7; flex-shrink:0; }
      .more:hover, .more[aria-expanded="true"] { opacity:1; background:rgba(127,127,127,.2); }
      .more svg { display:block; }
      .more.warn::after { content:""; position:absolute; top:2px; right:3px; width:6px; height:6px; border-radius:50%; background:#e9a23b; }

      .panel { position:absolute; right:6px; bottom:calc(100% + 8px); box-sizing:border-box; width:min(320px, calc(100% - 12px));
               pointer-events:auto; background:var(--bg, Canvas); color:var(--fg, CanvasText); border:1px solid var(--bc, rgba(127,127,127,.35));
               border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.28); padding:14px 16px 12px; font-family:inherit; font-size:12.5px; line-height:1.4; }
      .panel.down { bottom:auto; top:calc(100% + 8px); }
      .panel[hidden] { display:none; }
      .panel:focus { outline:none; }
      .ptitle { font-weight:600; font-size:13px; margin:0 0 12px; }
      .prow { margin-bottom:12px; }
      .phead { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:5px; }
      .psub { opacity:.65; margin-top:5px; font-size:12px; }
      .pfoot { display:flex; align-items:center; justify-content:space-between; gap:10px; border-top:1px solid rgba(127,127,127,.2);
               margin-top:4px; padding-top:10px; }
      .status { display:flex; align-items:center; gap:7px; opacity:.75; font-size:12px; min-width:0; }
      .dot { width:7px; height:7px; border-radius:50%; background:#8a8f98; flex-shrink:0; }
      .dot.ok { background:#2a9d8f; }
      .update { padding:5px 10px; background:rgba(127,127,127,.18); font-weight:600; font-size:12px; white-space:nowrap; }
      .update:hover { background:rgba(127,127,127,.3); }
      @media (prefers-reduced-motion: no-preference) { .panel:not([hidden]) { animation:pop .12s ease-out; } }
      @keyframes pop { from { opacity:0; transform:translateY(4px); } }
    </style>
    <div class="wrap">
      <svg class="shape" id="shape" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="bar" id="bar"><span class="segs" id="segs"></span></div>
      <div class="panel" id="panel" role="dialog" aria-label="Usage details" tabindex="-1" hidden>
        <p class="ptitle">Usage details</p>
        <div id="pbody"></div>
        <div class="pfoot">
          <span class="status"><span class="dot" id="pdot"></span><span id="ptext"></span></span>
          <button class="update" id="pupdate">Update now</button>
        </div>
      </div>
    </div>`;
  const bar = root.getElementById("bar");
  const segsBox = root.getElementById("segs");
  const svg = root.getElementById("shape");
  const panel = root.getElementById("panel");
  const pbody = root.getElementById("pbody");
  const pdot = root.getElementById("pdot");
  const ptext = root.getElementById("ptext");
  const pupdate = root.getElementById("pupdate");

  // The three-dot button lives for the whole session, so keyboard focus is never lost.
  const menuBtn = document.createElement("button");
  menuBtn.className = "more";
  menuBtn.setAttribute("aria-label", "Usage details");
  menuBtn.setAttribute("aria-haspopup", "dialog");
  menuBtn.setAttribute("aria-expanded", "false");
  const dots = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  dots.setAttribute("width", "16"); dots.setAttribute("height", "4"); dots.setAttribute("viewBox", "0 0 16 4");
  for (const cx of [2, 8, 14]) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", 2); c.setAttribute("r", 1.6); c.setAttribute("fill", "currentColor");
    dots.appendChild(c);
  }
  menuBtn.appendChild(dots);
  bar.appendChild(menuBtn);
  document.documentElement.appendChild(host);

  let usage = null;
  let apiError = null;
  let enabled = true;
  let lastReply = null;
  let polling = false;
  let lastSig = null;
  let latestEntries = null;
  let latestOrg = null;
  let dead = false;
  const timers = [];

  // ---- lifecycle: stop cleanly if the extension is reloaded or replaced ------

  function alive() {
    if (dead) return false;
    let ok = false;
    try { ok = !!(chrome.runtime && chrome.runtime.id); } catch (e) {}
    if (ok && document.documentElement.getAttribute("data-claude-usage-owner") !== token) ok = false;
    if (!ok) shutdown();
    return ok;
  }

  function shutdown() {
    if (dead) return;
    dead = true;
    timers.forEach(clearInterval);
    if (ro) ro.disconnect();
    host.remove();
  }

  // ---- drawing -------------------------------------------------------------

  const color = (p) => (p >= 85 ? "#d6453d" : p >= 60 ? "#e9a23b" : "#2a9d8f");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ago(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  }

  function miniBar(percent, wide) {
    const track = el("span", wide ? "track wide" : "track");
    const fill = el("span", "fill");
    fill.style.width = Math.min(100, percent) + "%";
    fill.style.background = color(percent);
    track.appendChild(fill);
    return track;
  }

  const pctNode = (text, percent) => el("span", percent >= 85 ? "pct hot" : "pct", text);
  const nameOf = (e) =>
    e.kind === "session" ? "Session"
    : /all models/i.test(e.label) ? "Week"
    : e.kind === "weekly" ? "Week · " + e.label
    : e.label;
  const moneyOf = (e) => A.money(e.used, e.currency) + (e.limit != null ? " of " + A.money(e.limit, e.currency) : "");
  const fmtDelta = (x) => (x == null ? null : x <= 0 ? "<1%" : "+" + Math.round(x * 10) / 10 + "%");
  const shortError = (code) => A.errorText(code).split(". ")[0];
  const hasData = () => !!(usage && Array.isArray(usage.entries) && usage.entries.length);

  function freshLastReply() {
    const r = lastReply;
    if (!r || Date.now() - r.at > 3 * 3600 * 1000) return null;
    if (usage && r.org && usage.org && r.org !== usage.org) return null;
    const parts = [];
    if (r.session != null) parts.push(fmtDelta(r.session) + " session");
    if (r.week != null && r.week > 0) parts.push(fmtDelta(r.week) + " week");
    return parts.length ? { text: parts.join(" · "), at: r.at } : null;
  }

  // The line itself: only each limit's name, bar and percentage.
  let lineKey = "";
  function renderLine() {
    const next = [];
    if (hasData()) {
      const limits = usage.entries.filter((e) => e.kind !== "extra");
      const shown = limits.length ? limits : usage.entries; // spend-only plans show their credits instead
      for (const e of shown) {
        const s = el("span", "seg");
        if (e.kind === "extra") {
          s.append(el("span", "name", "Extra"));
          if (e.limit != null) s.appendChild(miniBar(e.percent));
          s.appendChild(pctNode(A.money(e.used, e.currency), e.percent));
        } else {
          s.append(el("span", "name", nameOf(e)), miniBar(e.percent), pctNode(Math.round(e.percent) + "%", e.percent));
          if (e.resetAt) {
            const r = el("span", "muted", "Resets in " + A.hhmm(e.resetAt - Date.now()));
            r.title = `Resets in ${A.duration(e.resetAt - Date.now())} · ${A.clock(e.resetAt)}`;
            s.appendChild(r);
          }
        }
        next.push(s);
      }
    } else {
      next.push(el("span", "muted", apiError ? shortError(apiError) : "Reading usage…"));
    }
    menuBtn.classList.toggle("warn", !!apiError && hasData());
    const key = next.map((n) => n.textContent).join("|") + "|" + (hasData() ? usage.entries.map((e) => e.percent).join(",") : "");
    if (key === lineKey) return false;
    lineKey = key;
    segsBox.replaceChildren(...next);
    return true;
  }

  // Everything else lives in the details panel behind the three dots.
  let panelKey = "";
  function renderPanel() {
    if (panel.hidden) return;
    const rows = [];
    if (hasData()) {
      for (const e of usage.entries) {
        const row = el("div", "prow");
        const head = el("div", "phead");
        if (e.kind === "extra") {
          head.append(el("span", "name", "Extra usage"), pctNode(moneyOf(e), e.percent));
          row.appendChild(head);
          if (e.limit != null) row.appendChild(miniBar(e.percent, true));
          row.appendChild(el("div", "psub", "Pay-as-you-go credits this month"));
        } else {
          head.append(el("span", "name", nameOf(e) === "Week" ? "Week (all models)" : nameOf(e)), pctNode(Math.round(e.percent) + "% used", e.percent));
          row.append(head, miniBar(e.percent, true));
          row.appendChild(el("div", "psub", e.resetAt
            ? `Resets in ${A.duration(e.resetAt - Date.now())} · ${A.clock(e.resetAt)}`
            : "No reset time reported yet"));
        }
        rows.push(row);
      }
      const lr = freshLastReply();
      if (lr) {
        const row = el("div", "prow");
        const head = el("div", "phead");
        head.append(el("span", "name", "Last reply"), el("span", "pct", lr.text));
        row.append(head, el("div", "psub", "Measured " + ago(lr.at)));
        rows.push(row);
      }
    } else {
      rows.push(el("div", "prow", apiError ? A.errorText(apiError) : "Reading usage…"));
    }

    const key = rows.map((r) => r.textContent).join("|");
    if (key !== panelKey) {
      panelKey = key;
      pbody.replaceChildren(...rows);
    }

    pdot.className = hasData() && !apiError ? "dot ok" : "dot";
    const status = polling
      ? "Updating…"
      : hasData()
      ? (apiError ? `Last update ${ago(usage.updatedAt)} · ${shortError(apiError)}` : `Updated ${ago(usage.updatedAt)}`)
      : "";
    if (ptext.textContent !== status) ptext.textContent = status;
    pupdate.disabled = polling;
  }

  function render() {
    if (dead) return;
    const changed = renderLine();
    renderPanel();
    if (changed) sync(); // new content can change the bar's height: re-fit in the same frame
  }

  function openMenu() {
    panel.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    panelKey = "";
    renderPanel();
    // Open upward; if there isn't room above, open downward instead.
    panel.classList.remove("down");
    if (host.getBoundingClientRect().top < panel.offsetHeight + 16) panel.classList.add("down");
    panel.focus();
  }

  function closeMenu(returnFocus) {
    if (panel.hidden) return;
    panel.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) menuBtn.focus();
  }

  menuBtn.addEventListener("click", () => (panel.hidden ? openMenu() : closeMenu(false)));
  pupdate.addEventListener("click", () => poll(true));

  // ---- data ----------------------------------------------------------------

  function codeErr(code, detail) {
    const e = new Error(code);
    e.code = code;
    e.detail = detail;
    return e;
  }
  const statusCode = (s) =>
    s === 401 ? "signed-out" : s === 403 ? "forbidden" : s === 404 ? "not-found" : s === 429 ? "rate-limited" : "server";

  async function getJSON(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) return { ok: false, status: res.status };
      let body;
      try { body = await res.json(); } catch (e) { throw codeErr("bad-response", "not JSON"); }
      return { ok: true, status: res.status, body };
    } catch (e) {
      if (e && e.code) throw e;
      throw codeErr(e && e.name === "AbortError" ? "timeout" : "network", String(e && e.message));
    } finally {
      clearTimeout(timer);
    }
  }

  function cookieOrg() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (!m) return null;
    let v = m[1];
    try { v = decodeURIComponent(v); } catch (e) {}
    return ORG_ID.test(v) ? v : null;
  }

  // The account you are using right now (from claude.ai's own cookie) always wins.
  // Only if there is none do we fall back to a remembered or listed account.
  async function fetchUsage() {
    const tryOrg = async (id, from) => {
      const r = await getJSON(`/api/organizations/${encodeURIComponent(id)}/usage`);
      if (r.ok) {
        if (!r.body || typeof r.body !== "object" || Array.isArray(r.body)) throw codeErr("bad-response", "not an object");
        await chrome.storage.local.set({ orgId: id, orgFrom: from });
        return { json: r.body, org: id };
      }
      return { status: r.status };
    };

    const active = cookieOrg();
    if (active) {
      const r = await tryOrg(active, "cookie");
      if (r.json) return r;
      throw codeErr(statusCode(r.status), "usage " + r.status);
    }

    const tried = new Set();
    let worst = null;
    const stored = (await chrome.storage.local.get("orgId")).orgId;
    const candidates = [];
    if (typeof stored === "string" && ORG_ID.test(stored)) candidates.push([stored, "cache"]);

    const list = await getJSON("/api/organizations");
    if (!list.ok && !candidates.length) throw codeErr(statusCode(list.status), "organizations " + list.status);
    if (list.ok && Array.isArray(list.body)) {
      list.body
        .filter((o) => o && typeof o.uuid === "string" && ORG_ID.test(o.uuid))
        .sort((a, b) => (b.capabilities || []).includes("chat") - (a.capabilities || []).includes("chat"))
        .slice(0, 5)
        .forEach((o) => candidates.push([o.uuid, "list"]));
    }
    for (const [id, from] of candidates) {
      if (tried.has(id)) continue;
      tried.add(id);
      const r = await tryOrg(id, from);
      if (r.json) return r;
      worst = r.status;
      if (r.status === 401 || r.status === 429) break;
    }
    if (worst == null) throw codeErr("no-org");
    throw codeErr(statusCode(worst), "usage " + worst);
  }

  let lastForcedAt = 0;
  async function poll(force) {
    if (!alive() || polling) return false;
    if (!force && document.visibilityState !== "visible") return false;
    if (force) {
      if (Date.now() - lastForcedAt < 1500) return false; // flood guard
      lastForcedAt = Date.now();
    } else {
      try {
        const s = await chrome.storage.local.get("usage");
        if (s.usage && s.usage.source === "api" && Date.now() - s.usage.updatedAt < MIN_GAP_MS) return true;
      } catch (e) {
        return false;
      }
    }

    polling = true;
    render();
    let ok = false;
    try {
      const { json, org } = await fetchUsage();
      const entries = A.toEntries(json);
      await chrome.storage.local.set({ apiDebug: { keys: Object.keys(json).slice(0, 40), at: Date.now() } });
      if (!entries.length) throw codeErr("no-limits", "no usage windows in response");
      await chrome.storage.local.set({
        usage: { entries, updatedAt: Date.now(), source: "api", org },
        apiError: null,
        apiErrorRaw: null,
      });
      latestEntries = entries;
      latestOrg = org;
      lastSig = JSON.stringify(entries.map((e) => [e.label, e.percent]));
      ok = true;
    } catch (e) {
      const code = (e && e.code) || "bad-response";
      try {
        // A plan with no limits is a state, not stale data: drop old numbers from another account.
        const patch = { apiError: code, apiErrorRaw: String((e && (e.detail || e.message)) || e) };
        if (A.isQuiet(code) || code === "signed-out") patch.usage = null;
        await chrome.storage.local.set(patch);
      } catch (_) {}
    } finally {
      polling = false;
      render();
    }
    return ok;
  }

  // ---- cost of the last reply ----------------------------------------------

  function snapshot(entries, at, org) {
    const s = entries.find((e) => e.kind === "session");
    const w = entries.find((e) => e.kind === "weekly" && /all models/i.test(e.label)) || entries.find((e) => e.kind === "weekly");
    return { session: s ? s.percent : null, week: w ? w.percent : null, at: at || Date.now(), org: org || null };
  }

  function recordCost(base) {
    if (!base || !latestEntries || !alive()) return;
    if (Date.now() - base.at > 30 * 60000) return;      // too old to pin on one reply
    if (base.org && latestOrg && base.org !== latestOrg) return; // you switched accounts
    const now = snapshot(latestEntries, null, latestOrg);
    const diff = (a, b) => (a == null || b == null ? null : b - a);
    let s = diff(base.session, now.session);
    let w = diff(base.week, now.week);
    if (s != null && s < -1) s = null; // the window reset in between
    if (w != null && w < -1) w = null;
    if (s == null && w == null) return;
    const clean = (v) => (v == null ? null : Math.max(0, +v.toFixed(2)));
    try {
      chrome.storage.local.set({ lastReply: { session: clean(s), week: clean(w), at: Date.now(), org: latestOrg } });
    } catch (e) {}
  }

  // ---- placement -----------------------------------------------------------

  function findField() {
    const selectors = ['[data-testid="chat-input"]', 'div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'];
    for (const sel of selectors) {
      const list = [...document.querySelectorAll(sel)].filter((f) => f.getBoundingClientRect().width > 120);
      if (list.length) return list.reduce((a, b) => (a.getBoundingClientRect().top > b.getBoundingClientRect().top ? a : b));
    }
    return null;
  }

  function findComposer() {
    const ed = findField();
    if (!ed) return null;
    let node = ed;
    for (let i = 0; i < 8 && node.parentElement; i++) {
      node = node.parentElement;
      const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius);
      if (radius >= 12 && node.getBoundingClientRect().width > 240) return node;
    }
    return ed;
  }

  function alphaOf(c) {
    if (!c || c === "transparent") return 0;
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean);
      return p.length > 3 ? parseFloat(p[3]) : 1;
    }
    m = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (m) return m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    return 1;
  }

  function rgbaOf(c) {
    const m = c && c.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  // The colour you actually see behind an element, with see-through layers blended in.
  function solidBg(node) {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const a = alphaOf(c);
      if (a <= 0) continue;
      layers.push(c);
      if (a >= 0.98) break;
    }
    if (!layers.length) return "Canvas";
    let base = rgbaOf(layers[layers.length - 1]);
    if (!base) return layers[0];
    for (let i = layers.length - 2; i >= 0; i--) {
      const t = rgbaOf(layers[i]);
      if (!t) return layers[0];
      base = { r: t.r * t.a + base.r * (1 - t.a), g: t.g * t.a + base.g * (1 - t.a), b: t.b * t.a + base.b * (1 - t.a) };
    }
    return `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`;
  }

  let shapeKey = "";
  function drawShape(W, H, R, bw, strokeW) {
    const key = [W, H, R, bw, strokeW].join("|");
    if (key === shapeKey) return;
    shapeKey = key;
    const p = window.ClaudeShape.build(W, H, R, bw, strokeW);
    svg.setAttribute("width", W);
    svg.setAttribute("height", p.height);
    svg.setAttribute("viewBox", `0 0 ${W} ${p.height}`);
    svg.replaceChildren();
    const path = (d, style, attrs) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
      node.setAttribute("d", d);
      node.setAttribute("style", style);
      for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
      svg.appendChild(node);
    };
    path(p.fill, "fill:var(--bg)");
    path(p.stroke, "fill:none;stroke:var(--bc)", { "stroke-width": strokeW });
    path(p.divider, "fill:none;stroke:var(--fg)", { "stroke-opacity": ".16", "stroke-width": 1 });
  }

  // Write a style only when it changes, so the browser has nothing to redo.
  const applied = {};
  function put(prop, value) {
    if (applied[prop] === value) return;
    applied[prop] = value;
    if (prop.startsWith("--")) host.style.setProperty(prop, value);
    else host.style[prop] = value;
  }
  function setPos(v) {
    if (host.dataset.pos !== v) host.dataset.pos = v;
  }

  // The chat box is found once and then watched; it is only searched for again if it disappears.
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => sync()) : null;
  let composer = null;
  let foundAt = 0;
  function locate() {
    if (composer && composer.isConnected && Date.now() - foundAt < 1500) return composer;
    foundAt = Date.now();
    const next = findComposer();
    if (next !== composer) {
      if (ro) {
        ro.disconnect();
        if (next) ro.observe(next);
      }
      composer = next;
      looksAt = 0;
    }
    return composer;
  }

  // Colours and border change rarely (theme switch), so they are read at most once a second.
  let looks = null;
  let looksAt = 0;
  function readLooks(c) {
    if (looks && Date.now() - looksAt < 1000) return looks;
    looksAt = Date.now();
    const cs = getComputedStyle(c);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    looks = {
      bw,
      radius: parseFloat(cs.borderTopLeftRadius) || 0,
      strokeW: bw >= 0.5 ? bw : 1,
      bg: solidBg(c),
      fg: cs.color,
      bc: bw >= 0.5 ? cs.borderTopColor : "rgba(127,127,127,.35)",
      font: cs.fontFamily,
    };
    return looks;
  }

  let lastGeoAt = 0;
  function sync() {
    if (!alive()) return;
    try {
      if (!host.isConnected) document.documentElement.appendChild(host);
      if (!enabled) return put("display", "none");

      const c = locate();
      const r = c ? c.getBoundingClientRect() : null;
      const usable = r && r.width >= 160 && r.height >= 20;
      const onChatPage = /^\/($|new|chat\/|project)/.test(location.pathname);

      if (!usable) {
        // The page may be re-rendering for a moment: hold still instead of jumping around.
        if (Date.now() - lastGeoAt < 2000 && applied.display === "block") return;
        if (!onChatPage) return put("display", "none");
        // Chat box not found (Claude changed its page): float a card at the bottom edge.
        const body = getComputedStyle(document.body);
        setPos("float");
        put("--bg", solidBg(document.body));
        put("--fg", body.color);
        put("--bc", "rgba(127,127,127,.35)");
        put("fontFamily", body.fontFamily);
        put("display", "block");
        const w = Math.min(640, window.innerWidth - 32);
        put("width", w + "px");
        put("left", (window.innerWidth - w) / 2 + "px");
        put("top", window.innerHeight - (host.offsetHeight || 28) - 10 + "px");
        return;
      }

      lastGeoAt = Date.now();
      const L = readLooks(c);
      const R = Math.max(0, Math.min(L.radius, r.height / 2, 40));
      put("--bg", L.bg);
      put("--fg", L.fg);
      put("--bc", L.bc);
      put("fontFamily", L.font);
      setPos("above");
      put("display", "block");
      put("left", r.left + "px");
      put("width", r.width + "px");
      const H = host.offsetHeight || 28;
      put("top", Math.max(4, r.top - H + Math.max(1, L.bw)) + "px");
      drawShape(r.width, H, R, L.bw, L.strokeW);
    } catch (e) {
      // Never let a layout surprise break the page or stop the bar.
    }
  }

  let frameQueued = false;
  function soon() {
    if (frameQueued || dead) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      sync();
    });
  }

  function load() {
    if (!alive()) return;
    try {
      chrome.storage.local.get(["usage", "apiError", "statusLineEnabled", "lastReply"], (s) => {
        if (dead || !s) return;
        usage = s.usage || null;
        apiError = s.apiError || null;
        enabled = s.statusLineEnabled !== false;
        lastReply = s.lastReply || null;
        render();
        sync();
      });
    } catch (e) {}
  }

  // ---- wiring --------------------------------------------------------------

  let sendBase = null;
  let sendAt = 0;
  async function markSend() {
    if (!alive() || Date.now() - sendAt < 10000) return;
    sendAt = Date.now();
    await poll(true);
    if (latestEntries) sendBase = snapshot(latestEntries, null, latestOrg);
  }

  let replyTimer = null;
  function onReplyDone() {
    if (!alive()) return;
    clearTimeout(replyTimer);
    const base = sendBase || (usage && usage.entries ? snapshot(usage.entries, usage.updatedAt, usage.org) : null);
    sendBase = null;
    replyTimer = setTimeout(async () => {
      const before = lastSig;
      await poll(true);
      recordCost(base);
      if (lastSig === before) {
        setTimeout(async () => {
          await poll(true);
          recordCost(base);
        }, 6000);
      }
    }, 1500);
  }

  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !e.composedPath().includes(host)) closeMenu(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      e.stopPropagation();
      closeMenu(true);
    }
  }, true);
  window.addEventListener("blur", () => closeMenu(false));

  window.addEventListener("claude-usage-start", markSend);
  window.addEventListener("claude-usage-bump", onReplyDone);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.closest && e.target.closest('[contenteditable="true"]')) markSend();
    soon();
  }, true);
  document.addEventListener("input", soon, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest('button[aria-label*="send" i]')) markSend();
  }, true);

  function refreshIfStale() {
    if (document.visibilityState !== "visible") return;
    if (!usage || Date.now() - usage.updatedAt > 60000) poll(false);
  }
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("focus", refreshIfStale);
  window.addEventListener("resize", sync);
  window.addEventListener("scroll", soon, { capture: true, passive: true });

  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "local" && !dead) load();
    });
    chrome.runtime.onMessage.addListener((msg, sender, send) => {
      if (!sender || sender.id !== chrome.runtime.id) return;
      if (msg && msg.type === "pollNow") {
        poll(true).then((ok) => send({ ok }));
        return true;
      }
    });
  } catch (e) {}

  timers.push(setInterval(sync, 250));     // safety net for moves that don't change the box's size
  timers.push(setInterval(render, 1000));  // countdown text; skips the page when nothing changed

  load();
  sync();
  setTimeout(() => poll(false), 800);      // once when the page opens
})();
