const Module = require('module'); const assert = require('assert');
const PLUGIN = require('path').resolve(process.argv[2] || __dirname + '/../main.js');
// ---- fake timers ----
let now = 1_000_000, timers = [], tid = 0;
Date.now = () => now;
global.window = {
  setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: now + ms, fn }); return tid; },
  clearTimeout: (id) => { timers = timers.filter(t => t.id !== id); },
  localStorage: { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } },
};
const advance = (ms) => { now += ms; const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now); due.forEach(t => t.fn()); };
// ---- fake DOM ----
class El { constructor(tag){this.attr={};this.tag=tag;this.children=[];this.text='';this.cls=[];this.listeners={};}
  createEl(tag,o={}){const e=new El(tag);e.attr=o.attr||{};if(o.text)e.text=o.text;if(o.cls)e.cls.push(...(Array.isArray(o.cls)?o.cls:o.cls.split(' ')));this.children.push(e);return e;}
  createDiv(o={}){return this.createEl('div',o);} createSvg(t,o={}){ if(typeof o.cls==='string' && /\s/.test(o.cls)) throw new Error("InvalidCharacterError: classList.add('"+o.cls+"')"); return this.createEl(t,o);} createSpan(o={}){return this.createEl('span',o);}
  empty(){this.children=[];} addClass(c){this.cls.push(c);} addEventListener(n,f){this.listeners[n]=f;}
  all(){return [this,...this.children.flatMap(c=>c.all())];} }
// ---- fake obsidian ----
class TFile { constructor(path, ctime, mtime){ this.path=path; this.extension='md'; this.basename=path.split('/').pop().replace(/\.md$/,''); const d=path.split('/').slice(0,-1).join('/'); this.parent={path:d||'/'}; this.stat={ctime,mtime}; } }
const disk = {}; const handlers = {};
const on = (ns) => (ev, fn) => { (handlers[ns+ev] ||= []).push(fn); return {}; };
const emit = (ns, ev, ...a) => (handlers[ns+ev]||[]).forEach(f => f(...a));
let activeFile = null, opened = [];
const files = [
  new TFile('Projects/A.md', 100, 900), new TFile('People/B.md', 300, 200),
  new TFile('C.md', 200, 500), new TFile('Archive/Old.md', 999, 999),
];
let viewFactory; let sharedData = null; const searches = [], reveals = [], urls = []; let bmChanged = null;
const plugins = {
  bookmarks: { on: (ev, fn) => { if (ev === 'changed') bmChanged = fn; return {}; }, items: [
    { type: 'file', ctime: 10, path: 'C.md' },
    { type: 'group', title: 'Work', ctime: 1, items: [
      { type: 'heading', ctime: 50, path: 'Projects/A.md', subpath: '#Goals' },
      { type: 'group', title: 'Deep', items: [ { type: 'block', ctime: 40, path: 'C.md', subpath: '#^abc', title: 'My block' } ] },
    ]},
    { type: 'file', ctime: 99, path: 'Gone.md' },
    { type: 'folder', ctime: 30, path: 'People' },
    { type: 'search', ctime: 20, query: 'tag:#idea' },
    { type: 'url', ctime: 60, url: 'https://example.com/x', title: 'Example' },
    { type: 'graph', ctime: 70 },
  ]},
  templates: { options: { folder: 'Archive/' } },
  'global-search': { openGlobalSearch: (q) => searches.push(q) },
  'file-explorer': { revealInFolder: (f) => reveals.push(f.path) },
};
global.window.open = (u) => urls.push(u);
const app = {
  vault: { getName: () => 'v', cachedRead: async (f) => `---\ntags: [x]\n---\n# Title\nSome [[Link|linked]] text with **bold** and a [site](http://x).\n- [ ] task one\n`, configDir: '.obsidian',
    getAbstractFileByPath: (path) => files.find(f => f.path === path) || (path === 'People' ? { name: 'People', path } : null), getMarkdownFiles: () => files, on: on('vault:'),
    adapter: { read: async p => { if (!(p in disk)) throw new Error('nf'); return disk[p]; }, write: async (p,b) => { disk[p]=b; },
      list: async dir => ({ files: Object.keys(disk).filter(p => p.startsWith(dir+'/')), folders: [] }) } },
  commands: { commands: { 'file-explorer:new-file': {}, 'canvas:new-file': {}, 'switcher:open': {} },
    findCommand(id) { return this.commands[id]; }, executeCommandById(id) { executed.push(id); return true; } },
  hotkeyManager: { printHotkeyForCommand: (id) => ({ 'file-explorer:new-file': '⌘ N', 'switcher:open': '⌘ O' })[id] || '' },
  internalPlugins: { getEnabledPluginById: (id) => plugins[id] || null },
  workspace: { on: on('ws:'), openLinkText(l, s, t){ opened.push(['link', l, t]); }, getActiveFile: () => activeFile, onLayoutReady: fn => fn(), trigger(){},
    leaves: [], getLeavesOfType(t){ return this.leaves.filter(l => l.type===t); },
    getLeaf(){ const l = { type:null, async setViewState(s){ this.type=s.type; this.view=viewFactory(this); await this.view.onOpen(); }, openFile(f){ opened.push(f.path); } }; this.leaves.push(l); return l; },
    revealLeaf(){}, setActiveLeaf(){} },
};
const executed = []; let lastMenu = null; const settingsLog = [];
class MenuItem { constructor(){ this.title=''; this.checked=null; this.icon=null; this.fn=null; }
  setTitle(t){this.title=t;return this} setChecked(c){this.checked=c;return this} setIcon(i){this.icon=i;return this} setDisabled(d){this.disabled=d;return this} onClick(f){this.fn=f;return this} }
class FakeMenu { constructor(){ this.items=[]; } addItem(f){ const it=new MenuItem(); f(it); this.items.push(it); return this; }
  addSeparator(){ this.items.push('---'); return this; } showAtMouseEvent(){ lastMenu=this; } }
class FakeSetting { constructor(el){ this.el=el; this.rec={}; settingsLog.push(this.rec); }
  setName(n){this.rec.name=n;return this} setDesc(d){this.rec.desc=d;return this} setHeading(){this.rec.heading=true;return this}
  addToggle(f){ const t={ setValue:(v)=>{this.rec.value=v;return t}, onChange:(cb)=>{this.rec.onChange=cb;return t} }; f(t); return this; }
  addText(f){ const t={ setValue:()=>t, onChange:()=>t }; f(t); return this; }
  addSlider(f){ const sl={ setLimits:(lo,hi,st)=>{this.rec.limits=[lo,hi,st];return sl}, setValue:(v)=>{this.rec.value=v;return sl}, setDynamicTooltip:()=>{this.rec.tooltip=true;return sl}, onChange:(cb)=>{this.rec.onChange=cb;return sl} }; f(sl); return this; }
  addTextArea(f){ const t={ setValue:()=>t, setPlaceholder:()=>t, onChange:()=>t, inputEl:{} }; f(t); return this; }
  addButton(f){ const b={ setButtonText:(x)=>{this.rec.button=x;return b}, setTooltip:()=>b, onClick:(cb)=>{this.rec.onButton=cb;return b} }; f(b); return this; } }
