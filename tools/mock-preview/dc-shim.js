(function(){
  function run(){
    const xdc = document.querySelector('x-dc');
    const scr = document.querySelector('script[type="text/x-dc"]');
    const props = JSON.parse(scr.getAttribute('data-props') || '{}');
    const DCLogic = class { constructor(){ this.state = null; this.props = {}; } setState(o){ this.state = Object.assign({}, this.state || {}, o); } };
    const Component = new Function('DCLogic', scr.textContent + '\nreturn Component;')(DCLogic);
    const c = new Component();
    const dp = {}; for (const k in props) if (k[0] !== '$' && props[k] && 'default' in props[k]) dp[k] = props[k].default;
    c.props = Object.assign(dp, window.__PROPS || {});
    if (window.__STATE) c.state = window.__STATE;
    const vals = c.renderVals();
    const lookup = (path, scopes) => { if (path === 'true') return true; if (path === 'false') return false; const parts = path.split('.'); for (const sc of scopes) { if (sc && parts[0] in sc) { let v = sc[parts[0]]; for (const p of parts.slice(1)) { if (v == null) return undefined; v = v[p]; } return v; } } window.__MISSING = (window.__MISSING || []).concat(path); return undefined; };
    const interp = (str, scopes) => { const w = str.match(/^\s*\{\{\s*([\w.$]+)\s*\}\}\s*$/); if (w) return lookup(w[1], scopes); return str.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (m, p) => { const v = lookup(p, scopes); return v == null ? '' : String(v); }); };
    const proc = (node, scopes, out) => {
      if (node.nodeType === 3) { const v = interp(node.textContent, scopes); out.appendChild(document.createTextNode(v == null ? '' : String(v))); return; }
      if (node.nodeType !== 1) return;
      const tag = node.localName;
      if (tag === 'sc-for') { const list = interp(node.getAttribute('list'), scopes) || []; const as = node.getAttribute('as'); list.forEach((it, i) => { const sc = [{ [as]: it, $index: i }].concat(scopes); node.childNodes.forEach((ch) => proc(ch, sc, out)); }); return; }
      if (tag === 'sc-if') { const v = interp(node.getAttribute('value'), scopes); if (v) node.childNodes.forEach((ch) => proc(ch, scopes, out)); return; }
      if (tag === 'helmet') return;
      const el = node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? document.createElement(node.localName) : document.createElementNS(node.namespaceURI, node.localName);
      let val;
      for (const a of Array.from(node.attributes)) {
        if (/^on/i.test(a.name)) continue;
        const v = interp(a.value, scopes);
        if (typeof v === 'function') continue;
        if (a.name === 'value' && /^(input|textarea|select)$/.test(tag)) { val = v; continue; }
        if (a.name === 'checked') { if (v === true || v === 'true') el.setAttribute('checked', ''); continue; }
        if (v === false || v == null) { if (a.name.indexOf('aria-') === 0) el.setAttribute(a.name, String(v)); continue; }
        el.setAttribute(a.name, v === true ? 'true' : String(v));
      }
      node.childNodes.forEach((ch) => proc(ch, scopes, el));
      if (val !== undefined) { if (tag === 'textarea') el.textContent = val; else if (tag === 'select') { el.__v = val; } else el.setAttribute('value', val); }
      out.appendChild(el);
    };
    const helmet = xdc.querySelector('helmet');
    if (helmet) Array.from(helmet.children).forEach((h) => document.head.appendChild(h.cloneNode(true)));
    const frag = document.createElement('div');
    frag.style.display = 'contents';
    xdc.childNodes.forEach((ch) => proc(ch, [vals], frag));
    document.body.innerHTML = '';
    document.body.appendChild(frag);
    frag.querySelectorAll('select').forEach((s) => { if (s.__v !== undefined) s.value = s.__v; });
    window.__DONE = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
