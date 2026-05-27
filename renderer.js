const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const card        = $('#card');
const taskInput   = $('#taskInput');
const listArea    = $('#listArea');
const countLabel  = $('#countLabel');
const dateLabel   = $('#dateLabel');
const listNameEl  = $('#listName');
const pinBtn          = $('#pinBtn');
const rollBtn         = $('#rollBtn');
const burgerBtn       = $('#burgerBtn');
const toggleTheme     = $('#toggleTheme');
const toggleShowDone  = $('#toggleShowCompleted');
const listsMenu   = $('#listsMenu');
const listsMenuItems = $('#listsMenuItems');
const lmInputWrap = $('#lmInputWrap');
const lmInput     = $('#lmInput');

let data = null;           // full data tree
let lmMode = null;         // 'new' | 'rename' | null
let editingId = null;      // task currently being edited inline
let renderedTaskIds = new Set();  // ids that were on screen at last render; used to suppress entry animation on re-render
let menuExpandedWindow = false;  // window was grown to fit dropdown while rolled

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// === DATE ===
function refreshDate() {
  const d = new Date();
  dateLabel.textContent = d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  });
}
refreshDate();
setInterval(refreshDate, 60_000);

// === LOAD + MIGRATE ===
function migrate(raw) {
  const fresh = {
    lists: [{ id: 'default', name: 'Main', tasks: [] }],
    activeListId: 'default',
    ui: { rolledUp: false, pinned: true, theme: 'dark', showCompleted: true, collapsedGroups: {} },
  };
  if (!raw) return fresh;
  if (Array.isArray(raw)) {
    fresh.lists[0].tasks = raw;
    return fresh;
  }
  if (raw.lists) {
    return {
      lists: raw.lists.length ? raw.lists : fresh.lists,
      activeListId: raw.activeListId || raw.lists[0]?.id || 'default',
      ui: {
        rolledUp: !!raw.ui?.rolledUp,
        pinned: raw.ui?.pinned !== false,
        theme: raw.ui?.theme === 'light' ? 'light' : 'dark',
        showCompleted: raw.ui?.showCompleted !== false,
        collapsedGroups: raw.ui?.collapsedGroups || {},
      },
    };
  }
  // {tasks:[...], ui:{...}} old format
  fresh.lists[0].tasks = raw.tasks || [];
  fresh.ui = {
    rolledUp: !!raw.ui?.rolledUp,
    pinned: raw.ui?.pinned !== false,
    theme: raw.ui?.theme === 'light' ? 'light' : 'dark',
    showCompleted: raw.ui?.showCompleted !== false,
    collapsedGroups: { default: raw.ui?.collapsedGroups || ['done'] },
  };
  return fresh;
}

async function load() {
  const raw = await window.todo.load();
  data = migrate(raw);
  // Ensure each list has collapsedGroups initialized
  for (const l of data.lists) {
    if (!data.ui.collapsedGroups[l.id]) data.ui.collapsedGroups[l.id] = ['done'];
  }
  applyTheme(data.ui.theme, { animate: false });
  applyPinned(data.ui.pinned);
  applyRolled(data.ui.rolledUp);
  toggleShowDone.classList.toggle('on', data.ui.showCompleted !== false);
  render();
  // Let main know the current theme so the tray menu checkbox is in sync
  window.todo.themeCurrent(data.ui.theme);
}

function save() { window.todo.save(data); }

// === ACTIVE LIST ===
const ALL_LISTS = '__all__';
function isAllLists() { return data.activeListId === ALL_LISTS; }
function activeList() {
  if (isAllLists()) return null;
  return data.lists.find(l => l.id === data.activeListId) || data.lists[0];
}
function activeTasks() {
  if (isAllLists()) return data.lists.flatMap(l => l.tasks);
  return activeList()?.tasks || [];
}
function activeCollapsed() {
  const id = isAllLists() ? ALL_LISTS : activeList()?.id;
  return data.ui.collapsedGroups[id] || [];
}
function setActiveCollapsed(arr) {
  const id = isAllLists() ? ALL_LISTS : activeList()?.id;
  data.ui.collapsedGroups[id] = arr;
}