const notices = [];
const obs = {
  Notice: class { constructor(m){ notices.push(m); } },
  Menu: FakeMenu,
  Platform: { isMobile: false },
  TFile, moment: (t) => ({ fromNow: () => `ago:${t}`, format: () => 'today' }),
  setIcon(){}, debounce: (fn) => fn,
  Plugin: class { constructor(){ this.app=app; this.manifest={dir:'.obsidian/plugins/home-screen', id:'home-screen'}; this.data=undefined; }
    async loadData(){ return this.data !== undefined ? this.data : sharedData; } async saveData(d){ this.data = undefined; sharedData = JSON.parse(JSON.stringify(d)); }
    registerView(t,f){ viewFactory=f; } registerHoverLinkSource(){} addRibbonIcon(){} addCommand(){} addSettingTab(){} registerEvent(){} },
  ItemView: class { constructor(leaf){ this.leaf=leaf; this.app=app; this.contentEl=new El('div'); } registerEvent(){} },
  PluginSettingTab: class { constructor(app, plugin){ this.app=app; this.containerEl=new El('div'); this.containerEl.isShown=()=>this.shown; } }, Setting: FakeSetting,
};
const orig = Module._load; Module._load = function(r,...a){ return r==='obsidian' ? obs : orig.call(this,r,...a); };
const P = require(PLUGIN);
(async () => {
  // another device already has data, plus an iCloud conflict copy that must be ignored
  disk['.obsidian/plugins/home-screen/reads-otherdev.json'] = JSON.stringify({reads:{'C.md':{count:4,last:50}}});
  disk['.obsidian/plugins/home-screen/reads-otherdev 2.json'] = JSON.stringify({reads:{'C.md':{count:100,last:60}}});
  const p = new P(); await p.onload();
  const open = (f) => { activeFile = f; emit('ws:','file-open', f); };
  const [A,B,C] = files;
  open(A); advance(4999); assert.strictEqual(p.reads['Projects/A.md'], undefined, 'not before 5s'); advance(1);
  assert.strictEqual(p.reads['Projects/A.md'].count, 1, 'counted after 5s');
  open(B); advance(3000); open(C); advance(5000);
  assert.strictEqual(p.reads['People/B.md'], undefined, 'B skipped');
  assert.strictEqual(p.reads['C.md'].count, 1, 'C counted');
  open(A); activeFile = B; advance(5000); assert.strictEqual(p.reads['Projects/A.md'].count, 1, 'no count if not active');
  open(A); emit('ws:','file-open', null); activeFile = A; advance(6000); assert.strictEqual(p.reads['Projects/A.md'].count, 1, 'null cancels');
  open(A); advance(5000); assert.strictEqual(p.reads['Projects/A.md'].count, 2);
  await p.persist();
  assert.strictEqual(sharedData.reads[p.deviceId]['Projects/A.md'].count, 2, 'own counts saved in data.json');
  assert.strictEqual(sharedData.reads.otherdev['C.md'].count, 4, 'legacy file migrated (conflict copy ignored)');
  assert.strictEqual(sharedData.readsMigrated, true); assert(!('reads' in p.settings), 'reads not mixed into settings');
  assert(!Object.keys(disk).some(k => /reads-[a-z0-9]+\.json$/.test(k) && !k.includes('otherdev')), 'no new per-device file written');
  assert(disk['.obsidian/plugins/home-screen/reads-otherdev.json'], 'legacy file left in place');
  const agg = await p.aggregateReads(); assert.strictEqual(agg['C.md'].count, 5, 'aggregate');
  await p.activateView(); const view = app.workspace.leaves[0].view;
  const texts = view.contentEl.all().map(e => e.text);
  assert(!texts.includes('Old'), 'archive excluded');
  const allCards = view.contentEl.all().filter(e => e.cls.includes('landing-pad-card'));
  const vaultCard = allCards[0]; assert(vaultCard.cls.includes('landing-pad-vault'), 'vault card first');
  const cards = allCards.slice(1);
  const names = c => c.all().filter(e => e.tag==='a').map(e => e.text);
  assert.deepStrictEqual(names(cards[0]), ['B','C','A'], 'created order');
  assert.deepStrictEqual(names(cards[1]), ['A','C','B'], 'updated order');
  assert.deepStrictEqual(names(cards[2]), ['A','C'], 'recent read order');
  assert.deepStrictEqual(names(cards[3]), ['C','A'], 'most read order');
  assert(texts.includes('5 reads') && texts.includes('2 reads'));
  assert(!view.contentEl.all().some(e => /Projects|People/.test(e.text) && e.cls.includes('landing-pad-folder')), 'no note paths shown');
  // bookmarks card
  const bm = cards[4]; assert(bm.all().some(e => e.text === 'Recent bookmarks'));
  assert.deepStrictEqual(names(bm), ['Example', 'A › Goals', 'My block', 'People', 'tag:#idea', 'C'], 'bookmark order, gone + graph skipped');
  const subs = bm.all().filter(e => e.cls.includes('landing-pad-folder')).map(e => e.text);
  assert.deepStrictEqual(subs, ['example.com', 'Work', 'Work / Deep', 'Folder', 'Search'], 'subtitles');
  const links = bm.all().filter(e => e.tag === 'a');
  links[0].listeners.click({ preventDefault(){} }); assert.deepStrictEqual(urls, ['https://example.com/x']);
  links[1].listeners.click({ preventDefault(){} }); links[2].listeners.click({ preventDefault(){} }); links[5].listeners.click({ preventDefault(){} });
  links[3].listeners.click({ preventDefault(){} }); links[4].listeners.click({ preventDefault(){} });
  assert.deepStrictEqual(reveals, ['People']); assert.deepStrictEqual(searches, ['tag:#idea']);
  assert.deepStrictEqual(opened.splice(0), [['link','Projects/A.md#Goals','tab'], ['link','C.md#^abc','tab'], ['link','C.md','tab']]);
  assert(typeof bmChanged === 'function', 'listens for bookmark changes');
  // item count limit applies
  p.settings.itemCount = 2; await view.render();
  assert.strictEqual(names(view.contentEl.all().filter(e => e.cls.includes('landing-pad-card'))[5]).length, 2); p.settings.itemCount = 10;
  // fallback to bookmarks.json when core plugin disabled
  const saved = plugins.bookmarks; delete plugins.bookmarks;
  disk['.obsidian/bookmarks.json'] = JSON.stringify({ items: [{ type: 'file', ctime: 5, path: 'C.md' }] });
  assert.deepStrictEqual((await p.getBookmarks()).map(b => b.path), ['C.md'], 'json fallback');
  delete disk['.obsidian/bookmarks.json']; assert.deepStrictEqual(await p.getBookmarks(), [], 'no bookmarks at all');
  plugins.bookmarks = saved;
  cards[3].all().find(e => e.tag==='a').listeners.click({ preventDefault(){} }); assert.deepStrictEqual(opened, ['C.md']);
  await p.activateView(); assert.strictEqual(app.workspace.getLeavesOfType('landing-pad-view').length, 1, 'reuse');
  const oldPath = A.path; A.path = 'Renamed.md'; emit('vault:','rename', A, oldPath);
  assert.strictEqual(p.reads['Renamed.md'].count, 2); assert(!p.reads[oldPath]);
  emit('vault:','delete', C); assert(!p.reads['C.md']);
  await p.writeQueue;
  assert(!sharedData.reads.otherdev['C.md'], 'delete applied to other devices too');
  const p2 = new P(); await p2.onload(); assert.strictEqual(p2.deviceId, p.deviceId); assert.strictEqual(p2.reads['Renamed.md'].count, 2);
  p2.settings.minReadSeconds = 2; open(B); advance(2000); assert.strictEqual(p2.reads['People/B.md'].count, 1, 'custom threshold');
  p2.settings.excludedFolders = 'People/, Archive'; assert.deepStrictEqual(p2.getVisibleFiles().map(f=>f.path), ['Renamed.md','C.md']);
  // ================= whimsy =================
  const { greeting, GREETINGS: G } = P._internals;
  const wed = (h) => new Date(2026, 10, 11, h), sat = (h) => new Date(2026, 10, 14, h);
  assert(G.morning.includes(greeting(wed(8))), 'morning');
  assert(G.midday.includes(greeting(wed(12))), 'midday');
  assert(G.afternoon.includes(greeting(wed(15))), 'afternoon');
  assert(G.evening.includes(greeting(wed(19))), 'evening');
  assert(G.night.includes(greeting(wed(23))) && G.night.includes(greeting(wed(3))), 'night');
  const satG = greeting(sat(10));
  assert(G.weekend.map(x => x.replace('{day}', 'Saturday')).includes(satG), 'weekend: ' + satG);
  assert(!/\{day\}/.test(satG));
  for (const [k, pool] of Object.entries(G)) { assert(pool.length >= 10, k + ' pool size'); assert.strictEqual(new Set(pool).size, pool.length, k + ' duplicates'); }
  for (const pool of Object.values(G)) for (const g of pool) if (g.includes('{day}')) assert(G.weekend.includes(g), '{day} only in weekend: ' + g);
  // every greeting is reachable over a year of mornings, and they vary day to day
  const seenMorning = new Set(); for (let i = 0; i < 365; i++) seenMorning.add(greeting(new Date(2026, 0, 1 + i, 8)));
  assert(seenMorning.size >= 10, 'variety: ' + seenMorning.size);
  const seenWeekend = new Set(); for (let i = 0; i < 365; i++) { const dt = new Date(2026, 0, 1 + i, 12); if (dt.getDay() % 6 === 0) seenWeekend.add(greeting(dt)); }
  assert.strictEqual(seenWeekend.size, G.weekend.map(x => x).length > 0 ? seenWeekend.size : 0); assert(seenWeekend.size >= 10, 'weekend variety: ' + seenWeekend.size);
  assert(G.night.includes(greeting(sat(23))), 'weekend night is night');
  assert(G.morning.includes(greeting(sat(6))), 'weekend early morning');
  assert.strictEqual(greeting(wed(8)), greeting(new Date(2026, 10, 11, 8, 59)), 'stable within the hour');

  // From the vault
  const NOW = new Date(2026, 10, 12, 9);
  const d = (days) => NOW.getTime() - days * 864e5;
  const mk = (path, cDays, mDays) => new TFile(path, d(cDays), d(mDays));
  const pool = [mk('old1.md', 200, 100), mk('old2.md', 300, 90), mk('old3.md', 400, 60), mk('edited.md', 400, 2),
    mk('readlately.md', 400, 100), mk('new.md', 5, 5)];
  const rd = { 'readlately.md': { count: 3, last: d(1) } };
  const seen = new Set();
  for (let r = 0; r < 20; r++) seen.add(p2.pickFromVault(pool, rd, r, NOW).path);
  assert.deepStrictEqual([...seen].sort(), ['old1.md', 'old2.md', 'old3.md'], 'only forgotten notes: ' + [...seen]);
  assert.strictEqual(p2.pickFromVault(pool, rd, 0, NOW).path, p2.pickFromVault([...pool].reverse(), rd, 0, NOW).path, 'stable per day');
  assert.strictEqual(p2.pickFromVault([mk('new.md', 5, 5)], {}, 0, NOW), null, 'nothing old enough');
  assert.strictEqual(p2.pickFromVault([mk('edited.md', 400, 2)], {}, 0, NOW).path, 'edited.md', 'fallback to old when none forgotten');

  // snippet
  assert.strictEqual(await p2.snippet(pool[0]), 'Title Some linked text with bold and a site. task one');
  const longRead = app.vault.cachedRead; app.vault.cachedRead = async () => 'word '.repeat(80);
  const sn = await p2.snippet(pool[0]); assert(sn.endsWith('…') && sn.length <= 201, 'truncated: ' + sn.length);
  app.vault.cachedRead = async () => { throw new Error('x'); }; assert.strictEqual(await p2.snippet(pool[0]), '', 'read error');
  app.vault.cachedRead = longRead;

  // anniversaries
  const at = (y, m, dd) => new TFile(`${y}-${m}-${dd}.md`, new Date(y, m, dd, 14).getTime(), 0);
  const ann = p2.anniversaries([at(2025, 10, 12), at(2023, 10, 12), at(2026, 10, 12), at(2025, 10, 13), at(2024, 9, 12)], NOW);
  assert.deepStrictEqual(ann.map(a => a.years), [1, 3], 'anniversaries');

  // garden
  const realGet = app.vault.getMarkdownFiles;
  const garden = (n, recent, idleDays) => {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(new TFile(`g${i}.md`, i < recent ? d(1) : d(100), d(idleDays + (i ? 1 : 0))));
    app.vault.getMarkdownFiles = () => arr;
    return p2.gardenState(NOW.getTime());
  };
  let g = garden(50, 0, 0); assert.deepStrictEqual([g.stage, g.wilted, g.milestone], [0, false, 0], 'seed');
  g = garden(50, 1, 0); assert.strictEqual(g.stage, 1);
  g = garden(50, 4, 1); assert.strictEqual(g.stage, 2);
  g = garden(50, 7, 1); assert.strictEqual(g.stage, 3);
  g = garden(50, 12, 2); assert.deepStrictEqual([g.stage, g.wilted], [4, false]);
  g = garden(50, 0, 3); assert.deepStrictEqual([g.wilted, g.idleDays], [true, 3], 'wilts at 3 days');
  g = garden(105, 10, 0); assert.strictEqual(g.milestone, 100, 'milestone crossed this week');
  g = garden(105, 3, 0); assert.strictEqual(g.milestone, 0, 'milestone crossed earlier');
  const drawn = (state) => { const root = new El('div'); view.renderWindsock(root, state); return root; };
  // relative to usual pace: 14 notes/week for 12 weeks
  const paced = (recent) => {
    const arr = [];
    for (let w = 1; w <= 12; w++) for (let i = 0; i < 14; i++) arr.push(new TFile(`w${w}-${i}.md`, d(w * 7 + 1), d(0)));
    for (let i = 0; i < recent; i++) arr.push(new TFile(`r${i}.md`, d(1), d(0)));
    app.vault.getMarkdownFiles = () => arr;
    return p2.gardenState(NOW.getTime());
  };
  assert.deepStrictEqual([0, 5, 8, 14, 25].map(n => paced(n).stage), [0, 1, 2, 3, 4], 'relative stages');
  assert.strictEqual(paced(14).usual, 14);
  const rt = drawn(paced(14)); assert.strictEqual(rt.children[0].attr['aria-label'], '14 new notes this week (usually 14). Steady breeze.');
  app.vault.getMarkdownFiles = realGet;

  const cnt = (root, cls) => root.all().filter(e => e.cls.includes(cls)).length;
  const sockAngle = (root) => +root.all().find(e => e.cls.includes('ws-sock')).attr.transform.match(/rotate\(([-\d.]+)\)/)[1];
  const svgCls = (root) => root.all().find(e => e.tag === 'svg').cls;
  let r = drawn({ recent: 0, stage: 0, idleDays: 0, wilted: false, milestone: 0 });
  assert.strictEqual(r.children[0].attr['aria-label'], 'No wind yet. Write a note to get things moving.');
  assert(cnt(r, 'ws-stripe-a') === 3 && cnt(r, 'ws-stripe-b') === 2, 'five stripes');
  assert(cnt(r, 'ws-bird') === 0 && cnt(r, 'ws-pennant') === 0, 'no bird, no pennant');
  const angles = [0, 1, 2, 3, 4].map(st => sockAngle(drawn({ recent: st * 3, stage: st, idleDays: 0, wilted: false, milestone: 0 })));
  assert(angles.every((a, i) => i === 0 || a < angles[i - 1]), 'more wind lifts the sock: ' + angles);
  r = drawn({ recent: 4, stage: 2, idleDays: 0, wilted: false, milestone: 0 });
  assert.strictEqual(r.children[0].attr['aria-label'], '4 new notes this week. Light breeze.');
  assert(!svgCls(r).includes('is-flapping') && !svgCls(r).includes('is-breezy'), 'no motion in light wind');
  r = drawn({ recent: 7, stage: 3, idleDays: 0, wilted: false, milestone: 0 }); assert(svgCls(r).includes('is-breezy'), 'breezy');
  r = drawn({ recent: 12, stage: 4, idleDays: 0, wilted: false, milestone: 0 });
  assert(svgCls(r).includes('is-flapping'), 'flapping'); assert.strictEqual(r.children[0].attr['aria-label'], '12 new notes this week. Strong tailwind.');
  r = drawn({ recent: 1, stage: 1, idleDays: 0, wilted: false, milestone: 1100 });
  assert(cnt(r, 'ws-pennant') === 1, 'milestone pennant');
  assert.strictEqual(r.children[0].attr['aria-label'], 'Tailwind: you passed 1,100 notes!');
  r = drawn({ recent: 12, stage: 4, idleDays: 5, wilted: true, milestone: 1100 });
  assert(svgCls(r).includes('is-calm') && !svgCls(r).includes('is-flapping'), 'dead calm');
  assert(cnt(r, 'ws-bird') === 1 && cnt(r, 'ws-pennant') === 0, 'bird, no pennant when calm');
  assert(sockAngle(r) > 80, 'hangs limp');
  assert.strictEqual(r.children[0].attr['aria-label'], 'Dead calm. Nothing written in 5 days.');
  assert(!r.all().some(e => /NaN/.test(Object.values(e.attr).join(' '))), 'no NaN in svg');
  r = drawn({ recent: 3, stage: 1, idleDays: 0, wilted: false, milestone: 0 }); assert.strictEqual(r.children[0].children.at(-1).text, '3 this week', 'caption');
  assert(!r.all().some(e => (e.attr.d || '').includes('NaN') || (e.attr.cx || '').includes('NaN')), 'no NaN in svg');

  // rendered view: vault card, dice, greeting, garden; toggles
  const v2leaf = app.workspace.getLeavesOfType('landing-pad-view')[0];
  const v2 = v2leaf.view; v2.plugin = p2;
  await v2.render();
  let vc = v2.contentEl.all().find(e => e.cls.includes('landing-pad-vault'));
  assert(vc && vc.all().some(e => e.text.endsWith('you wrote:')), 'vault card shows a note');
  assert(vc.all().some(e => e.cls.includes('landing-pad-vault-snippet')), 'snippet shown');
  const dice = vc.all().find(e => e.cls.includes('landing-pad-reroll'));
  dice.listeners.click(); assert.strictEqual(v2.rerolls, 1, 'dice rerolls'); await new Promise(r => setImmediate(r));
  assert(v2.contentEl.all().some(e => e.cls.includes('landing-pad-windsock')), 'windsock shown');
  assert(v2.contentEl.all().find(e => e.tag === 'h1').text !== 'Landing Pad', 'greeting shown');
  p2.settings.showGreeting = false; p2.settings.showGarden = false; p2.settings.showFromVault = false;
  await v2.render();
  assert.strictEqual(v2.contentEl.all().find(e => e.tag === 'h1').text, 'Landing Pad', 'greeting off');
  assert(!v2.contentEl.all().some(e => e.cls.includes('landing-pad-windsock')), 'windsock off');
  assert(!v2.contentEl.all().some(e => e.cls.includes('landing-pad-vault')), 'vault off');
  assert.strictEqual(v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card')).length, 5, 'five list cards remain');

  // ================= quick actions =================
  p2.settings.showGreeting = true; p2.settings.showGarden = true; p2.settings.showFromVault = true; p2.settings.showQuickActions = true;
  await v2.render();
  const row = v2.contentEl.all().find(e => e.cls.includes('landing-pad-actions'));
  assert(row, 'actions row shown');
  const btns = row.children;
  assert.deepStrictEqual(btns.map(b => b.all().find(e => e.cls.includes('landing-pad-action-label')).text), ['New note', 'New canvas', 'Go to file'], 'bases skipped when its command is missing');
  assert.deepStrictEqual(btns.map(b => (b.all().find(e => e.cls.includes('landing-pad-action-hotkey')) || {}).text || ''), ['⌘ N', '', '⌘ O'], 'hotkey chips');
  btns[0].listeners.click({}); btns[2].listeners.click({}); assert.deepStrictEqual(executed, ['file-explorer:new-file', 'switcher:open'], 'click runs command');
  app.commands.commands['bases:new-file'] = {}; await v2.render();
  assert.strictEqual(v2.contentEl.all().find(e => e.cls.includes('landing-pad-actions')).children.length, 4, 'bases shown when available');
  // order: actions row sits between header and grid
  const top = v2.contentEl.children.map(c => c.cls[0]); assert.deepStrictEqual(top.slice(0, 3), ['landing-pad-header', 'landing-pad-actions', 'landing-pad-grid'], 'placement: ' + top);
  obs.Platform.isMobile = true; await v2.render();
  assert(!v2.contentEl.all().some(e => e.cls.includes('landing-pad-action-hotkey')), 'no hotkeys on mobile'); obs.Platform.isMobile = false;
  app.hotkeyManager.printHotkeyForCommand = () => { throw new Error('x'); }; await v2.render();
  assert.strictEqual(v2.contentEl.all().find(e => e.cls.includes('landing-pad-actions')).children.length, 4, 'survives hotkey API error');
  const savedCmds = app.commands; delete app.commands; await v2.render();
  assert(!v2.contentEl.all().some(e => e.cls.includes('landing-pad-actions')), 'no row without commands API'); app.commands = savedCmds;
  p2.settings.showQuickActions = false; await v2.render();
  assert(!v2.contentEl.all().some(e => e.cls.includes('landing-pad-actions')), 'setting off hides row');
  assert.strictEqual(v2.getDisplayText(), 'Landing Pad', 'tab title'); assert.strictEqual(v2.getIcon(), 'plane-landing', 'tab icon');
  // ================= customize =================
  p2.settings.showQuickActions = true; await v2.render();
  const titles = () => v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card-title')).map(e => e.text);
  const cust = v2.contentEl.all().find(e => e.cls.includes('landing-pad-customize'));
  assert(cust && cust.attr['aria-label'] === 'Customize Landing Pad', 'customize button');
  cust.listeners.click({}); let m = lastMenu;
  const labels = m.items.filter(i => i !== '---').map(i => i.title);
  assert.deepStrictEqual(labels, ['Greeting','Windsock','Quick actions','From the vault','Recently created','Recently updated','Recently read','Most read','Recent bookmarks','5 items per list','10 items per list','15 items per list','20 items per list','All settings…'], 'menu items');
  assert(m.items.filter(i => i !== '---').slice(0, 9).every(i => i.checked === true), 'all shown and checked');
  assert.strictEqual(m.items.find(i => i.title === '10 items per list').checked, true);
  await m.items.find(i => i.title === 'Most read').fn(); await v2.render();
  assert(!titles().includes('Most read'), 'most read hidden via menu'); assert.deepStrictEqual(p2.settings.hiddenCards, ['mostRead']);
  cust.listeners.click({}); assert.strictEqual(lastMenu.items.find(i => i.title === 'Most read').checked, false, 'unchecked after hiding');
  await lastMenu.items.find(i => i.title === 'Most read').fn(); await v2.render(); assert(titles().includes('Most read'), 'shown again');
  await lastMenu.items.find(i => i.title === 'Windsock').fn(); assert.strictEqual(p2.settings.showGarden, false, 'garden toggled off'); p2.settings.showGarden = true;
  cust.listeners.click({}); await lastMenu.items.find(i => i.title === '5 items per list').fn(); assert.strictEqual(p2.settings.itemCount, 5); p2.settings.itemCount = 10;
  // card context menu
  await v2.render();
  const cards2 = v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card'));
  const updCard = cards2.find(c => c.all().some(e => e.text === 'Recently updated'));
  let prevented = false; updCard.listeners.contextmenu({ preventDefault(){ prevented = true; } });
  assert(prevented, 'native context menu suppressed'); assert.deepStrictEqual(lastMenu.items.filter(i => i !== '---').map(i => i.title), ['Move up', 'Move down', 'Hide this card', 'Customize Landing Pad…']);
  await lastMenu.items.find(i => i.title === 'Hide this card').fn(); await v2.render(); assert(!titles().includes('Recently updated'), 'hidden via card menu');
  const vaultC = v2.contentEl.all().find(e => e.cls.includes('landing-pad-vault'));
  vaultC.listeners.contextmenu({ preventDefault(){} }); assert(!lastMenu.items.some(i => i.title === 'Move up'), 'vault card has no move items'); await lastMenu.items.find(i => i.title === 'Hide this card').fn(); assert.strictEqual(p2.settings.showFromVault, false, 'vault card hidden');
  // hidden order is canonical
  await p2.setPartShown({ card: 'bookmarks' }, false); await p2.setPartShown({ card: 'created' }, false);
  assert.deepStrictEqual(p2.settings.hiddenCards, ['created', 'updated', 'bookmarks']);
  // everything hidden -> hint
  for (const id of ['read','mostRead']) await p2.setPartShown({ card: id }, false);
  p2.settings.showQuickActions = false; await v2.render();
  assert(v2.contentEl.all().some(e => e.cls.includes('landing-pad-all-hidden')), 'all hidden hint');
  assert(v2.contentEl.all().some(e => e.cls.includes('landing-pad-customize')), 'customize button still there');
  // all settings
  const opened2 = []; app.setting = { open: () => opened2.push('open'), openTabById: (id) => opened2.push(id) };
  p2.openSettings(); assert.deepStrictEqual(opened2, ['open', 'home-screen']); delete app.setting; notices.length = 0; p2.openSettings(); assert(/Settings → Community plugins → Landing Pad/.test(notices[0]), 'settings fallback notice'); // no throw
  // settings tab
  const tab = p2.settingTab; tab.shown = false; settingsLog.length = 0; tab.display();
  const heading = settingsLog.find(r => r.heading); assert.strictEqual(heading.name, 'On the page', 'heading');
  const tog = settingsLog.filter(r => 'value' in r && !r.limits && !['Open on startup', 'Replace new tabs'].includes(r.name));
  assert.deepStrictEqual(tog.map(r => r.name), ['Greeting','Windsock','Quick actions','From the vault','Recently created','Recently updated','Recently read','Most read','Recent bookmarks']);
  assert.strictEqual(tog.find(r => r.name === 'Most read').value, false, 'toggle reflects hidden');
  await tog.find(r => r.name === 'Most read').onChange(true); assert(!p2.settings.hiddenCards.includes('mostRead'), 'settings toggle shows card');
  await tog.find(r => r.name === 'Greeting').onChange(false); assert.strictEqual(p2.settings.showGreeting, false);
  // tab redraw only for page changes, and only when open
  let redraws = 0; const realDisplay = tab.display.bind(tab); tab.display = () => { redraws++; };
  tab.shown = true; await p2.saveSettings(); assert.strictEqual(redraws, 0, 'no redraw for settings-tab changes');
  await p2.setPartShown({ card: 'read' }, true); assert.strictEqual(redraws, 1, 'redraw after page change');
  tab.shown = false; await p2.setPartShown({ card: 'read' }, false); assert.strictEqual(redraws, 1, 'no redraw when tab closed');
  tab.display = realDisplay;
  // old settings without hiddenCards still work
  delete p2.settings.hiddenCards; assert.strictEqual(p2.isCardHidden('read'), false); await p2.setPartShown({ card: 'read' }, false); assert.deepStrictEqual(p2.settings.hiddenCards, ['read']);
  // ================= regression: page survives a broken part =================
  p2.settings.hiddenCards = []; p2.settings.showGarden = true; p2.settings.showFromVault = true; p2.settings.showQuickActions = true;
  const realWs = v2.renderWindsock; v2.renderWindsock = () => { throw new Error('boom'); };
  const realErr = console.error; const errs = []; console.error = (...a) => errs.push(a[0]);
  await v2.render(); console.error = realErr; v2.renderWindsock = realWs;
  assert.strictEqual(v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card')).length, 6, 'cards still render when the windsock fails');
  assert(v2.contentEl.all().some(e => e.cls.includes('landing-pad-customize')), 'customize button still there');
  assert.deepStrictEqual(errs, ['Landing Pad: could not show windsock']);
  // regression: strong tailwind on the real page (the state that broke on 15 Nov)
  app.vault.getMarkdownFiles = () => { const arr = []; for (let i = 0; i < 30; i++) arr.push(new TFile(`s${i}.md`, Date.now() - 864e5, Date.now())); return arr; };
  await v2.render(); app.vault.getMarkdownFiles = realGet;
  const wsSvg = v2.contentEl.all().find(e => e.tag === 'svg');
  assert(wsSvg && wsSvg.cls.includes('is-flapping'), 'flapping windsock renders on the page');
  // ================= excluded folders default =================
  assert.strictEqual(p.settings.excludedFolders, 'Archive', 'first install: templates folder pre-filled, slashes trimmed');
  { const P3 = new P(); P3.data = { itemCount: 7 }; await P3.onload(); assert.strictEqual(P3.settings.excludedFolders, '', 'saved settings: no prefill'); }
  { const saved = plugins.templates; delete plugins.templates; const P4 = new P(); P4.data = null; await P4.onload();
    assert.strictEqual(P4.settings.excludedFolders, '', 'no templates plugin: nothing excluded'); assert.strictEqual(P4.getTemplatesFolder(), '');
    plugins.templates = { options: {} }; assert.strictEqual(P4.getTemplatesFolder(), '', 'templates without folder'); plugins.templates = saved; }
  { const P5 = new P(); P5.data = { excludedFolders: 'Inbox' }; await P5.onload(); settingsLog.length = 0; P5.settingTab.display();
    const row = settingsLog.find(x => x.name === 'Excluded folders'); assert.strictEqual(row.button, 'Add "Archive"', 'add button offered');
    P5.settingTab.display = () => {}; await row.onButton(); assert.strictEqual(P5.settings.excludedFolders, 'Inbox\nArchive', 'button appends');
    settingsLog.length = 0; P5.settingTab.display = P5.settingTab.constructor.prototype.display.bind(P5.settingTab); P5.settingTab.display();
    assert(!('button' in settingsLog.find(x => x.name === 'Excluded folders')), 'button gone once added'); }
  // ================= rename: old tabs migrate =================
  const oldLeaf = { state: { type: 'home-screen-view' }, getViewState() { return this.state; }, setViewState(st) { this.state = st; } };
  const otherLeaf = { state: { type: 'markdown' }, getViewState() { return this.state; }, setViewState(st) { this.state = st; } };
  app.workspace.iterateAllLeaves = (fn) => [oldLeaf, otherLeaf].forEach(fn);
  p2.migrateOldTabs();
  assert.strictEqual(oldLeaf.state.type, 'landing-pad-view', 'old tab migrated'); assert.strictEqual(otherLeaf.state.type, 'markdown', 'other tabs untouched');
  delete app.workspace.iterateAllLeaves; p2.migrateOldTabs(); // no throw without the API
  assert(v2.getViewType() === 'landing-pad-view');
  // ================= settings: guideline check =================
  { const P6 = new P(); P6.data = { itemCount: 100, minReadSeconds: 5 }; await P6.onload(); settingsLog.length = 0; P6.settingTab.display();
    const items = settingsLog.find(x => x.name === 'Items per list'), secs = settingsLog.find(x => x.name === 'Seconds before a note counts as read');
    assert.deepStrictEqual(items.limits, [3, 30, 1]); assert.strictEqual(items.value, 30, 'out-of-range value clamped for display'); assert(items.tooltip && items.desc, 'tooltip + description');
    assert.deepStrictEqual(secs.limits, [0, 60, 1]); assert.strictEqual(secs.value, 5); assert(secs.desc);
    await items.onChange(12); assert.strictEqual(P6.settings.itemCount, 12); await secs.onChange(0); assert.strictEqual(P6.settings.minReadSeconds, 0);
    // guidelines: sentence case, no 'settings' in headings, every setting described
    for (const r of settingsLog) {
      assert(!/settings/i.test(r.heading ? r.name : ''), 'no "settings" in headings');
      const words = r.name.split(' ').slice(1).filter(w => !['Landing', 'Pad'].includes(w));
      assert(words.every(w => w === w.toLowerCase()), 'sentence case: ' + r.name);
      assert(r.desc !== undefined && r.desc !== '' || r.heading, 'description for ' + r.name);
    }
    assert(!settingsLog[0].heading, 'no top-level heading'); }
  // ================= replace new tabs =================
  app.workspace.rootSplit = { id: 'root' }; const sidebar = { id: 'side' };
  const mkLeaf = (type, root) => ({ view: { getViewType: () => type }, getRoot: () => root, state: null, setViewState(st) { this.state = st; } });
  const fire = (leaf) => (handlers['ws:active-leaf-change'] || []).forEach(f => f(leaf));
  let L = mkLeaf('empty', app.workspace.rootSplit); fire(L);
  assert(L.state && L.state.type === 'landing-pad-view', 'empty tab replaced');
  L = mkLeaf('markdown', app.workspace.rootSplit); fire(L); assert.strictEqual(L.state, null, 'note tabs untouched');
  L = mkLeaf('empty', sidebar); fire(L); assert.strictEqual(L.state, null, 'sidebar untouched');
  fire(null); fire({}); // no throw
  handlers['ws:active-leaf-change'] = [(l) => p2.replaceIfEmpty(l)]; // one instance only (the tests create several)
  p2.settings.replaceNewTabs = false;
  L = mkLeaf('empty', app.workspace.rootSplit); fire(L); assert.strictEqual(L.state, null, 'setting off');
  p2.settings.replaceNewTabs = true;
  settingsLog.length = 0; p2.settingTab.display(); const rn = settingsLog.find(x => x.name === 'Replace new tabs');
  assert(rn && rn.value === true && rn.desc, 'setting shown'); await rn.onChange(false); assert.strictEqual(p2.settings.replaceNewTabs, false); p2.settings.replaceNewTabs = true;
  // ================= card order =================
  p2.settings.hiddenCards = []; p2.settings.cardOrder = []; p2.settings.showFromVault = false; await v2.render();
  const listTitles = () => v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card-title')).map(e => e.text);
  assert.deepStrictEqual(listTitles(), ['Recently created', 'Recently updated', 'Recently read', 'Most read', 'Recent bookmarks']);
  assert(p2.isDefaultOrder());
  const cardMenu = (title) => { v2.contentEl.all().filter(e => e.cls.includes('landing-pad-card')).find(c => c.all().some(e => e.text === title)).listeners.contextmenu({ preventDefault(){} }); return lastMenu; };
  let cm = cardMenu('Most read');
  assert.strictEqual(cm.items.find(i => i.title === 'Move down').disabled, false);
  await cm.items.find(i => i.title === 'Move up').fn(); await v2.render();
  assert.deepStrictEqual(listTitles(), ['Recently created', 'Recently updated', 'Most read', 'Recently read', 'Recent bookmarks'], 'moved up');
  cm = cardMenu('Recently created'); assert.strictEqual(cm.items.find(i => i.title === 'Move up').disabled, true, 'first card cannot move up');
  cm = cardMenu('Recent bookmarks'); assert.strictEqual(cm.items.find(i => i.title === 'Move down').disabled, true, 'last card cannot move down');
  // moves skip hidden cards, so every move changes what you see
  await p2.setPartShown({ card: 'updated' }, false); await v2.render();
  cm = cardMenu('Most read'); await cm.items.find(i => i.title === 'Move up').fn(); await v2.render();
  assert.deepStrictEqual(listTitles(), ['Most read', 'Recently created', 'Recently read', 'Recent bookmarks'], 'skips hidden card');
  await p2.setPartShown({ card: 'updated' }, true); await v2.render();
  assert.deepStrictEqual(listTitles(), ['Most read', 'Recently updated', 'Recently created', 'Recently read', 'Recent bookmarks'], 'hidden card keeps its slot');
  // reset via the sliders menu
  v2.contentEl.all().find(e => e.cls.includes('landing-pad-customize')).listeners.click({});
  const reset = lastMenu.items.find(i => i.title === 'Reset card order'); assert(reset, 'reset offered when order changed');
  await reset.fn(); await v2.render(); assert(p2.isDefaultOrder()); assert.deepStrictEqual(listTitles()[0], 'Recently created');
  v2.contentEl.all().find(e => e.cls.includes('landing-pad-customize')).listeners.click({});
  assert(!lastMenu.items.some(i => i.title === 'Reset card order'), 'no reset when default');
  // robust against odd saved data
  p2.settings.cardOrder = ['mostRead', 'bogus', 'mostRead']; assert.deepStrictEqual(p2.getOrderedCards().map(c => c.id), ['mostRead', 'created', 'updated', 'read', 'bookmarks']);
  delete p2.settings.cardOrder; assert(p2.isDefaultOrder()); p2.settings.showFromVault = true;
  // ================= unofficial APIs guarded =================
  // bookmarks plugin off -> card hidden, menu + settings explain why
  app.internalPlugins.getPluginById = (id) => id === 'bookmarks' ? { enabled: false } : null;
  p2.settings.hiddenCards = []; await v2.render();
  assert.strictEqual(await p2.getBookmarks(), null); assert(!listTitles().includes('Recent bookmarks'), 'bookmarks card hidden when plugin off');
  v2.contentEl.all().find(e => e.cls.includes('landing-pad-customize')).listeners.click({});
  assert(lastMenu.items.some(i => i.title === 'Recent bookmarks (Bookmarks plugin is off)'), 'menu explains');
  settingsLog.length = 0; p2.settingTab.display(); assert.strictEqual(settingsLog.find(x => x.name === 'Recent bookmarks').desc, 'Hidden while the core Bookmarks plugin is turned off.');
  app.internalPlugins.getPluginById = (id) => id === 'bookmarks' ? { enabled: true } : null; await v2.render();
  assert(listTitles().includes('Recent bookmarks'), 'shown when plugin on');
  app.internalPlugins.getPluginById = () => { throw new Error('api changed'); }; await v2.render();
  assert(listTitles().includes('Recent bookmarks'), 'API change: not treated as off');
  delete app.internalPlugins.getPluginById;
  // device id: storage refusing access
  { const realL = app.loadLocalStorage, realGet2 = window.localStorage.getItem, realSet = window.localStorage.setItem;
    app.loadLocalStorage = () => { throw new Error('denied'); };
    window.localStorage.getItem = () => { throw new Error('denied'); }; window.localStorage.setItem = () => { throw new Error('denied'); };
    const id = p2.getDeviceId(); assert(/^[a-z0-9]+$/.test(id), 'id even without storage');
    app.loadLocalStorage = realL; window.localStorage.getItem = realGet2; window.localStorage.setItem = realSet; }
  { const store = {}; app.loadLocalStorage = (k) => store[k] ?? null; app.saveLocalStorage = (k, v) => { store[k] = v; };
    const a = p2.getDeviceId(), b = p2.getDeviceId(); assert.strictEqual(a, b, 'stable via app storage'); assert(store['home-screen-device-id'], 'stored under unchanged key');
    delete app.loadLocalStorage; delete app.saveLocalStorage; }
  // quick action failing -> notice
  p2.settings.showQuickActions = true; await v2.render(); notices.length = 0;
  const realExec = app.commands.executeCommandById; app.commands.executeCommandById = () => { throw new Error('x'); };
  v2.contentEl.all().find(e => e.cls.includes('landing-pad-actions')).children[0].listeners.click({});
  app.commands.executeCommandById = () => false; v2.contentEl.all().find(e => e.cls.includes('landing-pad-actions')).children[0].listeners.click({});
  app.commands.executeCommandById = realExec;
  assert.deepStrictEqual(notices, ['Landing Pad: couldn\'t run "New note".', 'Landing Pad: couldn\'t run "New note".']);
  // folder / search bookmarks failing -> notice
  notices.length = 0; const savedFE = plugins['file-explorer'], savedGS = plugins['global-search']; delete plugins['file-explorer']; delete plugins['global-search'];
  v2.bookmarkItem({ type: 'folder', path: 'People' }).onClick(); v2.bookmarkItem({ type: 'search', query: 'x' }).onClick();
  plugins['file-explorer'] = savedFE; plugins['global-search'] = savedGS;
  assert(/couldn't show the folder "People"/.test(notices[0]) && /couldn't run the search/.test(notices[1]), 'notices: ' + notices);
  // ================= sync: per-device sections in data.json =================
  { await p2.writeQueue;
    // another device's section arrives via sync while we keep reading
    const d = JSON.parse(JSON.stringify(sharedData)); d.reads.ipad = { 'Renamed.md': { count: 7, last: 99 } }; d.itemCount = 15; sharedData = d;
    await p2.onExternalSettingsChange();
    assert.strictEqual(p2.settings.itemCount, 15, 'settings from other device applied');
    assert.strictEqual(p2.aggregateReads()['Renamed.md'].count, 2 + 7, 'other device counted');
    // our next save keeps the other device's section
    p2.recordRead('Renamed.md'); await p2.persist();
    assert.strictEqual(sharedData.reads.ipad['Renamed.md'].count, 7, 'other device section kept');
    assert.strictEqual(sharedData.reads[p2.deviceId]['Renamed.md'].count, 3, 'own section updated');
    // a sync that arrives between our load and save is merged, not overwritten
    const d2 = JSON.parse(JSON.stringify(sharedData)); d2.reads.ipad['Renamed.md'].count = 8; sharedData = d2;
    p2.recordRead('Renamed.md'); await p2.persist();
    assert.strictEqual(sharedData.reads.ipad['Renamed.md'].count, 8, 'fresh other-device data wins');
    // rename on this device renames other devices' counts too
    const R = files.find(f => f.path === 'Renamed.md'); R.path = 'Moved.md'; emit('vault:', 'rename', R, 'Renamed.md'); await p2.writeQueue; await p.writeQueue;
    assert.strictEqual(sharedData.reads.ipad['Moved.md'].count, 8); assert(!sharedData.reads.ipad['Renamed.md']);
    R.path = 'Renamed.md';
    // writes are queued: parallel saves don't interleave
    await Promise.all([p2.persist(), p2.saveSettings(), p2.persist()]); assert(sharedData.reads.ipad, 'still intact after parallel saves');
    // migration runs only once
    disk['.obsidian/plugins/home-screen/reads-late.json'] = JSON.stringify({ reads: { 'X.md': { count: 1, last: 1 } } });
    const P7 = new P(); await P7.onload(); assert(!P7.allReads.late, 'no second migration');
    delete disk['.obsidian/plugins/home-screen/reads-late.json']; }
  // ================= performance helpers =================
  { const { topN } = P._internals;
    for (let trial = 0; trial < 200; trial++) {
      const list = Array.from({ length: Math.floor(Math.random() * 60) }, (_, i) => ({ i, v: Math.floor(Math.random() * 10) }));
      const n = 1 + Math.floor(Math.random() * 12); const cmp = (a, b) => b.v - a.v || a.i - b.i;
      assert.deepStrictEqual(topN(list, n, cmp), [...list].sort(cmp).slice(0, n), 'topN equals sort+slice');
    }
    // stable order for ties, like Array.prototype.sort
    const ties = [{ k: 'a', v: 1 }, { k: 'b', v: 1 }, { k: 'c', v: 1 }];
    assert.deepStrictEqual(topN(ties, 2, (a, b) => b.v - a.v).map(x => x.k), ['a', 'b']); }
  // hidden Landing Pad tabs are not redrawn; visible ones are
  { let renders = 0; const realRender = v2.render; v2.render = async () => { renders++; };
    v2.containerEl = { isShown: () => false }; p2.refreshViews(); assert.strictEqual(renders, 0, 'hidden tab skipped');
    v2.containerEl = { isShown: () => true }; p2.refreshViews(); assert.strictEqual(renders, 1, 'visible tab redrawn');
    v2.render = realRender; delete v2.containerEl; }
  // today's pick is remembered across redraws, changes with the dice
  { p2.settings.showFromVault = true; v2.pickCache = null; let calls = 0; const realPick = p2.pickFromVault.bind(p2); p2.pickFromVault = (...a) => { calls++; return realPick(...a); };
    await v2.render(); await v2.render(); await v2.render(); assert.strictEqual(calls, 1, 'pick computed once');
    v2.rerolls++; await v2.render(); assert.strictEqual(calls, 2, 'dice computes a new pick');
    p2.pickFromVault = realPick; }
  // snippet: a first heading that repeats the note name is dropped, others are kept
  { const realRead = app.vault.cachedRead;
    app.vault.cachedRead = async () => '---\na: 1\n---\n# Board game night\nOne short opener.';
    assert.strictEqual(await p2.snippet(new TFile('Ideas/Board game night.md', 0, 0)), 'One short opener.', 'title heading dropped');
    assert.strictEqual(await p2.snippet(new TFile('Ideas/Other.md', 0, 0)), 'Board game night One short opener.', 'different heading kept');
    app.vault.cachedRead = async () => '## board GAME night  \nText';
    assert.strictEqual(await p2.snippet(new TFile('Board game night.md', 0, 0)), 'Text', 'case and level insensitive');
    app.vault.cachedRead = realRead; }
  console.log('ALL TESTS PASSED');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
