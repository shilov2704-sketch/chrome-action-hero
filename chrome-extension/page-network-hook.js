// Runs in MAIN world. Intercepts fetch & XHR and posts metadata to the
// isolated content-script via window.postMessage. No response data is captured.
(function () {
  if (window.__qaNetHookInstalled) return;
  window.__qaNetHookInstalled = true;

  const MAX_BODY_LEN = 200000;

  function clip(s) {
    if (typeof s !== 'string') return s;
    return s.length > MAX_BODY_LEN ? s.slice(0, MAX_BODY_LEN) : s;
  }

  function post(req) {
    try {
      window.postMessage({ __qaNet: true, request: req }, '*');
    } catch (e) {}
  }

  function bodyToString(body) {
    if (body === undefined || body === null) return null;
    try {
      if (typeof body === 'string') return clip(body);
      if (body instanceof FormData) {
        const o = {};
        body.forEach((v, k) => { o[k] = typeof v === 'string' ? v : '[file]'; });
        return clip(JSON.stringify(o));
      }
      if (body instanceof URLSearchParams) return clip(body.toString());
      if (body instanceof Blob || body instanceof ArrayBuffer) return '[binary]';
      return clip(JSON.stringify(body));
    } catch (e) {
      try { return clip(String(body)); } catch (_) { return null; }
    }
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      let method = 'GET';
      const headers = {};
      let body = null;
      try {
        if (typeof input === 'string') {
          url = input;
        } else if (input && typeof input === 'object') {
          if (typeof input.url === 'string') url = input.url;
          if (typeof input.method === 'string') method = input.method;
          if (input.headers && typeof input.headers.forEach === 'function') {
            input.headers.forEach((v, k) => { headers[k] = v; });
          }
        }
        if (init) {
          if (init.method) method = init.method;
          if (init.headers) {
            const h = init.headers;
            if (typeof Headers !== 'undefined' && h instanceof Headers) {
              h.forEach((v, k) => { headers[k] = v; });
            } else if (Array.isArray(h)) {
              h.forEach(([k, v]) => { headers[k] = v; });
            } else if (typeof h === 'object') {
              Object.keys(h).forEach(k => { headers[k] = h[k]; });
            }
          }
          if (init.body !== undefined && init.body !== null) {
            body = bodyToString(init.body);
          }
        }
        // Resolve URL to absolute form when possible
        try { url = new URL(url, document.baseURI).href; } catch (_) {}
        post({ method: String(method).toUpperCase(), url, headers, body, ts: Date.now() });
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  // ---- XMLHttpRequest ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    const origSetHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.open = function (method, url) {
      try {
        let abs = url;
        try { abs = new URL(url, document.baseURI).href; } catch (_) {}
        this.__qa = { method: String(method || 'GET').toUpperCase(), url: abs, headers: {} };
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (k, v) {
      try { if (this.__qa) this.__qa.headers[k] = v; } catch (e) {}
      return origSetHeader.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      try {
        if (this.__qa) {
          post({
            method: this.__qa.method,
            url: this.__qa.url,
            headers: this.__qa.headers,
            body: bodyToString(body),
            ts: Date.now()
          });
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }
})();