// === INLINE EDIT ===
function startEdit(textEl, taskId) {
  const t = findTask(taskId);
  if (!t || editingId) return;
  editingId = taskId;

  // Replace tag-rendered HTML with plain text for editing
  textEl.textContent = t.text;
  textEl.contentEditable = 'true';
  textEl.spellcheck = true;
  textEl.classList.add('editing');

  let cancelled = false;
  const finish = () => {
    textEl.removeEventListener('blur', finish);
    textEl.removeEventListener('keydown', onKey);
    textEl.contentEditable = 'false';
    textEl.classList.remove('editing');
    editingId = null;

    if (!cancelled) {
      const newText = textEl.textContent.trim();
      if (!newText) {
        // Empty edit = delete
        activeList().tasks = activeList().tasks.filter(x => x.id !== taskId);
      } else if (newText !== t.text) {
        t.text = newText;
      }
      save();
    }
    render();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; finish(); }
    e.stopPropagation();
  };
  textEl.addEventListener('blur', finish, { once: true });
  textEl.addEventListener('keydown', onKey);
}

// === PARSING ===
function parseInput(raw) {
  let text = raw.trim();
  let important = false;
  if (text.startsWith('!')) { important = true; text = text.replace(/^!+\s*/, ''); }
  return { text: text.trim(), important };
}

const escapeHTML = (s) => s.replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Scan the raw text for #tags first (so the regex sees real chars, not
// HTML-entity bytes like &#39;), then escape each segment safely.
function renderText(text) {
  const re = /(#[\w-]+)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHTML(text.slice(last, m.index));
    out += `<span class="tag">${escapeHTML(m[0])}</span>`;
    last = re.lastIndex;
  }
  out += escapeHTML(text.slice(last));
  return out;
}

// === GROUPING ===
function buildGroups() {
  const showDone = data.ui.showCompleted !== false;

  if (isAllLists()) {
    // Each list becomes its own group; done items pooled at the bottom
    const groups = [];
    const allDone = [];
    for (const list of data.lists) {
      const active = list.tasks.filter(t => !t.done);
      allDone.push(...list.tasks.filter(t => t.done));
      if (active.length) groups.push({ name: list.name, items: active });
    }
    if (showDone && allDone.length) {
      groups.push({ name: 'done', items: allDone, isDone: true });
    }
    return groups;
  }

  // Single list: active flat, done collapsible
  const tasks = activeTasks();
  const active = tasks.filter(t => !t.done);
  const done   = tasks.filter(t =>  t.done);
  const groups = [];
  if (active.length) groups.push({ name: '_active', items: active, flat: true });
  if (showDone && done.length) groups.push({ name: 'done', items: done, isDone: true });
  return groups;
}

function visibleTasks() {
  const collapsed = activeCollapsed();
  const out = [];
  for (const g of buildGroups()) {
    if (g.isDone && collapsed.includes(g.name)) continue;
    for (const t of g.items) out.push(t);
  }
  return out;
}

// === RENDER ===
function render() {
  if (isAllLists()) {
    listNameEl.textContent = 'All Lists';
    taskInput.disabled = true;
    taskInput.placeholder = 'Choose a list to add tasks';
  } else {
    const al = activeList();
    listNameEl.textContent = al ? al.name : '—';
    taskInput.disabled = false;
    taskInput.placeholder = 'What needs doing?';
  }

  const groups = buildGroups();
  if (groups.length === 0) {
    listArea.innerHTML = `<div class="empty"><strong>A blank page.</strong>What needs doing?</div>`;
  } else {
    listArea.innerHTML = groups.map(groupHTML).join('');
  }

  const tasks = activeTasks();
  const activeN = tasks.filter(t => !t.done).length;
  countLabel.textContent = tasks.length === 0
    ? 'empty'
    : activeN === 0
      ? 'all done'
      : `${activeN} active`;

  // After render, every visible task id is "known" — next render won't re-animate them
  renderedTaskIds = new Set(tasks.map(t => t.id));
}

