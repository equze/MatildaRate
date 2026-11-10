(() => {
  'use strict';

  const STORAGE_KEY = 'matildarate.workspace.v3';
  const fallbackCatalog = {
    categories: [{
      id: 'fruits',
      name: 'Фрукты',
      emoji: '🍊',
      items: [
        'Яблоко', 'Банан', 'Апельсин', 'Мандарин', 'Груша', 'Персик',
        'Нектарин', 'Абрикос', 'Слива', 'Вишня', 'Черешня', 'Клубника',
        'Малина', 'Ежевика', 'Черника', 'Голубика', 'Клюква', 'Смородина',
        'Крыжовник', 'Виноград', 'Арбуз', 'Дыня', 'Ананас', 'Манго',
        'Папайя', 'Киви', 'Лимон', 'Лайм', 'Грейпфрут', 'Помело', 'Гранат',
        'Инжир', 'Хурма', 'Финик', 'Кокос', 'Авокадо', 'Маракуйя', 'Гуава',
        'Личи', 'Рамбутан', 'Драконий фрукт', 'Маранг', 'Дуриан', 'Джекфрут',
        'Карамбола', 'Кумкват', 'Фейхоа', 'Айва', 'Черимойя', 'Саподилла'
      ]
    }],
    tiers: [
      { id: 'U', name: 'Ultra', color: '#9b4dff', text: '#fff', value: 8 },
      { id: 'S', name: 'Super', color: '#dc4acc', text: '#fff', value: 7 },
      { id: 'A', name: 'Excellent', color: '#e785b6', text: '#321824', value: 6 },
      { id: 'B', name: 'Good', color: '#efad82', text: '#382116', value: 5 },
      { id: 'C', name: 'Middle', color: '#9ba9bd', text: '#202a38', value: 4 },
      { id: 'D', name: 'Below Average', color: '#9cb8a5', text: '#1d3024', value: 3 },
      { id: 'E', name: 'Bad', color: '#a28d78', text: '#2d2118', value: 2 },
      { id: 'F', name: 'Terrible', color: '#211d1b', text: '#fff', value: 1 },
      { id: '?', name: 'Unknown', color: '#626b7a', text: '#fff', value: null }
    ]
  };

  const ui = {
    pool: document.querySelector('#fruitPool'),
    board: document.querySelector('#tierBoard'),
    tierKey: document.querySelector('#tierKey'),
    search: document.querySelector('#searchInput'),
    poolCount: document.querySelector('#poolCount'),
    progressText: document.querySelector('#progressText'),
    progressBar: document.querySelector('#progressBar'),
    completionNumber: document.querySelector('#completionNumber'),
    completionTitle: document.querySelector('#completionTitle'),
    completionHint: document.querySelector('#completionHint'),
    selectionTip: document.querySelector('#selectionTip'),
    undo: document.querySelector('#undoButton'),
    reset: document.querySelector('#resetButton'),
    finish: document.querySelector('#finishButton'),
    modal: document.querySelector('#modalBackdrop'),
    closeModal: document.querySelector('#closeModal'),
    toast: document.querySelector('#toast'),
    saveState: document.querySelector('#saveState'),
    statsGrid: document.querySelector('#statsGrid'),
    listLibrary: document.querySelector('#listLibrary')
  };

  let catalog = fallbackCatalog;
  let category = fallbackCatalog.categories[0];
  let selectedId = null;
  let query = '';
  let draggedId = null;
  let dropBeforeId = null;
  let lastPlacedId = null;
  let undoStack = [];
  let state = loadState();
  let toastTimeout;
  let currentView = 'lists';
  let editorEnteredAt = null;
  let poolOrder = [];

  async function initialize() {
    const session = loadSession();
      currentView = session.view === 'editor' ? 'editor' : (session.view === 'stats' ? 'stats' : 'lists');
    try {
      const response = await fetch('./tierlists.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Catalog unavailable');
      catalog = ensureUnknownTier(await response.json());
      category = catalog.categories[0];
      state = normalizeState(loadState());
      poolOrder = shuffle(category.items.map((_, index) => `${category.id}-${index}`));
    } catch {
      showToast('Используется встроенный каталог. Для редактирования JSON запускай сайт через HTTP-сервер.');
    }

    bindEvents();
    render();
    setView(currentView, false);
    window.setInterval(refreshCatalog, 2000);
  }

  async function refreshCatalog() {
    try {
      const response = await fetch(`./tierlists.json?updated=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json();
      if (JSON.stringify(next) === JSON.stringify(catalog)) return;
      catalog = ensureUnknownTier(next);
      category = catalog.categories.find((entry) => entry.id === category.id) || catalog.categories[0];
      state = normalizeState(readList(category));
      render();
      showToast('Список тир-листов обновлён из JSON.');
    } catch { /* Keep the last valid catalog while the file is being edited. */ }
  }

  function ensureUnknownTier(source) {
    if (!source.tiers.some((tier) => tier.id === '?')) {
      source.tiers.push({ id: '?', name: 'Unknown', color: '#626b7a', text: '#ffffff', value: null });
    }
    return source;
  }

  function blankState() {
    return {
      tiers: Object.fromEntries(catalog.tiers.map((tier) => [tier.id, []])),
      updatedAt: Date.now(),
      completedAt: null,
      firstRatedAt: null,
      lastChangedAt: null,
      timeSpentMs: 0
    };
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || blankState();
    } catch {
      return blankState();
    }
  }

  function normalizeState(candidate) {
    const next = blankState();
    if (!candidate || typeof candidate !== 'object') return next;

    for (const tier of catalog.tiers) {
      const incoming = Array.isArray(candidate.tiers?.[tier.id])
        ? candidate.tiers[tier.id]
        : [];
      next.tiers[tier.id] = incoming.filter((id) => itemById(id));
    }
    next.updatedAt = candidate.updatedAt || Date.now();
    next.completedAt = candidate.completedAt || null;
    next.firstRatedAt = candidate.firstRatedAt || null;
    next.lastChangedAt = candidate.lastChangedAt || null;
    next.timeSpentMs = candidate.timeSpentMs || 0;
    return next;
  }

  function save() {
    accumulateEditorTime();
    state.updatedAt = Date.now();
    localStorage.setItem(`${STORAGE_KEY}.${category.id}`, JSON.stringify(state));
    saveSession();
    ui.saveState.textContent = 'Сохранено локально';
    window.setTimeout(() => {
      ui.saveState.textContent = 'Изменения сохраняются автоматически';
    }, 1200);
  }

  function items() {
    return category.items.map((name, index) => ({ id: `${category.id}-${index}`, name }));
  }

  function itemById(id) {
    return items().find((item) => item.id === id);
  }

  function assignedIds() {
    return new Set(Object.values(state.tiers).flat());
  }

  function rankedCount() {
    return assignedIds().size;
  }

  function render() {
    renderPool();
    renderBoard();
    renderStatus();
    renderStats();
    renderLibrary();
  }

  function renderLibrary() {
    ui.listLibrary.innerHTML = catalog.categories.map((entry) => {
      const saved = readList(entry);
      const assigned = Object.values(saved.tiers).flat().length;
      const isDone = Boolean(saved.completedAt);
      return `
      <article class="library-entry" data-list-id="${escapeHtml(entry.id)}">
        <button class="list-card" data-open-list="${escapeHtml(entry.id)}">
          <span class="list-card-copy"><strong>${escapeHtml(entry.name)}</strong><small>${isDone ? 'Завершено' : `${assigned} / ${entry.items.length} компонентов`}</small></span>
          <span class="list-arrow">${isDone ? 'Изменить' : 'Продолжить'} →</span>
        </button>
        <div class="list-entry-actions" hidden>
          <button class="button button-quiet" data-restart>Заново</button>
          <button class="button button-primary" data-edit>${isDone ? 'Изменить' : 'Продолжить'}</button>
        </div>
      </article>`;
    }).join('');

    ui.listLibrary.querySelectorAll('[data-open-list]').forEach((button) => button.addEventListener('click', () => {
      const entry = catalog.categories.find((item) => item.id === button.dataset.openList);
      const actions = button.parentElement.querySelector('.list-entry-actions');
      ui.listLibrary.querySelectorAll('.list-entry-actions').forEach((node) => { node.hidden = true; });
      const saved = readList(entry);
      actions.hidden = !actions.hidden;
    }));
    ui.listLibrary.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => {
      const card = button.closest('.library-entry');
      const entry = catalog.categories.find((item) => item.id === card.dataset.listId);
      openCategory(entry, readList(entry));
    }));
    ui.listLibrary.querySelectorAll('[data-restart]').forEach((button) => button.addEventListener('click', () => {
      const entry = catalog.categories.find((item) => item.id === button.closest('[data-list-id]').dataset.listId);
      showRestartDialog(entry);
    }));
  }

  function showRestartDialog(entry) {
    const modalContent = ui.modal.querySelector('.modal');
    modalContent.innerHTML = `
      <p class="kicker">RESET TIER LIST</p>
      <h2>Начать заново?</h2>
      <p>Все оценки тир-листа «${escapeHtml(entry.name)}» будут очищены. Накопленное время и дата первого рейтинга сохранятся.</p>
      <div class="finish-actions">
        <button class="button button-quiet" id="cancelRestart">Отмена</button>
        <button class="button button-primary" id="confirmRestart">Заново</button>
      </div>`;
    ui.modal.hidden = false;
    modalContent.querySelector('#cancelRestart').addEventListener('click', () => { ui.modal.hidden = true; });
    modalContent.querySelector('#confirmRestart').addEventListener('click', () => {
      ui.modal.hidden = true;
      const previous = readList(entry);
      const fresh = blankState();
      fresh.timeSpentMs = previous.timeSpentMs || 0;
      fresh.firstRatedAt = previous.firstRatedAt || null;
      fresh.lastChangedAt = previous.lastChangedAt || null;
      openCategory(entry, fresh);
    });
  }

  function readList(entry) {
    try {
      const legacy = entry.id === catalog.categories[0]?.id ? localStorage.getItem(STORAGE_KEY) : null;
      const value = JSON.parse(localStorage.getItem(`${STORAGE_KEY}.${entry.id}`) || legacy || 'null');
      const result = blankState();
      if (value?.tiers) for (const tier of catalog.tiers) result.tiers[tier.id] = (value.tiers[tier.id] || []).filter((id) => Number(id.split('-').at(-1)) < entry.items.length);
      result.completedAt = value?.completedAt || null;
      result.firstRatedAt = value?.firstRatedAt || null;
      result.lastChangedAt = value?.lastChangedAt || null;
      result.timeSpentMs = value?.timeSpentMs || 0;
      return result;
    } catch { return blankState(); }
  }

  function openCategory(entry, nextState) {
    category = entry;
    state = nextState;
    undoStack = [];
    selectedId = null;
    poolOrder = shuffle(entry.items.map((_, index) => `${entry.id}-${index}`));
    save();
    render();
    setView('editor');
  }

  function renderStats() {
    const lists = catalog.categories.map((entry) => {
      const saved = entry.id === category.id ? state : readList(entry);
      const total = Object.values(saved.tiers).flat().length;
      const rated = catalog.tiers.filter((tier) => tier.value !== null).reduce((sum, tier) => sum + saved.tiers[tier.id].length, 0);
      const average = rated ? catalog.tiers.reduce((sum, tier) => sum + saved.tiers[tier.id].length * (tier.value || 0), 0) / rated : null;
      const rows = catalog.tiers.map((tier) => `<div class="stat-tier" style="--tier-color:${tier.color};--tier-text:${tier.text}"><b>${tier.id}</b><span>${tier.name}</span><strong>${saved.tiers[tier.id].length}</strong><i><em style="width:${total ? saved.tiers[tier.id].length / total * 100 : 0}%"></em></i></div>`).join('');
      return { entry, saved, total, average, rows };
    });
    const ranked = lists.reduce((sum, list) => sum + list.total, 0);
    const points = lists.reduce((sum, list) => sum + catalog.tiers.reduce((part, tier) => part + list.saved.tiers[tier.id].length * (tier.value || 0), 0), 0);
    const ratedAll = lists.reduce((sum, list) => sum + catalog.tiers.filter((tier) => tier.value !== null).reduce((n, tier) => n + list.saved.tiers[tier.id].length, 0), 0);
    const averageAll = ratedAll ? (points / ratedAll).toFixed(1) : '—';
    const totalTime = lists.reduce((sum, list) => sum + (list.saved.timeSpentMs || 0), 0);
    const averageTime = lists.length ? totalTime / lists.length : 0;
    const maxTime = Math.max(0, ...lists.map((list) => list.saved.timeSpentMs || 0));
    ui.statsGrid.innerHTML = `
      <div class="stats-section"><h2>Общая статистика</h2><div class="stats-grid">
        <article class="stat-card"><span>Тир-листы</span><strong>${lists.filter((list) => list.saved.completedAt).length} / ${lists.length}<small> · ${lists.length ? Math.round(lists.filter((list) => list.saved.completedAt).length / lists.length * 100) : 0}%</small></strong></article>
        <article class="stat-card"><span>Компоненты распределены</span><strong>${ranked} / ${lists.reduce((sum, list) => sum + list.entry.items.length, 0)}<small> · ${lists.reduce((sum, list) => sum + list.entry.items.length, 0) ? Math.round(ranked / lists.reduce((sum, list) => sum + list.entry.items.length, 0) * 100) : 0}%</small></strong></article>
        <article class="stat-card"><span>Средняя оценка всех списков</span><strong class="stat-average">${averageAll}<small> / 8</small></strong></article>
        <article class="stat-card"><span>Общее время на сайте</span><strong>${formatDuration(totalTime)}</strong></article>
        <article class="stat-card"><span>Время на тир-лист: среднее / максимум</span><strong>${formatDuration(averageTime)} <small>/ ${formatDuration(maxTime)}</small></strong></article>
        <article class="stat-card stat-distribution"><span>Все оценки по шкале</span>${aggregateRows(lists, ranked)}</article>
      </div></div>
      <div class="stats-section"><h2>Статистика по тир-листам</h2>${lists.map(({ entry, saved, total, average, rows }) => `<details class="stat-list-details"><summary><span><strong>${escapeHtml(entry.name)}</strong><small>${total} / ${entry.items.length} оценено</small></span><b class="stat-average">${average === null ? '—' : average.toFixed(1)}</b></summary><div class="stat-list-body"><div class="stat-detail-heading"><div><div class="stat-average-label">Средняя оценка</div><div class="stat-average-large">${average === null ? '—' : average.toFixed(1)} <small>/ 8</small></div></div><button class="download-icon" data-download-list="${escapeHtml(entry.id)}" title="Скачать PNG" aria-label="Скачать PNG">↓</button></div><p>Впервые оценён: ${saved.firstRatedAt ? formatDate(saved.firstRatedAt) : 'Пока не оценён'}</p><p>Последнее изменение: ${saved.lastChangedAt ? formatDate(saved.lastChangedAt) : '—'}</p><p>Время в редакторе: ${formatDuration(saved.timeSpentMs || 0)}</p>${rows}</div></details>`).join('')}</div>`;
    ui.statsGrid.querySelectorAll('[data-download-list]').forEach((button) => button.addEventListener('click', () => {
      const entry = catalog.categories.find((item) => item.id === button.dataset.downloadList);
      exportPNG(entry, entry.id === category.id ? state : readList(entry));
    }));
  }

  function aggregateRows(lists, total) {
    return catalog.tiers.map((tier) => {
      const count = lists.reduce((sum, list) => sum + list.saved.tiers[tier.id].length, 0);
      return `<div class="stat-tier" style="--tier-color:${tier.color};--tier-text:${tier.text}"><b>${tier.id}</b><span>${tier.name}</span><strong>${count}</strong><i><em style="width:${total ? count / total * 100 : 0}%"></em></i></div>`;
    }).join('');
  }

  function formatDuration(milliseconds = 0) {
    const minutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
  }

  function accumulateEditorTime() {
    if (currentView !== 'editor' || editorEnteredAt === null) return;
    state.timeSpentMs = (state.timeSpentMs || 0) + Math.max(0, Date.now() - editorEnteredAt);
    editorEnteredAt = Date.now();
  }

  function averageScore() {
    const ratedTiers = catalog.tiers.filter((tier) => tier.value !== null);
    const count = ratedTiers.reduce((sum, tier) => sum + state.tiers[tier.id].length, 0);
    if (!count) return '—';
    const points = ratedTiers.reduce((sum, tier) => sum + state.tiers[tier.id].length * tier.value, 0);
    return (points / count).toFixed(1);
  }

  function setView(view, remember = true) {
    const wasEditor = currentView === 'editor';
    accumulateEditorTime();
    editorEnteredAt = view === 'editor' ? Date.now() : null;
    document.querySelectorAll('[data-screen]').forEach((screen) => {
      screen.hidden = screen.dataset.screen !== view;
    });
    document.querySelectorAll('.top-nav-button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    if (view === 'stats') renderStats();
    currentView = view;
    if (wasEditor && view !== 'editor') localStorage.setItem(`${STORAGE_KEY}.${category.id}`, JSON.stringify(state));
    if (remember) saveSession();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}.session`)) || {}; }
    catch { return {}; }
  }

  function saveSession() {
    localStorage.setItem(`${STORAGE_KEY}.session`, JSON.stringify({
      view: currentView,
      selectedList: category.id
    }));
  }

  function renderPool() {
    const assigned = assignedIds();
    const visible = items().filter((item) => {
      return !assigned.has(item.id) && item.name.toLowerCase().includes(query.toLowerCase());
    }).sort((a, b) => poolOrder.indexOf(a.id) - poolOrder.indexOf(b.id));

    ui.pool.innerHTML = visible.map((item) => fruitChip(item, false)).join('');
    ui.poolCount.textContent = String(items().length - rankedCount());
    bindChips(ui.pool);
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function renderBoard() {
    ui.board.innerHTML = catalog.tiers.map((tier) => {
      const tierItems = state.tiers[tier.id]
        .map(itemById)
        .filter(Boolean)
        .map((item) => fruitChip(item, true))
        .join('');

      return `
        <article class="tier-row" data-drop-zone="${tier.id}" tabindex="0"
          style="--tier-color:${tier.color};--tier-text:${tier.text}">
          <div class="tier-label" aria-label="Уровень ${tier.id}: ${tier.name}">${tier.id}</div>
          <div class="tier-content">${tierItems}</div>
        </article>`;
    }).join('');

    ui.tierKey.innerHTML = catalog.tiers.map((tier) => `
      <span style="--tier-color:${tier.color};--tier-text:${tier.text}">
        <b>${tier.id}</b>${tier.name}
      </span>`).join('');

    bindChips(ui.board);
    bindDropZones();
  }

  function fruitChip(item, isRanked) {
    const isSelected = selectedId === item.id;
    const hasAnimation = lastPlacedId === item.id ? ' just-placed' : '';
    return `<button class="fruit-chip${isSelected ? ' selected' : ''}${hasAnimation}"
      draggable="true" data-item-id="${item.id}" data-ranked="${isRanked}">
      ${escapeHtml(item.name)}
    </button>`;
  }

  function renderStatus() {
    const count = rankedCount();
    const total = items().length;
    const percent = Math.round((count / total) * 100);
    const left = total - count;
    const complete = count === total;

    const doneLists = catalog.categories.filter((entry) => {
      const saved = entry.id === category.id ? state : readList(entry);
      return Object.values(saved.tiers).flat().length === entry.items.length;
    }).length;
    const listPercent = catalog.categories.length ? Math.round(doneLists / catalog.categories.length * 100) : 0;
    ui.progressText.textContent = `${doneLists} / ${catalog.categories.length}`;
    ui.progressBar.style.width = `${listPercent}%`;
    ui.completionNumber.textContent = String(percent);
    ui.finish.disabled = !complete;
    ui.undo.disabled = undoStack.length === 0;

    if (complete) {
      ui.completionTitle.textContent = 'Всё распределено';
      ui.completionHint.textContent = 'Тир-лист можно завершить';
      ui.finish.textContent = 'Завершить рейтинг';
    } else if (count === 0) {
      ui.completionTitle.textContent = 'Начни расстановку';
      ui.completionHint.textContent = `${total} компонентов ждут оценки`;
      ui.finish.textContent = `Осталось ${left}`;
    } else {
      ui.completionTitle.textContent = 'Продолжай';
      ui.completionHint.textContent = `Осталось распределить: ${left}`;
      ui.finish.textContent = `Осталось ${left}`;
    }

    const selected = itemById(selectedId);
    if (selected) {
      ui.selectionTip.textContent = `Выбрано: ${selected.name}. Теперь нажми на нужный уровень справа.`;
      ui.selectionTip.classList.add('active');
    } else {
      ui.selectionTip.textContent = 'Нажми на компонент, чтобы выбрать его.';
      ui.selectionTip.classList.remove('active');
    }
  }

  function bindChips(scope) {
    scope.querySelectorAll('[data-item-id]').forEach((chip) => {
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = chip.dataset.itemId;
        if (chip.dataset.ranked === 'true') {
          moveItem(id, 'pool');
          return;
        }
        selectedId = selectedId === id ? null : id;
        render();
      });

      chip.addEventListener('dragstart', (event) => {
        draggedId = chip.dataset.itemId;
        dropBeforeId = null;
        chip.classList.add('dragging');
        document.body.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedId);
      });

      chip.addEventListener('dragend', () => {
        draggedId = null;
        dropBeforeId = null;
        chip.classList.remove('dragging');
        document.body.classList.remove('is-dragging');
        document.querySelectorAll('.drop-placeholder').forEach((placeholder) => placeholder.remove());
        document.querySelectorAll('.reorder-target, .reorder-before, .reorder-after').forEach((node) => {
          node.classList.remove('reorder-target', 'reorder-before', 'reorder-after');
        });
      });

      if (chip.dataset.ranked === 'true') {
        chip.addEventListener('dragover', (event) => {
          event.preventDefault();
          const moving = document.querySelector('.fruit-chip.dragging');
          if (!moving || moving === chip) return;
          const rect = chip.getBoundingClientRect();
          const insertAfter = event.clientX > rect.left + rect.width / 2;
          const movingZone = moving.closest('[data-drop-zone]');
          const targetZone = chip.closest('[data-drop-zone]');
          if (movingZone === targetZone) {
            document.querySelectorAll('.reorder-target, .reorder-before, .reorder-after').forEach((node) => {
              node.classList.remove('reorder-target', 'reorder-before', 'reorder-after');
            });
            chip.classList.add('reorder-target');
            chip.classList.toggle('reorder-before', !insertAfter);
            chip.classList.toggle('reorder-after', insertAfter);
            const siblings = [...chip.parentElement.querySelectorAll('.fruit-chip')].filter((node) => node !== moving);
            const targetIndex = siblings.indexOf(chip);
            const nextIndex = targetIndex + (insertAfter ? 1 : 0);
            dropBeforeId = siblings[nextIndex]?.dataset.itemId || null;
          } else {
            document.querySelectorAll('.reorder-target').forEach((node) => node.classList.remove('reorder-target', 'reorder-before', 'reorder-after'));
            placeDropPlaceholder(chip.parentElement, insertAfter ? chip.nextElementSibling : chip, moving);
          }
        });
        chip.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const movingId = event.dataTransfer.getData('text/plain') || draggedId;
          const targetZone = chip.closest('[data-drop-zone]');
          const moving = document.querySelector('.fruit-chip.dragging');
          const sameTier = moving?.closest('[data-drop-zone]') === targetZone;
          const beforeId = dropBeforeId;
          document.querySelectorAll('.drop-placeholder').forEach((placeholder) => placeholder.remove());
          document.querySelectorAll('.reorder-target').forEach((node) => node.classList.remove('reorder-target', 'reorder-before', 'reorder-after'));
          if (movingId) moveItem(movingId, targetZone.dataset.dropZone, beforeId, true);
        });
      }
    });
  }

  function placeDropPlaceholder(container, reference, draggedChip) {
    const existing = document.querySelector('.drop-placeholder');
    const placeholder = existing || document.createElement('span');
    placeholder.className = 'drop-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const bounds = draggedChip.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    let markerX = 4;
    let markerY = 10;
    if (reference?.classList.contains('fruit-chip')) {
      const rect = reference.getBoundingClientRect();
      markerX = rect.left - containerRect.left - 5;
      markerY = rect.top - containerRect.top - 2;
      dropBeforeId = reference.dataset.itemId;
    } else {
      const chips = container.querySelectorAll('.fruit-chip');
      const last = chips[chips.length - 1];
      if (last) {
        const rect = last.getBoundingClientRect();
        markerX = rect.right - containerRect.left + 2;
        markerY = rect.top - containerRect.top - 2;
      }
      dropBeforeId = null;
    }
    placeholder.style.left = `${markerX}px`;
    placeholder.style.top = `${markerY}px`;
    placeholder.style.height = `${Math.max(bounds.height, 28)}px`;
    if (placeholder.parentElement !== container) container.append(placeholder);
  }

  function bindDropZones() {
    document.querySelectorAll('[data-drop-zone]').forEach((zone) => {
      zone.addEventListener('click', () => {
        if (selectedId && zone.dataset.dropZone !== 'pool') {
          moveItem(selectedId, zone.dataset.dropZone);
        }
      });

      zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && selectedId && zone.dataset.dropZone !== 'pool') {
          moveItem(selectedId, zone.dataset.dropZone);
        }
      });

      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('drop-target');
        const moving = document.querySelector('.fruit-chip.dragging');
        const movingZone = moving?.closest('[data-drop-zone]');
        if (moving && zone.dataset.dropZone !== 'pool' && movingZone !== zone && (event.target === zone || event.target.classList.contains('tier-content'))) {
          placeDropPlaceholder(zone.querySelector('.tier-content'), null, moving);
        }
      });

      zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));

      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('drop-target');
        const id = event.dataTransfer.getData('text/plain') || draggedId;
        const placeholder = document.querySelector('.drop-placeholder');
        const next = placeholder?.nextElementSibling;
        const beforeId = next?.classList.contains('fruit-chip') ? next.dataset.itemId : null;
        placeholder?.remove();
        document.querySelectorAll('.reorder-target').forEach((node) => node.classList.remove('reorder-target', 'reorder-before', 'reorder-after'));
        if (id) moveItem(id, zone.dataset.dropZone, beforeId, Boolean(zone.dataset.dropZone !== 'pool'));
      });
    });
  }

  function moveItem(id, destination, beforeId = null, forceReorder = false) {
    const fromTier = catalog.tiers.find((tier) => state.tiers[tier.id].includes(id));
    if (destination === 'pool' && !fromTier) return;
    if (fromTier?.id === destination && !beforeId && !forceReorder) return;

    remember();
    for (const tier of catalog.tiers) {
      state.tiers[tier.id] = state.tiers[tier.id].filter((itemId) => itemId !== id);
    }
    if (destination !== 'pool') {
      const target = state.tiers[destination];
      const position = beforeId ? target.indexOf(beforeId) : -1;
      target.splice(position < 0 ? target.length : position, 0, id);
    }

    const now = Date.now();
    state.firstRatedAt ||= now;
    state.lastChangedAt = now;

    selectedId = null;
    lastPlacedId = destination === 'pool' ? null : id;
    state.completedAt = null;
    save();
    render();
    window.setTimeout(() => { lastPlacedId = null; }, 420);
  }

  function remember() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 40) undoStack.shift();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    state = normalizeState(JSON.parse(previous));
    selectedId = null;
    lastPlacedId = null;
    save();
    render();
  }

  function reset() {
    if (rankedCount() === 0) return;
    remember();
    const previousTime = state.timeSpentMs || 0;
    const firstRatedAt = state.firstRatedAt;
    state = blankState();
    state.timeSpentMs = previousTime;
    state.firstRatedAt = firstRatedAt;
    state.lastChangedAt = Date.now();
    selectedId = null;
    lastPlacedId = null;
    save();
    render();
    showToast('Все фрукты возвращены в очередь.');
  }

  function finish() {
    if (rankedCount() !== items().length) {
      showToast('Сначала распредели все фрукты.');
      return;
    }
    state.firstRatedAt ||= Date.now();
    state.lastChangedAt = Date.now();
    state.completedAt = Date.now();
    save();
    const modalContent = ui.modal.querySelector('.modal');
    const tierChart = aggregateRows([{ saved: state }], rankedCount());
    modalContent.innerHTML = `
      <p class="kicker">RANKING COMPLETE</p>
      <h2>Отличная работа</h2>
      <p>Рейтинг «${escapeHtml(category.name)}» завершён и сохранён.</p>
      <div class="finish-summary">
        <div><span>Общая оценка</span><strong>${averageScore()} / 8</strong></div>
        <div><span>Время оценки</span><strong>${formatDuration(state.timeSpentMs)}</strong></div>
        <div class="finish-tier-counts"><span>Объекты по уровням</span>${tierChart}</div>
      </div>
      <div class="finish-actions"><button class="button button-quiet" id="downloadPNG">Скачать PNG</button><button class="button button-primary" id="continueToLists">К списку тир-листов</button></div>`;
    modalContent.querySelector('#downloadPNG').addEventListener('click', () => exportPNG(category, state));
    modalContent.querySelector('#continueToLists').addEventListener('click', () => {
      ui.modal.hidden = true;
      setView('lists');
    });
    ui.modal.hidden = false;
  }

  function exportPNG(exportCategory = category, exportState = state) {
    const scale = 3;
    const width = 1440;
    const padding = 72;
    const rowHeight = 96;
    const gap = 12;
    const height = padding * 2 + 100 + catalog.tiers.length * (rowHeight + gap);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.fillStyle = '#080a12';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#e9edff';
    context.font = '700 32px Manrope, sans-serif';
    context.fillText(exportCategory.name, padding, padding + 25);
    context.fillStyle = '#8c94b0';
    context.font = '14px "DM Mono", monospace';
    context.fillText(`MATILDARATE  ·  ${formatDate(Date.now())}`, padding, padding + 55);
    let y = padding + 90;

    for (const tier of catalog.tiers) {
      context.fillStyle = '#101525';
      context.fillRect(padding, y, width - padding * 2, rowHeight);
      context.fillStyle = tier.color;
      context.fillRect(padding, y, 68, rowHeight);
      context.fillStyle = tier.text;
      context.font = '700 27px "DM Mono", monospace';
      context.textAlign = 'center';
      context.fillText(tier.id, padding + 34, y + 56);
      context.textAlign = 'left';
      let x = padding + 88;
      let line = 0;
      for (const id of exportState.tiers[tier.id]) {
        const index = Number(id.split('-').at(-1));
        const item = exportCategory.items[index] ? { name: exportCategory.items[index] } : null;
        if (!item) continue;
        context.font = '13px Manrope, sans-serif';
        const chipWidth = context.measureText(item.name).width + 22;
        if (x + chipWidth > width - padding - 8) { x = padding + 88; line++; }
        const chipY = y + 17 + line * 29;
        context.fillStyle = '#20263a';
        context.fillRect(x, chipY, chipWidth, 23);
        context.fillStyle = '#e9edff';
        context.fillText(item.name, x + 11, chipY + 16);
        x += chipWidth + 7;
      }
      y += rowHeight + gap;
    }

    const link = document.createElement('a');
    link.download = `${exportCategory.id}-tierlist.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function bindEvents() {
    document.querySelectorAll('.top-nav-button').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view));
    });
    ui.search.addEventListener('input', () => {
      query = ui.search.value.trim();
      renderPool();
    });
    ui.undo.addEventListener('click', undo);
    ui.reset.addEventListener('click', reset);
    ui.finish.addEventListener('click', finish);
    ui.closeModal.addEventListener('click', () => {
      ui.modal.hidden = true;
      setView('lists');
    });
    document.querySelector('#clearSelection').addEventListener('click', () => {
      selectedId = null;
      render();
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
      if (event.key === 'Escape') {
        selectedId = null;
        ui.modal.hidden = true;
        render();
      }
    });
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => ui.toast.classList.remove('show'), 3300);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  initialize();
})();
