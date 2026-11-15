// Minimal stand-in for Obsidian's DOM helpers and API, enough to run Landing Pad's main.js in Chrome.
(function () {
  // ----- fixed clock: Tuesday 17 Nov 2026, 09:10 -----
  const FIXED = new Date(2026, 10, 17, 9, 10).getTime();
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
  };

  // ----- DOM helpers Obsidian adds to elements -----
  const apply = (el, o) => {
    if (typeof o === 'string') o = { cls: o };
    o = o || {};
    if (o.cls) Array.isArray(o.cls) ? el.classList.add(...o.cls) : el.classList.add(...String(o.cls).split(' ').filter(Boolean));
    if (o.text) el.textContent = o.text;
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
    if (o.href) el.setAttribute('href', o.href);
    return el;
  };
  const P = HTMLElement.prototype, S = SVGElement.prototype;
  for (const proto of [P, S]) {
    proto.createEl = function (t, o) { const e = apply(document.createElement(t), o); this.appendChild(e); return e; };
    proto.createDiv = function (o) { return this.createEl('div', o); };
    proto.createSpan = function (o) { return this.createEl('span', o); };
    proto.createSvg = function (t, o) {
      // Like Obsidian: a string cls is added as ONE class (spaces throw).
      const e = document.createElementNS('http://www.w3.org/2000/svg', t);
      o = o || {};
      if (o.cls) Array.isArray(o.cls) ? e.classList.add(...o.cls) : e.classList.add(o.cls);
      if (o.attr) for (const [k, v] of Object.entries(o.attr)) e.setAttribute(k, v);
      this.appendChild(e); return e;
    };
    proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
    proto.addClass = function (...c) { this.classList.add(...c); };
    proto.isShown = function () { return true; };
  }

  // ----- icons (Lucide, like Obsidian) -----
  const pascal = (n) => n.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  function setIcon(el, name) {
    el.empty();
    const node = lucide.icons[pascal(name)];
    if (!node) return;
    const svg = lucide.createElement(node);
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.classList.add('svg-icon');
    el.appendChild(svg);
  }

  // ----- moment, just what the plugin uses -----
  function moment(t) {
    const d = new Date(t === undefined ? Date.now() : t);
    return {
      format: () => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      fromNow: () => {
        const s = (Date.now() - d.getTime()) / 1000, m = s / 60, h = m / 60, dd = h / 24, mo = dd / 30.4, y = dd / 365;
        if (s < 45) return 'a few seconds ago'; if (m < 45) return `${Math.round(m) || 1} minutes ago`;
        if (h < 1.5) return 'an hour ago'; if (h < 22) return `${Math.round(h)} hours ago`;
        if (dd < 1.5) return 'a day ago'; if (dd < 26) return `${Math.round(dd)} days ago`;
        if (mo < 1.5) return 'a month ago'; if (mo < 11) return `${Math.round(mo)} months ago`;
        if (y < 1.5) return 'a year ago'; return `${Math.round(y)} years ago`;
      },
    };
  }

  // ----- Menu, rendered like Obsidian's -----
  class Menu {
    constructor() { this.items = []; }
    addItem(fn) { const it = { title: '', checked: null, icon: null, disabled: false }; const api = {
      setTitle: (t) => { it.title = t; return api; }, setChecked: (c) => { it.checked = c; return api; },
      setIcon: (i) => { it.icon = i; return api; }, setDisabled: (d) => { it.disabled = d; return api; }, onClick: () => api };
      fn(api); this.items.push(it); return this; }
    addSeparator() { this.items.push('---'); return this; }
    showAtMouseEvent(evt) {
      const m = document.body.createDiv({ cls: 'menu' });
      for (const it of this.items) {
        if (it === '---') { m.createDiv({ cls: 'menu-separator' }); continue; }
        const row = m.createDiv({ cls: ['menu-item', it.disabled ? 'is-disabled' : ''].filter(Boolean) });
        const ic = row.createDiv({ cls: 'menu-item-icon' });
        if (it.checked) setIcon(ic, 'check'); else if (it.icon) setIcon(ic, it.icon);
        row.createDiv({ cls: 'menu-item-title', text: it.title });
      }
      m.style.left = (evt.x - 230) + 'px'; m.style.top = (evt.y + 8) + 'px';
    }
  }

  // ----- Settings UI -----
  class Setting {
    constructor(container) {
      this.settingEl = container.createDiv({ cls: 'setting-item' });
      this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
      this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
      this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
      this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }
    setName(n) { this.nameEl.textContent = n; return this; }
    setDesc(d) { this.descEl.textContent = d; return this; }
    setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
    addToggle(fn) { const c = this.controlEl.createDiv({ cls: 'checkbox-container' }); const api = { setValue: (v) => { if (v) c.classList.add('is-enabled'); return api; }, onChange: () => api }; fn(api); return this; }
    addSlider(fn) { const i = this.controlEl.createEl('input', { cls: 'slider', attr: { type: 'range' } }); const api = {
      setLimits: (lo, hi, st) => { i.min = lo; i.max = hi; i.step = st; return api; }, setValue: (v) => { i.value = v; return api; },
      setDynamicTooltip: () => api, onChange: () => api }; fn(api); return this; }
    addText(fn) { const i = this.controlEl.createEl('input', { attr: { type: 'text' } }); const api = { setValue: (v) => { i.value = v; return api; }, setPlaceholder: () => api, onChange: () => api }; fn(api); return this; }
    addTextArea(fn) { const t = this.controlEl.createEl('textarea'); const api = { setValue: (v) => { t.value = v; return api; }, setPlaceholder: (p) => { t.placeholder = p; return api; }, onChange: () => api, inputEl: t }; fn(api); return this; }
    addButton(fn) { const b = this.controlEl.createEl('button'); const api = { setButtonText: (x) => { b.textContent = x; return api; }, setTooltip: () => api, onClick: () => api }; fn(api); return this; }
  }

  class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    async loadData() { return window.__data; } async saveData(d) { window.__data = d; }
    registerView(t, f) { window.__viewFactory = f; } registerHoverLinkSource() {} addRibbonIcon() {}
    addCommand() {} addSettingTab() {} registerEvent() {}
  }
  class ItemView {
    constructor(leaf) { this.leaf = leaf; this.app = window.app; this.containerEl = document.querySelector('.view-content'); this.contentEl = this.containerEl; }
    registerEvent() {}
  }
  class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); } }
  class TFile { constructor(path, ctime, mtime) { this.path = path; this.extension = 'md'; this.basename = path.split('/').pop().replace(/\.md$/, '');
    this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' }; this.name = this.basename; this.stat = { ctime, mtime }; } }

  window.obsidianShim = { Plugin, ItemView, PluginSettingTab, Setting, TFile, Menu, Notice: class {}, setIcon, moment,
    Platform: { isMobile: new URLSearchParams(location.search).has('mobile') }, debounce: (f) => f };
})();