function groupHTML(g) {
  if (g.flat) {
    return `<ul class="group-list flat">${g.items.map(taskHTML).join('')}</ul>`;
  }
  const collapsed = activeCollapsed().includes(g.name);
  const items = collapsed ? '' : g.items.map(taskHTML).join('');
  const cls = ['group'];
  if (collapsed) cls.push('collapsed');
  if (g.isDone) cls.push('is-done');
  return `<section class="${cls.join(' ')}" data-group="${escapeHTML(g.name)}">
    <header class="group-head" data-action="toggle-group" data-group="${escapeHTML(g.name)}">
      <span class="chev">▾</span>
      <span class="group-name">${escapeHTML(g.name)}</span>
      <span class="group-count">${g.items.length}</span>
    </header>
    <ul class="group-list">${items}</ul>
  </section>`;
}

function taskHTML(t) {
  const cls = ['task'];
  if (t.done) cls.push('done');
  if (t.important) cls.push('important');
  if (renderedTaskIds.has(t.id)) cls.push('no-anim');  // suppress entry shudder on re-render
  return `<li class="${cls.join(' ')}" data-id="${t.id}">
    <div class="check" data-action="toggle" title="Mark complete"><svg width="9" height="9"><use href="#i-check"/></svg></div>
    <div class="text">${renderText(t.text)}</div>
    <button class="flag" data-action="toggle-important" title="Toggle important">
      <svg width="14" height="14"><use href="#${t.important ? 'i-flag-fill' : 'i-flag-outline'}"/></svg>
    </button>
    <button class="del" data-action="delete" title="Delete task">
      <svg width="10" height="10"><use href="#i-x"/></svg>
    </button>
  </li>`;
}

