// Runs inside the claude.ai page. Tells the status line when a reply starts and when it finishes.
(() => {
  if (window.__claudeUsageHooked) return;
  window.__claudeUsageHooked = true;

  const fire = (name) => window.dispatchEvent(new CustomEvent(name));
  const original = window.fetch;

  window.fetch = function (...args) {
    const promise = original.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === "string" ? req : (req && req.url) || String(req || "");
      const method = ((args[1] && args[1].method) || (req && req.method) || "GET").toUpperCase();
      if (method === "POST") {
        const urlMatch = /\/(retry_)?completion(\?|$)/.test(url);
        if (urlMatch) fire("claude-usage-start");
        promise
          .then((res) => {
            try {
              const type = (res.headers && res.headers.get("content-type")) || "";
              if (!urlMatch && !/text\/event-stream/i.test(type)) return;
              const body = res.clone().body;
              if (!body) return fire("claude-usage-bump");
              const reader = body.getReader();
              const pump = () =>
                reader.read().then(({ done }) => (done ? fire("claude-usage-bump") : pump())).catch(() => fire("claude-usage-bump"));
              pump();
            } catch (e) {
              fire("claude-usage-bump");
            }
          })
          .catch(() => {});
      }
    } catch (e) {}
    return promise;
  };
})();
