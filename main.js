/*
 * Landing Pad: a start page with
 *   - a greeting that fits the time of day, plus "on this day" anniversaries,
 *   - a windsock that shows how much you wrote this week, compared with your usual pace,
 *   - "From the vault": one forgotten older note per day (re-rollable),
 *   - lists: Recently created, Recently updated, Recently read, Most read, Recent bookmarks.
 *
 * "Read" = a note stayed the active note for at least `minReadSeconds`.
 * Read counts are stored per device (reads-<deviceId>.json in this folder) so
 * that devices syncing via iCloud never overwrite each other's counts. The home
 * screen adds all device files together.
 */
const { Plugin, ItemView, PluginSettingTab, Setting, TFile, Platform, Menu, Notice, debounce, moment, setIcon } = require("obsidian");

/*
 * Unofficial Obsidian APIs used here. None is in the public plugin API, so each is guarded:
 * if it's missing or throws, that one feature degrades and the rest of the page keeps working.
 *   app.internalPlugins   bookmarks list + change event, file explorer (reveal folder),
 *                         global search (run search), templates folder   -> card hidden / Notice
 *   app.commands          quick action buttons                            -> buttons hidden / Notice
 *   app.hotkeyManager     hotkey chips on the quick actions               -> no chips
 *   app.setting           "All settings…" opens this plugin's tab         -> Notice with the path
 *   app.load/saveLocalStorage   per-device id for read counts             -> window.localStorage,
 *                                                                            then an id for this session
 */

// The list cards. Users can hide each one (settings.hiddenCards holds the ids).
const LIST_CARDS = [
  { id: "created", title: "Recently created" },
  { id: "updated", title: "Recently updated" },
  { id: "read", title: "Recently read" },
  { id: "mostRead", title: "Most read" },
  { id: "bookmarks", title: "Recent bookmarks" },
];

// Everything a user can show or hide from the customize menu, in page order.
const PAGE_PARTS = [
  { title: "Greeting", key: "showGreeting" },
  { title: "Windsock", key: "showGarden" }, // key kept from the garden, so saved settings still apply
  { title: "Quick actions", key: "showQuickActions" },
  { title: "From the vault", key: "showFromVault" },
  ...LIST_CARDS.map((c) => ({ title: c.title, card: c.id })),
];

const ITEM_COUNT_CHOICES = [5, 10, 15, 20];

// Buttons under the header. Each runs an Obsidian command; buttons whose command doesn't
// exist (e.g. the core Bases or Canvas plugin is turned off) are left out.
const QUICK_ACTIONS = [
  { label: "New note", icon: "square-pen", command: "file-explorer:new-file" },
  { label: "New base", icon: "layout-list", command: "bases:new-file" },
  { label: "New canvas", icon: "layout-dashboard", command: "canvas:new-file" },
  { label: "Go to file", icon: "search", command: "switcher:open" },
];

const VIEW_TYPE = "landing-pad-view";
// Read counts used to live in one file per device; they're migrated into data.json once.
const LEGACY_READS_FILE_RE = /^reads-([a-z0-9]+)\.json$/; // ignores iCloud conflict copies like "reads-x 2.json"
// Keys in data.json that aren't settings.
const DATA_KEYS = ["reads", "readsMigrated"];

const DEFAULT_SETTINGS = {
  openOnStartup: true,
  replaceNewTabs: true,
  itemCount: 10,
  minReadSeconds: 5,
  excludedFolders: "", // filled with the core Templates folder on first install, if one is set
  hiddenCards: [],
  cardOrder: [], // list card ids in the user's order; empty = default order
  showGreeting: true,
  showGarden: true,
  showFromVault: true,
  showQuickActions: true,
};

const DAY = 24 * 60 * 60 * 1000;
const FORGOTTEN_AFTER_DAYS = 30; // "From the vault" only picks notes untouched and unread for this long
const WILT_AFTER_DAYS = 3;       // dead calm after this many days without writing

const GREETINGS = {
  morning: [
    "Good morning", "Morning! Coffee first?", "Fresh day, fresh notes",
    "Rise and write", "The early bird gets the blank page", "Morning. The inbox can wait",
    "A blank page, just for you", "Coffee's brewing, thoughts are loading",
    "Good morning, captain", "Let's make today legible", "Hello, sunshine",
    "Ideas are best served fresh", "Cleared for takeoff",
  ],
  midday: [
    "Hello there", "Lunch break reading?", "Halfway through the day",
    "High noon for high ideas", "Refuel, then reflect", "Midday check-in",
    "Food first, thoughts second", "A sandwich and a second brain",
    "The sun is up, so are the ideas", "Time for a mental snack",
    "Cruising altitude reached",
  ],
  afternoon: [
    "Good afternoon", "Afternoon. Still going strong?", "Tea time for thoughts",
    "The afternoon slump has met its match", "Second wind incoming",
    "Back at it", "One more good thought before five?", "Afternoon. What's on your mind?",
    "Plenty of day left", "Steady as she goes", "Time to connect some dots",
    "Smooth air this afternoon",
  ],
  evening: [
    "Good evening", "Evening. Time to wind down?", "The day is almost written",
    "Golden hour for loose ends", "One last thought before tonight?",
    "What went well today?", "Evening. Anything worth remembering?",
    "Dinner, then done", "Time to file the day away", "The lights are low, the ideas aren't",
    "Wrap it up, you've earned it", "Coming in to land",
  ],
  night: [
    "Late one, huh?", "The vault never sleeps", "Burning the midnight oil?",
    "The owls approve", "Night shift for the second brain", "Shouldn't you be asleep?",
    "Quiet hours, loud thoughts", "Midnight musings welcome", "Sleep counts as research too",
    "Just one more note, then bed", "The stars are out, so are you",
    "Night flight, huh?",
  ],
  weekend: [
    "{day}. Maybe not work?", "Happy {day}!", "A slow {day}, hopefully",
    "{day}: no alarms, hopefully", "Weekend mode: engaged", "{day}. Garden or garden notes?",
    "Nowhere to be today", "{day}. Something for fun?", "Slow pages, slow {day}",
    "Lazy {day} approved", "{day}. Read something good?", "Weekend. Everything else can wait",
    "{day}: wheels up, nowhere in particular",
  ],
};

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Small deterministic PRNG so picks stay stable across re-renders on the same day.
function seededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function greeting(date) {
  const h = date.getHours();
  const day = date.getDay();
  let pool;
  if (h >= 22 || h < 5) pool = GREETINGS.night;
  else if ((day === 0 || day === 6) && h >= 7) pool = GREETINGS.weekend;
  else if (h < 11) pool = GREETINGS.morning;
  else if (h < 14) pool = GREETINGS.midday;
  else if (h < 18) pool = GREETINGS.afternoon;
  else pool = GREETINGS.evening;
  const pick = pool[Math.floor(seededRandom(`${dateKey(date)}@${h}`)() * pool.length)];
  return pick.replace("{day}", date.toLocaleDateString("en-US", { weekday: "long" }));
}

class HomeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderToken = 0;
    this.rerolls = 0; // "From the vault" dice presses today
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Landing Pad"; }
  getIcon() { return "plane-landing"; }

  async onOpen() {
    // Re-render whenever the user comes back to this tab (picks up reads from other devices).
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.render();
    }));
    await this.render();
  }

  async render() {
    const token = ++this.renderToken;
    const p = this.plugin;
    const n = p.settings.itemCount;
    const files = p.getVisibleFiles();
    const reads = await p.aggregateReads();
    const bookmarks = await p.getBookmarks();
    const s = p.settings;
    const pick = s.showFromVault ? this.todaysPick(files, reads) : null;
    const snippet = pick ? await p.snippet(pick) : "";
    if (token !== this.renderToken) return; // a newer render started meanwhile

    const byPath = new Map(files.map((f) => [f.path, f]));
    const readEntries = Object.entries(reads)
      .filter(([path]) => byPath.has(path))
      .map(([path, r]) => ({ file: byPath.get(path), count: r.count, last: r.last }));

    const created = topN(files, n, (a, b) => b.stat.ctime - a.stat.ctime);
    const updated = topN(files, n, (a, b) => b.stat.mtime - a.stat.mtime);
    const recentRead = topN(readEntries, n, (a, b) => b.last - a.last);
    const mostRead = topN(readEntries, n, (a, b) => b.count - a.count || b.last - a.last);

    const el = this.contentEl;
    el.empty();
    el.addClass("landing-pad");

    const fileItem = (f, meta) => ({
      label: f.basename,
      meta,
      hover: f.path,
      // Open in a new tab so Landing Pad stays available.
      onClick: () => this.app.workspace.getLeaf("tab").openFile(f),
    });

    // ----- header: greeting, date, anniversaries, windsock -----
    const now = new Date();
    const header = el.createDiv({ cls: "landing-pad-header" });
    const intro = header.createDiv({ cls: "landing-pad-intro" });
    intro.createEl("h1", { text: s.showGreeting ? greeting(now) : "Landing Pad" });
    intro.createDiv({ cls: "landing-pad-date", text: moment().format("dddd, D MMMM YYYY") });
    if (s.showGreeting) {
      const anniversaries = p.anniversaries(files, now);
      if (anniversaries.length) {
        const line = intro.createDiv({ cls: "landing-pad-anniversary" });
        line.createSpan({ text: "On this day: " });
        anniversaries.forEach((a, i) => {
          if (i) line.createSpan({ text: " · " });
          line.createSpan({ text: `${a.years} ${a.years === 1 ? "year" : "years"} ago, ` });
          this.link(line, fileItem(a.file, ""));
        });
      }
    }
    if (s.showGarden) this.safely("windsock", () => this.renderWindsock(header, p.gardenState()));
    const customize = header.createEl("button", {
      cls: "clickable-icon landing-pad-customize", attr: { "aria-label": "Customize Landing Pad" },
    });
    setIcon(customize, "sliders-horizontal");
    customize.addEventListener("click", (evt) => this.showCustomizeMenu(evt));
    if (s.showQuickActions) this.safely("quick actions", () => this.renderQuickActions(el));

    const grid = el.createDiv({ cls: "landing-pad-grid" });
    const emptyRead = `Nothing yet. A note counts as read once it has been open for ${s.minReadSeconds} seconds.`;

    // ----- From the vault -----
    this.safely("from the vault", () => {
      if (s.showFromVault) {
        const card = this.card(grid, "From the vault", "sparkles", { key: "showFromVault" });
        card.addClass("landing-pad-vault");
        const btn = card.headerEl.createEl("button", {
          cls: "clickable-icon landing-pad-reroll", attr: { "aria-label": "Show me another" },
        });
        setIcon(btn, "dices");
        btn.addEventListener("click", () => { this.rerolls++; this.render(); });
        if (!pick) {
          card.createDiv({ cls: "landing-pad-empty", text: "Nothing old enough yet. Check back in a month." });
        } else {
          card.createDiv({ cls: "landing-pad-vault-when", text: `${moment(pick.stat.ctime).fromNow()} you wrote:` });
          const title = card.createDiv({ cls: "landing-pad-vault-title" });
          this.link(title, fileItem(pick, ""));
          if (snippet) card.createDiv({ cls: "landing-pad-vault-snippet", text: snippet });
        }
      }
    });

    const lists = {
      created: ["file-plus", () => created.map((f) => fileItem(f, moment(f.stat.ctime).fromNow())), "No notes."],
      updated: ["pencil", () => updated.map((f) => fileItem(f, moment(f.stat.mtime).fromNow())), "No notes."],
      read: ["eye", () => recentRead.map((r) => fileItem(r.file, moment(r.last).fromNow())), emptyRead],
      mostRead: ["flame", () => mostRead.map((r) => fileItem(r.file, `${r.count} ${r.count === 1 ? "read" : "reads"}`)), emptyRead],
      bookmarks: ["bookmark", () => bookmarks.map((b) => this.bookmarkItem(b)).filter(Boolean).slice(0, n), "No bookmarks yet."],
    };
    for (const c of p.getOrderedCards()) {
      if (p.isCardHidden(c.id)) continue;
      if (c.id === "bookmarks" && bookmarks === null) continue; // core Bookmarks plugin is off
      const [icon, items, empty] = lists[c.id];
      this.safely(c.title, () => this.section(grid, c.title, icon, items(), empty, { card: c.id }));
    }

    if (!grid.children.length && !s.showQuickActions) {
      el.createDiv({ cls: "landing-pad-empty landing-pad-all-hidden", text: "Everything is hidden. Use the sliders button at the top right to show cards again." });
    }
  }

  // "From the vault" only changes once a day or when the dice is pressed, so the pick is
  // remembered instead of recomputed (it sorts every old note) on each redraw.
  todaysPick(files, reads) {
    const key = `${dateKey(new Date())}#${this.rerolls}#${this.plugin.settings.excludedFolders}`;
    const cached = this.pickCache;
    if (cached && cached.key === key) {
      const file = cached.path && files.find((f) => f.path === cached.path);
      if (file || !cached.path) return file || null;
    }
    const pick = this.plugin.pickFromVault(files, reads, this.rerolls);
    this.pickCache = { key, path: pick ? pick.path : null };
    return pick;
  }

  // Runs one part of the page; if it fails, the rest of the page still renders.
  safely(name, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`Landing Pad: could not show ${name}`, e);
    }
  }

  // Menu behind the sliders button: show or hide each part, items per list, all settings.
  showCustomizeMenu(evt) {
    const p = this.plugin;
    const menu = new Menu();
    for (const part of PAGE_PARTS) {
      const off = part.card === "bookmarks" && p.isBookmarksPluginOff();
      menu.addItem((item) => item
        .setTitle(off ? `${part.title} (Bookmarks plugin is off)` : part.title)
        .setChecked(p.isPartShown(part))
        .onClick(() => p.setPartShown(part, !p.isPartShown(part))));
    }
    menu.addSeparator();
    for (const count of ITEM_COUNT_CHOICES) {
      menu.addItem((item) => item
        .setTitle(`${count} items per list`)
        .setChecked(p.settings.itemCount === count)
        .onClick(async () => { p.settings.itemCount = count; await p.saveSettings(true); }));
    }
    menu.addSeparator();
    if (!p.isDefaultOrder()) {
      menu.addItem((item) => item
        .setTitle("Reset card order")
        .setIcon("rotate-ccw")
        .onClick(() => p.resetCardOrder()));
    }
    menu.addItem((item) => item
      .setTitle("All settings…")
      .setIcon("settings")
      .onClick(() => p.openSettings()));
    menu.showAtMouseEvent(evt);
  }

  // Right-click (or long-press on mobile) on a card: hide it.
  showCardMenu(evt, part) {
    evt.preventDefault();
    const menu = new Menu();
    if (part.card) {
      const p = this.plugin;
      menu.addItem((item) => item
        .setTitle("Move up")
        .setIcon("arrow-up")
        .setDisabled(!p.canMoveCard(part.card, -1))
        .onClick(() => p.moveCard(part.card, -1)));
      menu.addItem((item) => item
        .setTitle("Move down")
        .setIcon("arrow-down")
        .setDisabled(!p.canMoveCard(part.card, 1))
        .onClick(() => p.moveCard(part.card, 1)));
      menu.addSeparator();
    }
    menu.addItem((item) => item
      .setTitle("Hide this card")
      .setIcon("eye-off")
      .onClick(() => this.plugin.setPartShown(part, false)));
    menu.addItem((item) => item
      .setTitle("Customize Landing Pad…")
      .setIcon("sliders-horizontal")
      .onClick(() => this.showCustomizeMenu(evt)));
    menu.showAtMouseEvent(evt);
  }

  // Turns a bookmark from the core Bookmarks plugin into a list item (null if its target is gone).
  bookmarkItem(b) {
    const { vault, workspace } = this.app;
    const meta = b.ctime ? moment(b.ctime).fromNow() : "";
    const withGroup = (sub) => [b.group, sub].filter(Boolean).join(" · ");
    const internal = (id) => {
      try { return this.app.internalPlugins.getEnabledPluginById(id); } catch (e) { return null; }
    };

    switch (b.type) {
      case "file":
      case "heading":
      case "block": {
        const file = vault.getAbstractFileByPath(b.path);
        if (!(file instanceof TFile)) return null;
        const raw = b.subpath || "";
        const subpath = !raw ? "" : raw.startsWith("#") ? raw
          : (b.type === "block" && !raw.startsWith("^") ? "#^" : "#") + raw;
        const anchor = subpath.replace(/^#\^?/, "");
        const link = file.path + subpath;
        return {
          label: b.title || (anchor ? `${file.basename} › ${anchor}` : file.basename),
          sub: withGroup(""),
          meta,
          hover: link,
          onClick: () => workspace.openLinkText(link, "", "tab"),
        };
      }
      case "folder": {
        const folder = vault.getAbstractFileByPath(b.path);
        if (!folder || folder instanceof TFile) return null;
        return {
          label: b.title || folder.name,
          sub: withGroup("Folder"),
          meta,
          onClick: () => {
            try { internal("file-explorer").revealInFolder(folder); }
            catch (e) { new Notice(`Landing Pad: couldn't show the folder "${folder.path}".`); }
          },
        };
      }
      case "search":
        return {
          label: b.title || b.query,
          sub: withGroup("Search"),
          meta,
          onClick: () => {
            try { internal("global-search").openGlobalSearch(b.query); }
            catch (e) { new Notice("Landing Pad: couldn't run the search. Is the core Search plugin on?"); }
          },
        };
      case "url": {
        let host = "";
        try { host = new URL(b.url).hostname; } catch (e) { /* keep empty */ }
        return {
          label: b.title || b.url,
          sub: withGroup(host),
          meta,
          onClick: () => window.open(b.url),
        };
      }
      default:
        return null; // graph views and other bookmark types are not shown
    }
  }

  renderQuickActions(parent) {
    const commands = this.app.commands;
    if (!commands || typeof commands.executeCommandById !== "function") return;
    const available = QUICK_ACTIONS.filter((a) => {
      try { return Boolean(commands.findCommand ? commands.findCommand(a.command) : commands.commands[a.command]); }
      catch (e) { return false; }
    });
    if (!available.length) return;

    const row = parent.createDiv({ cls: "landing-pad-actions" });
    for (const action of available) {
      const btn = row.createEl("button", { cls: "landing-pad-action" });
      const iconEl = btn.createSpan({ cls: "landing-pad-action-icon" });
      setIcon(iconEl, action.icon);
      btn.createSpan({ cls: "landing-pad-action-label", text: action.label });
      // Show the user's current hotkey, like Obsidian's own empty tab does. Not on phones and tablets.
      if (!Platform.isMobile) {
        let hotkey = "";
        try { hotkey = this.app.hotkeyManager.printHotkeyForCommand(action.command) || ""; } catch (e) { /* none */ }
        if (hotkey) btn.createSpan({ cls: "landing-pad-action-hotkey", text: hotkey });
      }
      btn.addEventListener("click", (evt) => {
        let ok = false;
        try { ok = commands.executeCommandById(action.command, evt) !== false; } catch (e) { ok = false; }
        if (!ok) new Notice(`Landing Pad: couldn't run "${action.label}".`);
      });
    }
  }

  card(parent, title, icon, part) {
    const card = parent.createDiv({ cls: "landing-pad-card" });
    const h = card.createEl("h2");
    const iconEl = h.createSpan({ cls: "landing-pad-icon" });
    setIcon(iconEl, icon);
    h.createSpan({ cls: "landing-pad-card-title", text: title });
    card.headerEl = h;
    if (part) card.addEventListener("contextmenu", (evt) => this.showCardMenu(evt, part));
    return card;
  }

  link(parent, item) {
    const a = parent.createEl("a", { cls: "internal-link", text: item.label, href: item.hover || "#" });
    a.addEventListener("click", (evt) => {
      evt.preventDefault();
      item.onClick();
    });
    if (item.hover) {
      a.addEventListener("mouseover", (evt) => {
        this.app.workspace.trigger("hover-link", {
          event: evt, source: VIEW_TYPE, hoverParent: this, targetEl: a, linktext: item.hover,
        });
      });
    }
    return a;
  }

  section(parent, title, icon, items, emptyText, part) {
    const card = this.card(parent, title, icon, part);
    if (!items.length) {
      card.createDiv({ cls: "landing-pad-empty", text: emptyText });
      return;
    }
    const ol = card.createEl("ol");
    for (const item of items) {
      const li = ol.createEl("li");
      const main = li.createDiv({ cls: "landing-pad-item-main" });
      this.link(main, item);
      if (item.sub) main.createDiv({ cls: "landing-pad-folder", text: item.sub });
      li.createDiv({ cls: "landing-pad-meta", text: item.meta });
    }
  }

  // A windsock next to a landing pad, drawn in SVG. The more you wrote this week compared
  // with your usual week, the stronger the wind: limp, half out, then straight out and flapping.
  // Dead calm (with a bird on the pole) after a few days without writing; a pennant for a
  // 100-note milestone.
  renderWindsock(parent, g) {
    let tip;
    if (g.milestone && !g.wilted) tip = `Tailwind: you passed ${g.milestone.toLocaleString("en-US")} notes!`;
    else if (g.wilted) tip = `Dead calm. Nothing written in ${g.idleDays} days.`;
    else if (g.stage === 0) tip = "No wind yet. Write a note to get things moving.";
    else {
      const notes = `${g.recent} new ${g.recent === 1 ? "note" : "notes"} this week`;
      const usual = g.usual ? ` (usually ${g.usual})` : "";
      const mood = g.stage === 4 ? "Strong tailwind." : g.stage === 3 ? "Steady breeze."
        : g.stage === 2 ? "Light breeze." : "A quiet week. Barely a breath.";
      tip = `${notes}${usual}. ${mood}`;
    }

    const motion = g.wilted ? "is-calm" : g.stage === 4 ? "is-flapping" : g.stage === 3 ? "is-breezy" : "";
    const wrap = parent.createDiv({ cls: "landing-pad-windsock", attr: { "aria-label": tip } });
    const svg = wrap.createSvg("svg", {
      cls: ["landing-pad-windsock-svg", motion].filter(Boolean), // array: a string with spaces throws for SVG
      attr: { viewBox: "0 0 72 72", width: "72", height: "72", role: "img", "aria-hidden": "true" },
    });

    // Landing pad and pole
    svg.createSvg("ellipse", { cls: "ws-pad", attr: { cx: "30", cy: "66", rx: "24", ry: "4" } });
    svg.createSvg("line", { cls: "ws-pole", attr: { x1: "14", y1: "66", x2: "14", y2: "9" } });
    svg.createSvg("circle", { cls: "ws-pole-top", attr: { cx: "14", cy: "8", r: "2" } });

    // The sock: five stripes along a tapering cone, rotated down by the lack of wind.
    const angle = g.wilted ? 86 : [82, 62, 40, 18, 4][g.stage];
    const sock = svg.createSvg("g", { cls: "ws-sock", attr: { transform: `translate(14 12) rotate(${angle})` } });
    const flap = sock.createSvg("g", { cls: "ws-flap" });
    const length = 44;
    const half = (x) => 6 - 3 * (x / length);
    for (let i = 0; i < 5; i++) {
      const x0 = (i * length) / 5;
      const x1 = ((i + 1) * length) / 5;
      const pts = [[x0, -half(x0)], [x1, -half(x1)], [x1, half(x1)], [x0, half(x0)]]
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      flap.createSvg("polygon", { cls: i % 2 === 0 ? "ws-stripe-a" : "ws-stripe-b", attr: { points: pts } });
    }

    // Dead calm: a bird has settled on the pole.
    if (g.wilted) {
      const bird = svg.createSvg("g", { cls: "ws-bird" });
      bird.createSvg("ellipse", { attr: { cx: "14", cy: "3.4", rx: "3.2", ry: "2" } });
      bird.createSvg("circle", { attr: { cx: "17", cy: "2", r: "1.4" } });
      bird.createSvg("path", { cls: "ws-beak", attr: { d: "M18.3 1.8 L20.2 2.3 L18.3 2.7 Z" } });
    }

    // Milestone: a pennant on the pole.
    if (g.milestone && !g.wilted) {
      svg.createSvg("path", { cls: "ws-pennant", attr: { d: "M14 30 L28 34 L14 38 Z" } });
    }

    wrap.createDiv({ cls: "landing-pad-windsock-caption", text: `${g.recent} this week` });
  }
}