// === ACTIONS ===
function addTask(raw) {
  if (isAllLists()) return;             // input is disabled in All Lists view
  const { text, important } = parseInput(raw);
  if (!text) return;
  activeList().tasks.unshift({
    id: uid(),
    text,
    important,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
  save();
  render();
}

function findTask(id) {
  // Search every list — needed for All Lists mode and safe in any mode
  for (const l of data.lists) {
    const t = l.tasks.find(x => x.id === id);
    if (t) return t;
  }
  return null;
}
function findOwningList(id) {
  for (const l of data.lists) {
    if (l.tasks.some(t => t.id === id)) return l;
  }
  return null;
}

function toggleTask(id) {
  const t = findTask(id);
  if (!t) return;
  const goingDone = !t.done;

  // When marking complete, let the fill + strikethrough animation play
  // on the existing DOM element before we re-render (which moves the
  // task into the Done group).
  if (goingDone) {
    const el = listArea.querySelector(`.task[data-id="${id}"]`);
    if (el && !el.classList.contains('done')) {
      el.classList.add('done');
      el.classList.remove('important');   // strip the coral bar visually
      el.style.pointerEvents = 'none';
      setTimeout(() => {
        t.done = true;
        t.important = false;              // completing a task clears its flag
        t.completedAt = new Date().toISOString();
        save();
        render();
      }, 380);
      return;
    }
  }
  t.done = !t.done;
  if (t.done) t.important = false;        // also handle non-animated path
  t.completedAt = t.done ? new Date().toISOString() : null;
  save();
  render();
}

function toggleImportant(id) {
  const t = findTask(id);
  if (!t) return;
  t.important = !t.important;
  save();
  render();
}

function deleteTask(id) {
  const el = listArea.querySelector(`[data-id="${id}"]`);
  const finalize = () => {
    const owner = findOwningList(id);
    if (owner) owner.tasks = owner.tasks.filter(t => t.id !== id);
    save();
    render();
  };
  if (el) {
    el.classList.add('leaving');
    setTimeout(finalize, 170);
  } else finalize();
}

function toggleGroup(name) {
  let cg = activeCollapsed();
  cg = cg.includes(name) ? cg.filter(g => g !== name) : [...cg, name];
  setActiveCollapsed(cg);
  save();
  render();
}

function applyRolled(r) {
  data.ui.rolledUp = !!r;
  card.classList.toggle('rolled', data.ui.rolledUp);
  document.body.classList.toggle('rolled', data.ui.rolledUp);
  rollBtn.title = data.ui.rolledUp ? 'Roll down' : 'Roll up (Ctrl+R)';
  if (data.ui.rolledUp) {
    // CSS has collapsed list+foot; card now auto-fits header+input only.
    // body padding is 16 each side, so window = card content + 32
    requestAnimationFrame(() => {
      const h = Math.ceil(card.offsetHeight) + 32;
      window.todo.roll(true, h);
    });
  } else {
    window.todo.roll(false);
  }
  save();
}

function applyTheme(t, { animate = true } = {}) {
  const isDark = t === 'dark';
  if (data) data.ui.theme = isDark ? 'dark' : 'light';
  if (animate) {
    document.body.classList.add('theme-transition');
    setTimeout(() => document.body.classList.remove('theme-transition'), 320);
  }
  document.body.classList.toggle('theme-dark', isDark);
  toggleTheme.classList.toggle('on', isDark);
  if (data) {
    window.todo.themeCurrent(data.ui.theme);  // keep tray menu in sync
    save();
  }
}

function applyShowCompleted(show) {
  data.ui.showCompleted = !!show;
  toggleShowDone.classList.toggle('on', !!show);
  save();
  render();
}

function applyPinned(p) {
  data.ui.pinned = !!p;
  pinBtn.classList.toggle('active', data.ui.pinned);
  pinBtn.title = data.ui.pinned ? 'Unpin (let click-away hide)' : 'Pin (stay visible)';
  // Swap SVG between filled and outline
  const useEl = pinBtn.querySelector('use');
  if (useEl) useEl.setAttribute('href', data.ui.pinned ? '#i-pin-fill' : '#i-pin-outline');
  window.todo.pin(data.ui.pinned);
  save();
}

// === LISTS MENU ===
function openListsMenu() {
  renderListsMenu();
  listsMenu.classList.remove('hidden');
  lmInputWrap.classList.add('hidden');
  lmMode = null;
}
function closeListsMenu() {
  listsMenu.classList.add('hidden');
  lmInputWrap.classList.add('hidden');
  lmMode = null;
  if (menuExpandedWindow) {
    menuExpandedWindow = false;
    // Shrink window back to natural rolled height
    if (data.ui.rolledUp) applyRolled(true);
  }
}
function renderListsMenu() {
  const allActive = isAllLists();
  const allCount = data.lists.reduce((s, l) => s + l.tasks.filter(t => !t.done).length, 0);
  const allRow = `<div class="list-row ${allActive ? 'active' : ''}" data-id="${ALL_LISTS}">
    <span class="lr-check">${allActive ? '✓' : ''}</span>
    <span class="lr-name">All Lists</span>
    <span class="lr-count">${allCount}</span>
  </div>
  <div class="lr-divider"></div>`;
  const rows = data.lists.map(l => {
    const active = l.id === data.activeListId;
    const n = l.tasks.filter(t => !t.done).length;
    return `<div class="list-row ${active ? 'active' : ''}" data-id="${l.id}">
      <span class="lr-check">${active ? '✓' : ''}</span>
      <span class="lr-name">${escapeHTML(l.name)}</span>
      <span class="lr-count">${n}</span>
    </div>`;
  }).join('');
  listsMenuItems.innerHTML = allRow + rows;
}
function switchList(id) {
  if (id !== ALL_LISTS && !data.lists.find(l => l.id === id)) return;
  data.activeListId = id;
  save();
  render();
}
function newList(name) {
  name = (name || '').trim();
  if (!name) return;
  const id = uid();
  data.lists.push({ id, name, tasks: [] });
  data.ui.collapsedGroups[id] = ['done'];
  data.activeListId = id;
  save();
  render();
}
function renameList(name) {
  name = (name || '').trim();
  if (!name) return;
  const l = activeList();
  if (l) l.name = name;
  save();
  render();
}
function deleteCurrentList() {
  if (data.lists.length <= 1) return;
  const idx = data.lists.findIndex(l => l.id === data.activeListId);
  if (idx === -1) return;
  if (!confirm(`Delete list "${activeList().name}" and all its tasks?`)) return;
  delete data.ui.collapsedGroups[data.activeListId];
  data.lists.splice(idx, 1);
  data.activeListId = data.lists[Math.max(0, idx - 1)].id;
  save();
  render();
}

function showLmInput(mode, initial = '') {
  lmMode = mode;
  lmInput.value = initial;
  lmInputWrap.classList.remove('hidden');
  lmInput.placeholder = mode === 'new' ? 'New list name' : 'Rename list';
  setTimeout(() => { lmInput.focus(); lmInput.select(); }, 30);
}

function focusInput() {
  taskInput.focus();
}

// === KEYS ===
taskInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'r') {
    applyRolled(!data.ui.rolledUp);
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    if (taskInput.value.trim()) {
      addTask(taskInput.value);
      taskInput.value = '';
    }
    e.preventDefault();
  } else if (e.key === 'Escape') {
    if (taskInput.value) taskInput.value = '';
    else window.todo.hide();
    e.preventDefault();
  }
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement === lmInput) return;
  if (document.activeElement === taskInput) return;
  if (document.activeElement?.isContentEditable) return;  // inline edit owns its keys

  if (e.key === 'Escape') {
    if (!listsMenu.classList.contains('hidden')) closeListsMenu();
    else window.todo.hide();
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'r') {
    applyRolled(!data.ui.rolledUp);
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    const al = activeList();
    if (al) al.tasks = al.tasks.filter(t => !t.done);
    save(); render();
    e.preventDefault();
    return;
  }
});

lmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (lmMode === 'new') newList(lmInput.value);
    else if (lmMode === 'rename') renameList(lmInput.value);
    closeListsMenu();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    closeListsMenu();
    e.preventDefault();
  }
});

// === CLICKS ===
listArea.addEventListener('click', (e) => {
  const groupHead = e.target.closest('[data-action="toggle-group"]');
  if (groupHead) { toggleGroup(groupHead.dataset.group); return; }
  const li = e.target.closest('.task');
  if (!li) return;
  const id = li.dataset.id;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'toggle') toggleTask(id);
  else if (action === 'toggle-important') toggleImportant(id);
  else if (action === 'delete') deleteTask(id);
});

// Mousedown to start edit so the click positions the cursor naturally
listArea.addEventListener('mousedown', (e) => {
  const textEl = e.target.closest('.text');
  if (!textEl) return;
  if (textEl.classList.contains('editing')) return;
  const li = textEl.closest('.task');
  if (!li) return;
  if (e.target.closest('[data-action]')) return;  // check/flag handle themselves
  startEdit(textEl, li.dataset.id);
});

rollBtn.addEventListener('click', () => applyRolled(!data.ui.rolledUp));
pinBtn.addEventListener('click',  () => applyPinned(!data.ui.pinned));

burgerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (listsMenu.classList.contains('hidden')) {
    openListsMenu();
    if (data.ui.rolledUp) {
      // Card stays rolled, but grow the window taller so the dropdown has room
      requestAnimationFrame(() => {
        const cardH = card.offsetHeight;
        const dropH = listsMenu.offsetHeight;
        const winH  = cardH + dropH + 32 + 8;  // 16+16 body padding + small gap
        menuExpandedWindow = true;
        window.todo.roll(true, winH);
      });
    }
  } else {
    closeListsMenu();
  }
});

listsMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const settingRow = e.target.closest('.setting-row');
  if (settingRow) {
    const which = settingRow.dataset.setting;
    if (which === 'theme') {
      applyTheme(data.ui.theme === 'dark' ? 'light' : 'dark');
    } else if (which === 'showCompleted') {
      applyShowCompleted(!(data.ui.showCompleted !== false));
    }
    return;
  }
  const row = e.target.closest('.list-row');
  if (row) {
    switchList(row.dataset.id);
    closeListsMenu();
    return;
  }
  const act = e.target.closest('[data-action]')?.dataset.action;
  if (act === 'new') showLmInput('new');
  else if (act === 'rename') {
    if (isAllLists()) return;             // nothing to rename
    showLmInput('rename', activeList()?.name || '');
  }
  else if (act === 'delete') {
    if (isAllLists()) return;             // nothing to delete
    closeListsMenu();
    deleteCurrentList();
  }
});

document.addEventListener('click', () => {
  if (!listsMenu.classList.contains('hidden')) closeListsMenu();
});

dateLabel.addEventListener('dblclick', () => applyRolled(!data.ui.rolledUp));

window.todo.onFocusInput(() => focusInput());
window.todo.onPinnedChanged((p) => applyPinned(p));
window.todo.onThemeSet((t) => applyTheme(t));

// === INIT ===
load().then(() => focusInput());
