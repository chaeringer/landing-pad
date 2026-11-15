// A plausible demo vault: a product designer who reads, cooks, runs and plans trips. No real notes.
(function () {
  const { TFile } = window.obsidianShim;
  const NOW = Date.now(), H = 36e5, D = 864e5;
  const notes = [
    // [path, created (days ago), modified (days ago)]
    ['Projects/Atlas redesign/Kickoff notes.md', 2, 0.04],
    ['Projects/Atlas redesign/User interview – Mara.md', 0.3, 0.3],
    ['Projects/Atlas redesign/Navigation options.md', 1.2, 0.15],
    ['Weekly reviews/2026-W47.md', 0.1, 0.08],
    ['Weekly reviews/2026-W46.md', 7, 6.5],
    ['Reading/Thinking in Systems.md', 3, 0.9],
    ['Reading/The Design of Everyday Things.md', 210, 40],
    ['Reading/Four Thousand Weeks.md', 4.5, 2],
    ['Kitchen/Sourdough starter log.md', 120, 1.1],
    ['Kitchen/Weeknight ramen.md', 5, 5],
    ['Kitchen/Miso-glazed aubergine.md', 1.8, 1.8],
    ['Running/Half marathon plan.md', 60, 0.6],
    ['Running/Long run – river loop.md', 2.4, 2.4],
    ['Travel/Lisbon – where to eat.md', 380, 300],
    ['Travel/Kyoto in spring.md', 3.5, 3.4],
    ['Ideas/A tiny app for plant watering.md', 6, 5.8],
    ['Ideas/Newsletter about slow software.md', 0.6, 0.5],
    ['Ideas/Board game night format.md', 140, 139],
    ['Learning/Spanish – irregular verbs.md', 90, 12],
    ['Learning/Color theory basics.md', 230, 200],
    ['Home/Balcony garden 2027.md', 45, 44],
    ['Home/Desk setup.md', 300, 280],
    ['People/Mara Lindqvist.md', 0.3, 0.3],
    ['People/Jonas Weber.md', 150, 30],
    ['Zettelkasten/Constraints breed creativity.md', 400, 380],
    ['Zettelkasten/Make the next step obvious.md', 160, 158],
    ['Zettelkasten/Habits are votes for who you want to be.md', 520, 500],
    ['Journal/2026-11-16.md', 1, 1],
    ['Journal/2026-11-15.md', 2, 2],
    ['Journal/2026-11-14.md', 3, 3],
    ['Journal/2026-11-12.md', 5, 5],
  ];
  const files = notes.map(([p, c, m]) => new TFile(p, NOW - c * D, NOW - m * D));
  // anniversary: created exactly one year ago today
  files.push(new TFile('Travel/First week in Lisbon.md', new Date(2025, 10, 17, 14).getTime(), NOW - 360 * D));
  // history so the windsock has a "usual" pace (about 6 a week) and this week is busy (about 14)
  for (let w = 1; w <= 12; w++) for (let i = 0; i < 8; i++) files.push(new TFile(`Archive/Week ${w} note ${i}.md`, NOW - (w * 7 + 1 + i * 0.5) * D, NOW - (w * 7) * D));
  ['Podcast idea – tools that last', 'Gift ideas for Sam', 'Article to read later', 'Questions for Jonas'].forEach((t, i) => files.push(new TFile(`Inbox/${t}.md`, NOW - (0.5 + i) * D, NOW - (0.5 + i) * D)));

  const r = (count, hoursAgo) => ({ count, last: NOW - hoursAgo * H });
  const reads = {
    mac: {
      'Projects/Atlas redesign/Kickoff notes.md': r(14, 1), 'Reading/Thinking in Systems.md': r(9, 20),
      'Running/Half marathon plan.md': r(22, 14), 'Kitchen/Sourdough starter log.md': r(31, 26),
      'Projects/Atlas redesign/Navigation options.md': r(6, 3), 'Weekly reviews/2026-W47.md': r(3, 2),
      'Zettelkasten/Make the next step obvious.md': r(11, 200), 'Learning/Spanish – irregular verbs.md': r(17, 300),
    },
    iphone: {
      'Kitchen/Sourdough starter log.md': r(12, 30), 'Kitchen/Weeknight ramen.md': r(8, 50),
      'Running/Half marathon plan.md': r(9, 16), 'Travel/Kyoto in spring.md': r(5, 40),
    },
  };
  const bookmarks = [
    { type: 'file', ctime: NOW - 0.2 * D, path: 'Projects/Atlas redesign/Kickoff notes.md' },
    { type: 'group', title: 'Reading', items: [
      { type: 'file', ctime: NOW - 2 * D, path: 'Reading/Thinking in Systems.md' },
      { type: 'file', ctime: NOW - 9 * D, path: 'Reading/Four Thousand Weeks.md' } ] },
    { type: 'heading', ctime: NOW - 4 * D, path: 'Running/Half marathon plan.md', subpath: '#Week 6' },
    { type: 'search', ctime: NOW - 6 * D, query: 'tag:#recipe', title: 'All recipes' },
    { type: 'url', ctime: NOW - 12 * D, url: 'https://www.are.na/', title: 'Are.na' },
    { type: 'folder', ctime: NOW - 20 * D, path: 'Journal' },
  ];
  const SNIPPETS = {
    'Reading/The Design of Everyday Things.md': '# The Design of Everyday Things\nWhen people fail to use something, it is usually the design that failed, not the person. Good design makes the right action visible: affordances, signifiers and immediate feedback.',
    'Ideas/Board game night format.md': '# Board game night format\nOne short opener everyone knows, one new game with a 10-minute teach, and a fixed end time so nobody is stuck in a three-hour campaign on a school night.',
    'Learning/Color theory basics.md': '# Color theory basics\nStart from value, not hue: a palette works in greyscale first. Then pick one dominant colour, one supporting colour and a small accent.',
    'Home/Balcony garden 2027.md': '# Balcony garden 2027\nTomatoes did well against the south wall, basil bolted in July. Next year: cherry tomatoes, two pots of mint kept apart, and a drip line before the holidays.',
    'Home/Desk setup.md': '# Desk setup\nMonitor arm at eye height, keyboard tray lowered by 3 cm, the lamp to the left. Cables in one tray under the desk so the floor stays clear.',
    'Travel/Lisbon – where to eat.md': '# Lisbon – where to eat\nPastéis in Belém early before the queue, grilled sardines in Alfama, and the tiny tasca near the miradouro with only four tables and no menu.',
    'Zettelkasten/Constraints breed creativity.md': '# Constraints breed creativity\nA blank canvas is paralysing. A fixed size, a limited palette or a deadline turns an open question into a puzzle, and puzzles are fun to solve.',
    'Zettelkasten/Habits are votes for who you want to be.md': '# Habits are votes for who you want to be\nEvery small repetition is evidence about your identity. One run does not make you a runner, but twenty runs make it hard to argue that you are not.',
    'People/Jonas Weber.md': '# Jonas Weber\nMet at the design meetup in March. Works on maps for public transport, loves typography, recommended "Thinking with Type".',
    'Travel/First week in Lisbon.md': '# First week in Lisbon\nThe light here is different. Walked from Graça down to the river every evening; the trams are slower than walking but worth it once.',
  };
  const folders = new Set(files.map((f) => f.parent.path));
  window.app = {
    vault: {
      getName: () => 'Demo', configDir: '.obsidian', getMarkdownFiles: () => files, on: () => ({}),
      getAbstractFileByPath: (p) => files.find((f) => f.path === p) || (folders.has(p) ? { path: p, name: p.split('/').pop() } : null),
      cachedRead: async (f) => SNIPPETS[f.path] || `# ${f.basename}\nNotes and loose thoughts, collected over a few weeks. Worth another look.`,
      adapter: { read: async () => { throw new Error('nf'); }, write: async () => {}, list: async () => ({ files: [], folders: [] }) },
    },
    workspace: { on: () => ({}), onLayoutReady() {}, getLeavesOfType: () => [], trigger() {}, rootSplit: {} },
    internalPlugins: { getEnabledPluginById: (id) => (id === 'bookmarks' ? { items: bookmarks } : null), getPluginById: () => ({ enabled: true }) },
    commands: { commands: { 'file-explorer:new-file': {}, 'bases:new-file': {}, 'canvas:new-file': {}, 'switcher:open': {} },
      findCommand(id) { return this.commands[id]; }, executeCommandById() { return true; } },
    hotkeyManager: { printHotkeyForCommand: (id) => ({ 'file-explorer:new-file': '⌘ N', 'switcher:open': '⌘ O' })[id] || '' },
    loadLocalStorage: () => 'mac', saveLocalStorage() {},
  };
  window.__data = { readsMigrated: true, reads, excludedFolders: 'Archive' };
})();
