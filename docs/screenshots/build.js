// Builds page.html: Obsidian-like frame + the real plugin main.js/styles.css + demo vault.
const fs = require('fs'); const path = require('path');
const [PLUGIN_DIR, OUT] = process.argv.slice(2);
const here = __dirname;
const read = (p) => fs.readFileSync(p, 'utf8');
const theme = `
:root, body.theme-light {
  --background-primary: #ffffff; --background-secondary: #f6f6f6; --background-secondary-alt: #fbfbfb;
  --background-modifier-border: #e0e0e0; --background-modifier-hover: rgba(0,0,0,0.065);
  --text-normal: #222222; --text-muted: #5c5c5c; --text-faint: #ababab; --text-accent: #7852ee;
  --color-accent: #8a5cf5; --color-orange: #ec7500; --color-green: #08b94e; --color-pink: #d53984; --color-yellow: #e0ac00;
  --interactive-accent: #8a5cf5; --titlebar-bg: #f3f3f3; --tab-active: #ffffff; --shadow: 0 6px 24px rgba(0,0,0,0.14);
}
body.theme-dark {
  --background-primary: #1e1e1e; --background-secondary: #262626; --background-secondary-alt: #2a2a2a;
  --background-modifier-border: #363636; --background-modifier-hover: rgba(255,255,255,0.075);
  --text-normal: #dadada; --text-muted: #b3b3b3; --text-faint: #666666; --text-accent: #a68af9;
  --color-accent: #a68af9; --color-orange: #e9973f; --color-green: #44cf6e; --color-pink: #fa99cd; --color-yellow: #e0de71;
  --interactive-accent: #8a5cf5; --titlebar-bg: #262626; --tab-active: #1e1e1e; --shadow: 0 6px 24px rgba(0,0,0,0.5);
}
:root { --font-ui-medium: 15px; --font-ui-small: 13px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; background: var(--background-primary); color: var(--text-normal); font-size: 16px; -webkit-font-smoothing: antialiased; }
.titlebar { height: 44px; background: var(--titlebar-bg); display: flex; align-items: flex-end; padding: 0 12px 0 84px; border-bottom: 1px solid var(--background-modifier-border); position: relative; }
.traffic { position: absolute; left: 16px; top: 15px; display: flex; gap: 8px; } .traffic i { width: 12px; height: 12px; border-radius: 50%; display: block; }
.tab { background: var(--tab-active); height: 34px; padding: 0 14px; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-bottom: none; margin-bottom: -1px; }
.tab .svg-icon { width: 15px; height: 15px; color: var(--text-muted); }
.tab-plus { margin: 0 0 8px 10px; color: var(--text-muted); font-size: 18px; }
.view-header { height: 40px; display: flex; align-items: center; padding: 0 16px; gap: 14px; font-size: 13px; color: var(--text-muted); }
.view-header b { color: var(--text-normal); font-weight: 500; }
.view-content { overflow: hidden; }
a.internal-link { color: var(--text-accent); text-decoration: none; }
h1 { font-weight: 700; letter-spacing: -0.01em; } h2 { font-weight: 600; }
button { font: inherit; }
.clickable-icon { background: none; border: none; padding: 6px; border-radius: 6px; color: var(--text-muted); display: inline-flex; align-items: center; cursor: pointer; }
.clickable-icon:hover { background: var(--background-modifier-hover); }
/* menu */
.menu { position: absolute; z-index: 10; min-width: 230px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 6px; box-shadow: var(--shadow); font-size: 14px; }
.menu-item { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 4px; color: var(--text-normal); }
.menu-item.is-disabled { color: var(--text-faint); }
.menu-item:nth-child(2) { background: var(--background-modifier-hover); }
.menu-item-icon { width: 18px; height: 18px; color: var(--text-muted); display: flex; } .menu-item-icon .svg-icon { width: 16px; height: 16px; }
.menu-separator { height: 1px; background: var(--background-modifier-border); margin: 5px 4px; }
/* settings */
.modal { margin: 28px auto; width: 860px; display: flex; border: 1px solid var(--background-modifier-border); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); background: var(--background-primary); }
.modal-side { width: 220px; background: var(--background-secondary); padding: 18px 10px; font-size: 13px; color: var(--text-muted); }
.modal-side div { padding: 5px 10px; border-radius: 5px; } .modal-side .group { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-faint); margin-top: 14px; }
.modal-side .active { background: var(--background-modifier-hover); color: var(--text-normal); }
.modal-main { flex: 1; padding: 24px 32px; }
.setting-item { display: flex; align-items: center; gap: 20px; padding: 14px 0; border-top: 1px solid var(--background-modifier-border); }
.setting-item:first-child { border-top: none; }
.setting-item-info { flex: 1; } .setting-item-name { font-size: 15px; } .setting-item-description { font-size: 13px; color: var(--text-muted); margin-top: 3px; }
.setting-item-heading { border-top: none; padding-top: 26px; } .setting-item-heading .setting-item-name { font-weight: 600; font-size: 16px; }
.setting-item-control { display: flex; gap: 8px; align-items: center; }
.checkbox-container { width: 40px; height: 22px; border-radius: 11px; background: var(--background-modifier-border); position: relative; }
.checkbox-container::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.checkbox-container.is-enabled { background: var(--interactive-accent); } .checkbox-container.is-enabled::after { left: 21px; }
input.slider { width: 160px; accent-color: var(--interactive-accent); }
textarea { width: 240px; font: inherit; font-size: 13px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 8px; background: var(--background-primary); color: var(--text-normal); }
.setting-item-control button { border: 1px solid var(--background-modifier-border); background: var(--background-secondary); border-radius: 6px; padding: 5px 10px; font-size: 13px; color: var(--text-normal); }
/* mobile frame */
body.is-mobile { width: 390px; overflow: hidden; } body.is-mobile .titlebar { padding-left: 16px; height: 50px; } body.is-mobile .traffic { display: none; }
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${theme}</style><style>${read(path.join(PLUGIN_DIR, 'styles.css'))}</style></head>
<body>
<div class="titlebar"><div class="traffic"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
<div class="tab"><span class="tab-icon"></span>Landing Pad</div><div class="tab-plus">+</div></div>
<div class="view-header"><span>‹</span><span>›</span><b>Landing Pad</b></div>
<div class="view-content"></div>
<script>${read(path.join(here, 'vendor/lucide.min.js'))}</script>
<script>${read(path.join(here, 'shim.js'))}</script>
<script>${read(path.join(here, 'vault.js'))}</script>
<script>
(function () { var module = { exports: {} }, exports = module.exports;
  var require = function (n) { if (n === 'obsidian') return window.obsidianShim; throw new Error('no module ' + n); };
${read(path.join(PLUGIN_DIR, 'main.js'))}
  window.LandingPad = module.exports; })();
</script>
<script>
(async function () {
  const q = new URLSearchParams(location.search);
  document.body.classList.add(q.get('theme') === 'dark' ? 'theme-dark' : 'theme-light');
  if (q.has('mobile')) document.body.classList.add('is-mobile');
  obsidianShim.setIcon(document.querySelector('.tab-icon'), 'plane-landing');
  const plugin = new LandingPad(app, { id: 'landing-pad', dir: '.obsidian/plugins/landing-pad' });
  await plugin.onload();
  if (q.get('rerolls')) window.__rerolls = +q.get('rerolls');
  const view = window.__viewFactory({});
  view.plugin = plugin; view.rerolls = +(q.get('rerolls') || 0);
  const shot = q.get('shot') || 'home';
  if (shot === 'settings') {
    document.querySelector('.view-content').remove(); document.querySelector('.view-header').remove();
    const modal = document.body.createDiv({ cls: 'modal' });
    const side = modal.createDiv({ cls: 'modal-side' });
    side.innerHTML = '<div class="group">Options</div><div>General</div><div>Editor</div><div>Appearance</div><div>Hotkeys</div><div class="group">Community plugins</div><div class="active">Landing Pad</div>';
    const main = modal.createDiv({ cls: 'modal-main' });
    plugin.settingTab.containerEl = main; plugin.settingTab.display();
  } else if (shot === 'windsock') {
    document.body.innerHTML = '';
    const box = document.body.createDiv({ cls: 'windsock-only' });
    box.style.cssText = 'display:flex;justify-content:center;align-items:center;height:100vh;transform:scale(3);transform-origin:center';
    const stage = +q.get('stage');
    view.renderWindsock(box, { recent: [0, 3, 5, 7, 14][stage], stage, idleDays: 0, wilted: q.has('calm'), milestone: 0, usual: 6 });
    box.querySelector('.landing-pad-windsock-caption').remove();
    const flap = box.querySelector('.ws-flap');
    flap.style.animation = 'none';
    if (q.has('skew')) flap.style.transform = 'skewY(' + q.get('skew') + 'deg) scaleY(' + q.get('sy') + ')';
  } else {
    await view.render();
    if (shot === 'menu') {
      const btn = document.querySelector('.landing-pad-customize'); const r = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('click', { clientX: r.right, clientY: r.bottom }));
    }
  }
  document.body.dataset.ready = '1';
})().catch((e) => { document.body.innerHTML = '<pre style="color:red">' + e.stack + '</pre>'; });
</script></body></html>`;
fs.writeFileSync(OUT, html);
console.log('written', OUT, Math.round(html.length / 1024) + ' KB');