// The first n items of `list` in `compare` order, without sorting the whole list.
// Same result as [...list].sort(compare).slice(0, n), in O(list × n) with small n.
function topN(list, n, compare) {
  const top = [];
  for (const item of list) {
    if (top.length === n && compare(item, top[n - 1]) >= 0) continue;
    let i = top.length;
    while (i > 0 && compare(item, top[i - 1]) < 0) i--;
    top.splice(i, 0, item);
    if (top.length > n) top.pop();
  }
  return top;
}

function renameInReads(reads, from, to) {
  const old = reads[from];
  if (!old) return;
  const cur = reads[to] || { count: 0, last: 0 };
  reads[to] = { count: cur.count + old.count, last: Math.max(cur.last, old.last) };
  delete reads[from];
}

class HomeScreenPlugin extends Plugin {
  async onload() {
    this.deviceId = this.getDeviceId();
    this.writeQueue = Promise.resolve();
    const saved = await this.loadData();
    this.applyData(saved);
    if (!saved) {
      // First install: hide the templates folder, the one folder almost nobody wants in these lists.
      const templates = this.getTemplatesFolder();
      if (templates) this.settings.excludedFolders = templates;
    }
    if (!saved || !saved.readsMigrated) await this.migrateLegacyReads();
    this.pendingTimer = null;

    this.registerView(VIEW_TYPE, (leaf) => new HomeView(leaf, this));
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Landing Pad", defaultMod: false });

    this.addRibbonIcon("plane-landing", "Open Landing Pad", () => this.activateView());
    this.addCommand({ id: "open", name: "Open Landing Pad", callback: () => this.activateView() });
    this.settingTab = new HomeScreenSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.saveReadsDebounced = debounce(() => this.persist(), 2000, true);
    this.refreshDebounced = debounce(() => this.refreshViews(), 1500, true);

    // Read tracking: start a timer on open; count it if the note is still active afterwards.
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));

    // Keep data consistent with the vault.
    // Renames and deletes are applied to every device's counts, since they all live in one file.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (Object.values(this.allReads).some((dev) => dev[oldPath])) {
        renameInReads(this.reads, oldPath, file.path);
        this.persist((all) => { for (const dev of Object.values(all)) renameInReads(dev, oldPath, file.path); });
      }
      this.refreshDebounced();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (Object.values(this.allReads).some((dev) => dev[file.path])) {
        delete this.reads[file.path];
        this.persist((all) => { for (const dev of Object.values(all)) delete dev[file.path]; });
      }
      this.refreshDebounced();
    }));
    this.registerEvent(this.app.vault.on("create", () => this.refreshDebounced()));
    this.registerEvent(this.app.vault.on("modify", () => this.refreshDebounced()));

    this.app.workspace.onLayoutReady(() => {
      // Refresh when bookmarks are added or removed.
      const bm = this.getBookmarksInstance();
      if (bm && typeof bm.on === "function") {
        try { this.registerEvent(bm.on("changed", () => this.refreshDebounced())); } catch (e) { /* not supported */ }
      }
      this.migrateOldTabs();
      // New empty tabs in the main area become Landing Pad.
      this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.replaceIfEmpty(leaf)));
      if (this.settings.openOnStartup) this.activateView();
    });
  }

  onunload() {
    if (this.pendingTimer) window.clearTimeout(this.pendingTimer);
    this.persist();
  }

  // data.json changed on disk, e.g. synced from another device.
  async onExternalSettingsChange() {
    const data = await this.loadData();
    const own = this.reads; // this device's counts in memory are always the newest
    this.applyData(data);
    this.reads = own;
    this.allReads[this.deviceId] = own;
    this.refreshViews();
  }

  onFileOpen(file) {
    if (this.pendingTimer) { window.clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const path = file.path;
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      const active = this.app.workspace.getActiveFile();
      if (!active || active.path !== path) return;
      this.recordRead(path);
    }, this.settings.minReadSeconds * 1000);
  }

  recordRead(path) {
    const r = this.reads[path] || { count: 0, last: 0 };
    r.count += 1;
    r.last = Date.now();
    this.reads[path] = r;
    this.saveReadsDebounced();
    this.refreshDebounced();
  }

  // ---------- storage ----------

  getDeviceId() {
    const key = "home-screen-device-id";
    const scoped = `${this.app.vault.getName()}-${key}`;
    const load = () => {
      try { if (this.app.loadLocalStorage) return this.app.loadLocalStorage(key); } catch (e) { /* fall through */ }
      try { return window.localStorage.getItem(scoped); } catch (e) { return null; }
    };
    const save = (v) => {
      try { if (this.app.saveLocalStorage) { this.app.saveLocalStorage(key, v); return; } } catch (e) { /* fall through */ }
      try { window.localStorage.setItem(scoped, v); } catch (e) { /* this session only */ }
    };
    let id = load();
    if (!id || !/^[a-z0-9]+$/.test(id)) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      save(id);
    }
    return id;
  }

  // Splits data.json into settings and the per-device read counts.
  applyData(data) {
    const d = data || {};
    const settings = {};
    for (const [k, v] of Object.entries(d)) if (!DATA_KEYS.includes(k)) settings[k] = v;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    this.allReads = d.reads && typeof d.reads === "object" ? d.reads : {};
    this.reads = this.allReads[this.deviceId] || {};
    this.allReads[this.deviceId] = this.reads;
  }

  // Writes settings and this device's counts to data.json. Re-reads the file first so that
  // other devices' sections (which may have just synced in) are kept, not overwritten.
  // mutateAll lets renames and deletes touch every device's section. Writes are queued.
  persist(mutateAll) {
    this.writeQueue = this.writeQueue.then(async () => {
      let fresh = {};
      try { fresh = (await this.loadData()) || {}; } catch (e) { /* write what we have */ }
      const all = Object.assign({}, fresh.reads && typeof fresh.reads === "object" ? fresh.reads : {});
      for (const [dev, reads] of Object.entries(this.allReads)) if (!(dev in all)) all[dev] = reads;
      all[this.deviceId] = this.reads;
      if (mutateAll) mutateAll(all);
      this.allReads = all;
      await this.saveData(Object.assign({}, this.settings, { reads: all, readsMigrated: true }));
    }).catch((e) => console.error("Landing Pad: could not save", e));
    return this.writeQueue;
  }

  // One-time move from reads-<device>.json files into data.json. The old files are left in
  // place, so nothing is lost if something goes wrong; they're ignored afterwards.
  async migrateLegacyReads() {
    try {
      const list = await this.app.vault.adapter.list(this.manifest.dir);
      for (const f of list.files) {
        const m = f.split("/").pop().match(LEGACY_READS_FILE_RE);
        if (!m) continue;
        try {
          const legacy = JSON.parse(await this.app.vault.adapter.read(f)).reads || {};
          const target = this.allReads[m[1]] || (this.allReads[m[1]] = {});
          for (const [path, r] of Object.entries(legacy)) {
            const cur = target[path];
            if (!cur || (r.count || 0) > (cur.count || 0)) target[path] = { count: r.count || 0, last: r.last || 0 };
          }
        } catch (e) { /* skip a broken file */ }
      }
      this.reads = this.allReads[this.deviceId] || {};
      this.allReads[this.deviceId] = this.reads;
    } catch (e) { /* no legacy files */ }
    await this.persist();
  }

  // Read counts of all devices added together.
  aggregateReads() {
    const agg = {};
    for (const reads of Object.values(this.allReads)) {
      for (const [path, r] of Object.entries(reads || {})) {
        const a = agg[path] || (agg[path] = { count: 0, last: 0 });
        a.count += r.count || 0;
        a.last = Math.max(a.last, r.last || 0);
      }
    }
    return agg;
  }

  // ---------- bookmarks ----------

  getBookmarksInstance() {
    try { return this.app.internalPlugins.getEnabledPluginById("bookmarks"); } catch (e) { return null; }
  }

  // True only when we can tell for sure that the core Bookmarks plugin is turned off.
  isBookmarksPluginOff() {
    try {
      const plugin = this.app.internalPlugins.getPluginById("bookmarks");
      return Boolean(plugin) && plugin.enabled === false;
    } catch (e) {
      return false;
    }
  }

  // All bookmarks (groups flattened, group name kept), newest first; null when the core
  // Bookmarks plugin is off (the card is then hidden). If the internal API changed, fall back
  // to reading bookmarks.json directly.
  async getBookmarks() {
    if (this.isBookmarksPluginOff()) return null;
    let items = null;
    const bm = this.getBookmarksInstance();
    if (bm && Array.isArray(bm.items)) items = bm.items;
    if (!items) {
      try {
        items = JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/bookmarks.json`)).items;
      } catch (e) { items = []; }
    }
    const flat = [];
    const walk = (list, group) => {
      for (const it of list || []) {
        if (it.type === "group") walk(it.items, [group, it.title].filter(Boolean).join(" / "));
        else flat.push(Object.assign({}, it, { group }));
      }
    };
    walk(items, "");
    return flat.sort((a, b) => (b.ctime || 0) - (a.ctime || 0));
  }

  // ---------- whimsy ----------

  // One older note that hasn't been edited or read for a while. Same pick all day; the
  // dice button (rerolls) moves to the next pick.
  pickFromVault(files, reads, rerolls, now = new Date()) {
    const cutoff = now.getTime() - FORGOTTEN_AFTER_DAYS * DAY;
    const old = files.filter((f) => f.stat.ctime < cutoff);
    const forgotten = old.filter((f) => Math.max(f.stat.mtime, (reads[f.path] || {}).last || 0) < cutoff);
    const pool = (forgotten.length ? forgotten : old).sort((a, b) => (a.path < b.path ? -1 : 1));
    if (!pool.length) return null;
    const rand = seededRandom(`${dateKey(now)}#${rerolls}`);
    return pool[Math.floor(rand() * pool.length)];
  }

  // First ~200 characters of a note as plain text.
  async snippet(file) {
    try {
      let t = await this.app.vault.cachedRead(file);
      t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");      // frontmatter
      // Drop a first heading that just repeats the note's name; the title is shown above.
      const first = t.match(/^\s*#{1,6}\s+(.+?)\s*(?:\r?\n|$)/);
      if (first && first[1].trim().toLowerCase() === file.basename.trim().toLowerCase()) t = t.slice(first[0].length);
      t = t
        .replace(/!\[\[[^\]]*\]\]/g, "")                            // embeds
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")                       // images
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")           // wikilinks -> text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")                    // md links -> text
        .replace(/^\s*#+\s*/gm, "")                                 // headings
        .replace(/^\s*[-*+]\s+\[.\]\s*/gm, "")                      // tasks
        .replace(/^\s*(?:[-*+>]|\d+\.)\s+/gm, "")                   // bullets, quotes, numbers
        .replace(/^\s*\|.*$/gm, "")                                 // tables
        .replace(/[*_`~=]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return t.length > 200 ? t.slice(0, 200).replace(/\s+\S*$/, "") + "…" : t;
    } catch (e) {
      return "";
    }
  }

  // Notes created on today's date in earlier years, most recent year first (max 3).
  anniversaries(files, now = new Date()) {
    const out = [];
    for (const f of files) {
      const c = new Date(f.stat.ctime);
      if (c.getMonth() === now.getMonth() && c.getDate() === now.getDate() && c.getFullYear() < now.getFullYear()) {
        out.push({ file: f, years: now.getFullYear() - c.getFullYear(), ctime: f.stat.ctime });
      }
    }
    return out.sort((a, b) => a.years - b.years || b.ctime - a.ctime).slice(0, 3);
  }

  // Whole vault counts here: writing anywhere stirs the wind.
  // Growth is measured against your own usual pace (median of the previous 12 weeks), so a
  // normal week gives a steady breeze and only an unusually busy week a strong tailwind.
  gardenState(now = Date.now()) {
    const all = this.app.vault.getMarkdownFiles();
    const weeks = new Array(13).fill(0); // weeks[0] = last 7 days, weeks[k] = k weeks before that
    let lastWrite = 0;
    for (const f of all) {
      const k = Math.floor((now - f.stat.ctime) / (7 * DAY));
      if (k >= 0 && k < weeks.length) weeks[k]++;
      if (f.stat.mtime > lastWrite) lastWrite = f.stat.mtime;
    }
    const recent = weeks[0];
    const history = weeks.slice(1).sort((a, b) => a - b);
    const usual = (history[5] + history[6]) / 2; // median of 12 weeks

    let stage;
    if (recent === 0) stage = 0;
    else if (usual >= 3) {
      const ratio = recent / usual;
      stage = ratio < 0.5 ? 1 : ratio < 0.9 ? 2 : ratio < 1.5 ? 3 : 4;
    } else {
      // Not enough history yet: fixed thresholds.
      stage = recent >= 10 ? 4 : recent >= 6 ? 3 : recent >= 3 ? 2 : 1;
    }

    const idleDays = lastWrite ? Math.floor((now - lastWrite) / DAY) : 0;
    const before = all.length - recent;
    const milestone = Math.floor(all.length / 100) > Math.floor(before / 100) ? Math.floor(all.length / 100) * 100 : 0;
    return {
      recent, stage, idleDays, wilted: idleDays >= WILT_AFTER_DAYS, milestone, total: all.length,
      usual: usual >= 3 ? Math.round(usual) : 0,
    };
  }

  // ---------- helpers ----------

  // Folder set in the core Templates plugin, or "" if it's off or has no folder.
  getTemplatesFolder() {
    try {
      const templates = this.app.internalPlugins.getEnabledPluginById("templates");
      const folder = templates && templates.options && templates.options.folder;
      return typeof folder === "string" ? folder.trim().replace(/^\/+|\/+$/g, "") : "";
    } catch (e) {
      return "";
    }
  }

  getExcludedFolders() {
    return this.settings.excludedFolders
      .split(/[\n,]/).map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  }

  getVisibleFiles() {
    const excluded = this.getExcludedFolders();
    return this.app.vault.getMarkdownFiles().filter(
      (f) => !excluded.some((dir) => f.path === dir || f.path.startsWith(dir + "/"))
    );
  }

  // Redraws visible Landing Pad tabs. Hidden ones are skipped: they redraw when their tab
  // becomes active again (see HomeView.onOpen), so typing in a note never redraws them.
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof HomeView)) continue;
      const el = view.containerEl;
      if (el && typeof el.isShown === "function" && !el.isShown()) continue;
      view.render();
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  // fromPage: the change came from the page's menus, so redraw the settings tab if it is open.
  async saveSettings(fromPage = false) {
    await this.persist();
    this.refreshViews();
    const el = this.settingTab && this.settingTab.containerEl;
    if (fromPage && el && typeof el.isShown === "function" && el.isShown()) this.settingTab.display();
  }

  replaceIfEmpty(leaf) {
    if (!this.settings.replaceNewTabs || !leaf || !leaf.view) return;
    try {
      if (leaf.view.getViewType() !== "empty") return;
      if (leaf.getRoot && leaf.getRoot() !== this.app.workspace.rootSplit) return; // not in the sidebars
      leaf.setViewState({ type: VIEW_TYPE, active: true });
    } catch (e) { /* leave the tab as it is */ }
  }

  // Tabs saved before the rename (view type "home-screen-view") become Landing Pad tabs again.
  migrateOldTabs() {
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const state = leaf.getViewState();
        if (state && state.type === "home-screen-view") leaf.setViewState({ type: VIEW_TYPE, active: false });
      });
    } catch (e) { /* nothing to migrate */ }
  }

  // ---------- show / hide parts of the page ----------

  // ---------- card order ----------

  // List cards in the user's order. Unknown ids are dropped, new cards are added at the end.
  getOrderedCards() {
    const saved = (this.settings.cardOrder || []).filter((id) => LIST_CARDS.some((c) => c.id === id));
    const ids = [...new Set(saved), ...LIST_CARDS.map((c) => c.id).filter((id) => !saved.includes(id))];
    return ids.map((id) => LIST_CARDS.find((c) => c.id === id));
  }

  isDefaultOrder() {
    return this.getOrderedCards().every((c, i) => c.id === LIST_CARDS[i].id);
  }

  // Neighbour among the *visible* cards, so a move always changes what you see.
  cardNeighbour(id, delta) {
    const visible = this.getOrderedCards().filter((c) => !this.isCardHidden(c.id)).map((c) => c.id);
    const i = visible.indexOf(id);
    return i < 0 ? null : visible[i + delta] || null;
  }

  canMoveCard(id, delta) {
    return this.cardNeighbour(id, delta) !== null;
  }

  async moveCard(id, delta) {
    const other = this.cardNeighbour(id, delta);
    if (!other) return;
    const order = this.getOrderedCards().map((c) => c.id);
    const a = order.indexOf(id), b = order.indexOf(other);
    [order[a], order[b]] = [order[b], order[a]];
    this.settings.cardOrder = order;
    await this.saveSettings(true);
  }

  async resetCardOrder() {
    this.settings.cardOrder = [];
    await this.saveSettings(true);
  }

  isCardHidden(id) {
    return (this.settings.hiddenCards || []).includes(id);
  }

  isPartShown(part) {
    return part.card ? !this.isCardHidden(part.card) : Boolean(this.settings[part.key]);
  }

  async setPartShown(part, shown) {
    if (part.card) {
      const hidden = new Set(this.settings.hiddenCards || []);
      if (shown) hidden.delete(part.card); else hidden.add(part.card);
      this.settings.hiddenCards = LIST_CARDS.map((c) => c.id).filter((id) => hidden.has(id));
    } else {
      this.settings[part.key] = shown;
    }
    await this.saveSettings(true);
  }

  openSettings() {
    try {
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
    } catch (e) {
      new Notice("Open Settings → Community plugins → Landing Pad to change more.");
    }
  }
}

class HomeScreenSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Open on startup")
      .setDesc("Show Landing Pad when Obsidian starts.")
      .addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => { s.openOnStartup = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Replace new tabs")
      .setDesc("Show Landing Pad in new empty tabs instead of the blank page.")
      .addToggle((t) => t.setValue(s.replaceNewTabs).onChange(async (v) => { s.replaceNewTabs = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Items per list")
      .setDesc("How many notes each list shows.")
      .addSlider((sl) => sl
        .setLimits(3, 30, 1)
        .setValue(Math.min(30, Math.max(3, s.itemCount)))
        .setDynamicTooltip()
        .onChange(async (v) => { s.itemCount = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Seconds before a note counts as read")
      .setDesc("A note only counts as read once it has been open this long, so clicking past it doesn't count.")
      .addSlider((sl) => sl
        .setLimits(0, 60, 1)
        .setValue(Math.min(60, Math.max(0, s.minReadSeconds)))
        .setDynamicTooltip()
        .onChange(async (v) => { s.minReadSeconds = v; await this.plugin.saveSettings(); }));

    const excluded = new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("One folder per line. Notes in these folders are hidden from all lists (reads are still counted).")
      .addTextArea((t) => {
        t.setPlaceholder("Templates\nArchive");
        t.setValue(s.excludedFolders).onChange(async (v) => { s.excludedFolders = v; await this.plugin.saveSettings(); });
        t.inputEl.rows = 4;
      });
    const templates = this.plugin.getTemplatesFolder();
    if (templates && !this.plugin.getExcludedFolders().includes(templates)) {
      excluded.addButton((b) => b
        .setButtonText(`Add "${templates}"`)
        .setTooltip("Your templates folder, from the core Templates plugin")
        .onClick(async () => {
          s.excludedFolders = [s.excludedFolders.trim(), templates].filter(Boolean).join("\n");
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    const descriptions = {
      showGreeting: "A greeting that fits the time of day, plus notes written on this day in earlier years.",
      showGarden: "Shows how much you wrote this week, compared with your usual pace.",
      showQuickActions: "Buttons for new note, new base, new canvas and go to file.",
      showFromVault: "One forgotten older note per day.",
      created: "Notes you created most recently.",
      updated: "Notes you edited most recently.",
      read: "Notes you read most recently.",
      mostRead: "Notes you read most often.",
      bookmarks: "Your newest bookmarks from the core Bookmarks plugin.",
    };
    new Setting(containerEl)
      .setName("On the page")
      .setDesc("You can also change these on the page itself: use the sliders button at the top right, or right-click a card to hide it.")
      .setHeading();
    for (const part of PAGE_PARTS) {
      new Setting(containerEl)
        .setName(part.title)
        .setDesc(part.card === "bookmarks" && this.plugin.isBookmarksPluginOff()
          ? "Hidden while the core Bookmarks plugin is turned off."
          : descriptions[part.key || part.card] || "")
        .addToggle((t) => t.setValue(this.plugin.isPartShown(part)).onChange(async (v) => {
          if (part.card) {
            const hidden = new Set(s.hiddenCards || []);
            if (v) hidden.delete(part.card); else hidden.add(part.card);
            s.hiddenCards = LIST_CARDS.map((c) => c.id).filter((id) => hidden.has(id));
          } else {
            s[part.key] = v;
          }
          await this.plugin.saveSettings();
        }));
    }
  }
}

module.exports = HomeScreenPlugin;

// Exposed for tests only.
module.exports._internals = { greeting, seededRandom, GREETINGS, topN };
