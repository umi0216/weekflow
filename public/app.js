const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  leaf: '<path d="M20 3c0 8-1 14-9 14a7 7 0 0 1-7-7c0-7 8-7 16-7ZM3 21l11-11M8 16v-5m0 5h5"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  todo: '<circle cx="12" cy="12" r="8" stroke-dasharray="2.5 3"/>',
  progress: '<circle cx="12" cy="12" r="8" opacity=".35"/><path d="M12 4a8 8 0 0 1 8 8" stroke-width="3"/><path d="M12 8v4l2.5 1.5"/>',
  review: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  done: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7M6 9h12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M6 8v8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
  empty: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 3h6v4H9zM8 12h8m-8 4h5"/>',
  note: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M9 8h10M9 12h7M9 16h4"/>',
  enter: '<path d="M20 4v9a3 3 0 0 1-3 3H4m4-4-4 4 4 4"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const statuses = [
  { id: 'todo', title: '待办', next: '开始处理' },
  { id: 'progress', title: '进行中', next: '提交检查' },
  { id: 'review', title: '待检查', next: '标记完成' },
  { id: 'done', title: '已完成', next: null }
];
const priorities = { high: '高', normal: '普通', low: '低' };
const colorNames = { sage: '草木绿', blue: '晴空蓝', rose: '樱花粉', amber: '暖杏黄', violet: '丁香紫', slate: '雾灰色' };
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('weekflow.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('weekflow.' + key, JSON.stringify(value)); } catch {} }
};
const state = { members: [], tasks: [], selected: store.get('member', 'all'), query: '', week: 'all', group: store.get('group', true), view: store.get('view', 'board'), collapsed: new Set(), demo: false, loading: true, error: '', pending: new Set(), drawer: false, sidebarCollapsed: store.get('sidebarCollapsed', false) === true };
const sidebarMedia = window.matchMedia('(max-width: 700px)');
let realData = null, clickTimer = null, toastTimer = null, dialogCleanup = null, dialogFocus = null, liveBusy = 0;
const monday = value => { const d = new Date(value); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const weekKey = value => dateKey(monday(value));
const shortDate = value => { const d = new Date(value); return `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; };
const fullDate = value => new Date(value).toLocaleString('zh-CN', { year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false });
function weekInfo(key) {
  const start = new Date(key + 'T12:00:00'), end = new Date(start); end.setDate(end.getDate() + 6);
  const todayKey = weekKey(new Date()), last = monday(new Date()); last.setDate(last.getDate()-7);
  const title = key === todayKey ? '本周' : key === dateKey(last) ? '上周' : `${start.getMonth()+1}.${start.getDate()}`;
  const crossYear = start.getFullYear() !== new Date().getFullYear() || start.getFullYear() !== end.getFullYear();
  const range = `${crossYear ? start.getFullYear()+'.' : ''}${String(start.getMonth()+1).padStart(2,'0')}.${String(start.getDate()).padStart(2,'0')} — ${start.getFullYear() !== end.getFullYear() ? end.getFullYear()+'.' : ''}${String(end.getMonth()+1).padStart(2,'0')}.${String(end.getDate()).padStart(2,'0')}`;
  return { title, range };
}
const currentMember = () => state.members.find(m => m.id === state.selected);
const memberFor = id => state.members.find(m => m.id === id);
const avatar = (m, cls = '') => `<span class="avatar ${esc(m?.color || 'sage')} ${cls}" title="${esc(m?.name || '')}">${esc(Array.from(m?.name || '?')[0])}</span>`;
const memberTasks = () => state.tasks.filter(t => state.selected === 'all' || t.memberId === state.selected);
const visibleTasks = () => memberTasks().filter(t => (!state.query || `${t.title} ${t.description} ${memberFor(t.memberId)?.name || ''}`.toLowerCase().includes(state.query.toLowerCase())) && (state.week === 'all' || weekKey(t.createdAt) === state.week));
async function request(path, method = 'GET', data) {
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  let payload; try { payload = await response.json(); } catch { throw new Error('服务暂时没有响应，请稍后重试'); }
  if (!response.ok) { const err = new Error(payload.error || '操作失败，请重试'); err.status = response.status; throw err; }
  return payload;
}
async function refresh(silent = false) {
  if (state.demo || liveBusy || (silent && $('#overlay-root').children.length)) return;
  try {
    const data = await request('/state');
    const changed = JSON.stringify([state.members, state.tasks]) !== JSON.stringify([data.members, data.tasks]);
    state.members = data.members; state.tasks = data.tasks; state.loading = false; state.error = '';
    if (state.selected !== 'all' && !memberFor(state.selected)) state.selected = 'all';
    if (!silent || changed) render();
  } catch (error) {
    if (!silent) { state.loading = false; state.error = error.message; render(); }
  }
}
function render() {
  const member = currentMember();
  $('#app').innerHTML = `
    <div class="drawer-shade ${state.drawer ? 'open' : ''}" data-action="close-drawer"></div>
    <aside id="team-sidebar" class="sidebar ${state.drawer ? 'open' : ''}" aria-label="团队导航">
      <div class="sidebar-heading"><a class="brand" href="#" data-action="overview"><img src="/favicon.svg" alt="" width="28" height="28"><strong>同频</strong></a><button class="icon-btn sidebar-close" data-action="close-sidebar" title="收起侧栏" aria-label="收起侧栏" aria-controls="team-sidebar">${icon('panel')}</button></div>
      <button class="nav-item ${!member ? 'active' : ''}" data-action="overview" ${!member ? 'aria-current="page"' : ''}>${icon('grid')}<span>全部</span><span class="nav-count">${state.tasks.filter(t=>t.status!=='done').length || ''}</span></button>
      <div class="member-label"><span>成员</span><button class="icon-btn" data-action="add-member" title="添加成员" aria-label="添加成员">${icon('plus')}</button></div>
      <nav class="member-list" aria-label="成员">${state.members.map(m => `<button class="nav-item member-nav ${state.selected===m.id?'active':''}" data-member="${esc(m.id)}" title="${esc([m.name,m.role].filter(Boolean).join(' · '))}" ${state.selected===m.id?'aria-current="page"':''}>${avatar(m)}<span class="member-name">${esc(m.name)}</span><span class="nav-num">${state.tasks.filter(t=>t.memberId===m.id&&t.status!=='done').length || ''}</span></button>`).join('')}</nav>
      <button class="icon-btn sidebar-help" data-action="help" title="快捷键" aria-label="快捷键">${icon('info')}</button>
    </aside>
    <div class="shell">
      <header class="topbar"><div class="breadcrumb"><button class="icon-btn sidebar-toggle" data-action="toggle-sidebar" title="切换侧栏" aria-label="切换侧栏" aria-controls="team-sidebar">${icon('panel')}</button>${member ? avatar(member) : ''}<h1 class="heading-title">${member ? esc(member.name) : '全部任务'}</h1>${member ? `<button class="icon-btn" data-action="edit-member" title="编辑成员" aria-label="编辑成员">${icon('more')}</button>` : ''}</div><div class="topbar-right">${state.members.length ? `<button class="primary-btn" data-action="add-task" title="新建任务 · N">${icon('plus')}新建</button>` : ''}</div></header>
      ${state.demo ? `<div class="demo-banner"><span>示例</span><button data-action="exit-demo" title="退出示例" aria-label="退出示例">${icon('close')}</button></div>` : ''}
      <main class="main" id="main" tabindex="-1">${mainContent()}</main>
    </div>`;
  bindApp();
  syncSidebar();
}
function syncSidebar() {
  const sidebar = $('#team-sidebar');
  if (!sidebar) return;
  const expanded = sidebarMedia.matches ? state.drawer : !state.sidebarCollapsed;
  const hadFocus = sidebar.contains(document.activeElement);
  document.documentElement.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  sidebar.classList.toggle('open', sidebarMedia.matches && state.drawer);
  sidebar.toggleAttribute('inert', !expanded);
  sidebar.setAttribute('aria-hidden', String(!expanded));
  $('.drawer-shade').classList.toggle('open', sidebarMedia.matches && state.drawer);
  const toggle = $('.sidebar-toggle');
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? '收起侧栏' : '展开侧栏');
  toggle.title = expanded ? '收起侧栏' : '展开侧栏';
  if (!expanded && hadFocus) toggle.focus();
}
function mainContent() {
  if (state.loading) return '<div class="boot" role="status" aria-label="加载中"><span class="loading-mark"></span></div>';
  if (state.error) return `<div class="error-panel">${icon('info')}<p>${esc(state.error)}</p><button class="secondary-btn" data-action="retry">重试</button></div>`;
  if (!state.members.length) return welcome();
  return `<div class="workspace-toolbar"><div class="view-tabs" role="group" aria-label="任务视图"><button class="view-tab ${state.view==='board'?'active':''}" aria-pressed="${state.view==='board'}" data-view="board" title="看板" aria-label="看板">${icon('board')}</button><button class="view-tab ${state.view==='list'?'active':''}" aria-pressed="${state.view==='list'}" data-view="list" title="列表" aria-label="列表">${icon('list')}</button></div><div class="toolbar-filters"><label class="search-box">${icon('search')}<input id="task-search" type="search" aria-label="搜索任务" placeholder="搜索" value="${esc(state.query)}" maxlength="120"><kbd aria-hidden="true">/</kbd></label><label class="filter-select"><select id="week-filter" aria-label="筛选创建周">${weekOptions()}</select>${icon('chevron')}</label><button class="group-toggle" id="group-toggle" aria-pressed="${state.group}" title="按周分组" aria-label="按周分组">${icon('calendar')}</button></div></div>
    <div id="board-content">${boardContent()}</div>`;
}
function welcome() {
  return `<section class="welcome"><button class="primary-btn" data-action="add-member">${icon('plus')}添加成员</button><button class="text-btn" data-action="demo">示例</button></section>`;
}
function weekOptions() {
  const weeks = [...new Set(memberTasks().map(t=>weekKey(t.createdAt)))].sort().reverse();
  if (!weeks.includes(weekKey(new Date()))) weeks.unshift(weekKey(new Date()));
  return `<option value="all">全部周</option>${weeks.map(key=>{const w=weekInfo(key);return `<option value="${key}" ${state.week===key?'selected':''}>${w.title}</option>`}).join('')}`;
}
function boardContent() {
  const tasks = visibleTasks();
  if (!tasks.length && (state.query || state.week !== 'all')) return `<div class="filter-empty">${icon('search')}<button class="text-btn" data-action="clear-filters">清除筛选</button></div>`;
  const groups = state.group ? [...new Set(tasks.map(t=>weekKey(t.createdAt)))].sort().reverse().map(key=>({key,tasks:tasks.filter(t=>weekKey(t.createdAt)===key)})) : [{key:'all',tasks}];
  if (!groups.length) groups.push({key:weekKey(new Date()),tasks:[]});
  return groups.map(({key,tasks})=>{
    const info = key==='all'?null:weekInfo(key), collapsed=state.collapsed.has(key);
    return `<section class="week-section" aria-label="${info?info.title:'全部任务'}">${info?`<div class="week-header"><button class="week-collapse" data-collapse="${key}" aria-expanded="${!collapsed}" aria-label="${collapsed?'展开':'收起'}${info.title}">${icon('chevron')}<span class="week-title">${info.title}</span></button><span class="week-range">${info.range}</span><span class="week-line"></span><span class="week-total">${tasks.length}</span></div>`:''}<div ${collapsed?'hidden':''}>${state.view==='board'?kanban(tasks):taskList(tasks)}</div></section>`;
  }).join('');
}
function kanban(tasks) {
  return `<div class="kanban">${statuses.map(s=>{const rows=tasks.filter(t=>t.status===s.id);return `<section class="column ${s.id}" data-status="${s.id}" aria-label="${s.title}"><div class="column-head"><span class="status-symbol">${icon(s.id)}</span><h3 class="column-title">${s.title}</h3><span class="column-count">${rows.length}</span>${s.id==='todo'?`<button class="icon-btn" data-action="add-task" title="新建待办" aria-label="新建待办">${icon('plus')}</button>`:''}</div><div class="task-stack">${rows.map(card).join('')}</div></section>`}).join('')}</div>`;
}
function card(task) {
  const m=memberFor(task.memberId), status=statuses.find(s=>s.id===task.status);
  return `<article class="task-card ${state.pending.has(task.id)?'busy':''}" draggable="true" tabindex="0" data-task="${esc(task.id)}" aria-label="${esc(task.title)}，${status.title}"><div class="task-topline"><h3 class="task-title">${esc(task.title)}</h3>${task.priority!=='normal'?`<span class="priority ${task.priority}" role="img" title="${priorities[task.priority]}优先级" aria-label="${priorities[task.priority]}优先级"></span>`:''}</div><div class="card-footer"><span class="card-metadata"><time class="card-time" datetime="${esc(task.createdAt)}" title="${fullDate(task.createdAt)}">${shortDate(task.createdAt)}</time>${task.description?`<span class="description-mark" title="${esc(task.description)}" aria-label="有描述">${icon('note')}</span>`:''}</span><span class="card-trailing"><button class="icon-btn card-edit" data-edit="${esc(task.id)}" title="编辑" aria-label="编辑${esc(task.title)}">${icon('edit')}</button>${status.next?`<button class="advance-btn" data-advance="${esc(task.id)}" title="${status.next}" aria-label="${status.next}：${esc(task.title)}">${icon(status.id==='todo'?'progress':status.id==='progress'?'review':'check')}</button>`:''}${state.selected==='all'?avatar(m):''}</span></div></article>`;
}
function taskList(tasks) {
  if (!tasks.length) return `<div class="empty-space"><button class="text-btn" data-action="add-task">${icon('plus')}新建任务</button></div>`;
  return `<div class="list-wrapper"><div class="task-list-row list-head"><span>任务</span><span>状态</span><span>成员</span><span>创建</span><span></span></div>${tasks.map(t=>{const m=memberFor(t.memberId),s=statuses.find(s=>s.id===t.status);return `<div class="task-list-row"><div class="list-task-title"><span class="priority ${t.priority}" role="img" aria-label="${priorities[t.priority]}优先级" title="${priorities[t.priority]}优先级"></span><button data-edit="${esc(t.id)}">${esc(t.title)}</button></div><span class="status-pill ${t.status}">${icon(t.status)}${s.title}</span><span title="${esc(m?.name||'')}">${avatar(m)}</span><time class="list-date" datetime="${t.createdAt}" title="${fullDate(t.createdAt)}">${shortDate(t.createdAt)}</time><button class="icon-btn" data-edit="${esc(t.id)}" aria-label="编辑${esc(t.title)}">${icon('more')}</button></div>`}).join('')}</div>`;
}
function selectMember(id) {
  state.selected=id; state.query='';state.week='all';state.drawer=false;state.collapsed.clear();
  if(!state.demo)store.set('member',id); render();
}
function bindApp() {
  $$('[data-action]').forEach(el=>el.onclick=event=>{event.preventDefault();handleAction(el.dataset.action)});
  $$('[data-member]').forEach(el=>el.onclick=()=>selectMember(el.dataset.member));
  $$('[data-view]').forEach(el=>el.onclick=()=>{state.view=el.dataset.view;store.set('view',state.view);render()});
  const search=$('#task-search');if(search)search.oninput=()=>{state.query=search.value.trim();renderBoard()};
  const filter=$('#week-filter');if(filter)filter.onchange=()=>{state.week=filter.value;renderBoard()};
  const toggle=$('#group-toggle');if(toggle)toggle.onclick=()=>{state.group=!state.group;store.set('group',state.group);toggle.setAttribute('aria-pressed',state.group);renderBoard()};
  bindBoard();
}
function renderBoard() { const el=$('#board-content');if(el){el.innerHTML=boardContent();bindBoard()} }
function bindBoard() {
  $$('#board-content [data-action]').forEach(el=>el.onclick=()=>handleAction(el.dataset.action));
  $$('[data-collapse]').forEach(el=>el.onclick=()=>{const key=el.dataset.collapse;if(state.collapsed.has(key))state.collapsed.delete(key);else state.collapsed.add(key);renderBoard()});
  $$('[data-edit]').forEach(el=>el.onclick=e=>{e.stopPropagation();clearTimeout(clickTimer);taskDialog(state.tasks.find(t=>t.id===el.dataset.edit))});
  $$('[data-advance]').forEach(el=>el.onclick=e=>{e.stopPropagation();clearTimeout(clickTimer);advanceTask(el.dataset.advance)});
  $$('.task-card').forEach(el=>{
    el.onclick=e=>{if(e.target.closest('button'))return;clearTimeout(clickTimer);clickTimer=setTimeout(()=>taskDialog(state.tasks.find(t=>t.id===el.dataset.task)),420)};
    el.ondblclick=e=>{if(e.target.closest('button'))return;e.preventDefault();clearTimeout(clickTimer);window.getSelection()?.removeAllRanges();advanceTask(el.dataset.task)};
    el.onkeydown=e=>{if(e.target!==el)return;if(e.key==='Enter'){e.preventDefault();if(e.ctrlKey||e.metaKey)advanceTask(el.dataset.task);else taskDialog(state.tasks.find(t=>t.id===el.dataset.task))}};
    el.ondragstart=e=>{clearTimeout(clickTimer);e.dataTransfer.setData('text/plain',el.dataset.task);e.dataTransfer.effectAllowed='move';el.classList.add('dragging')};
    el.ondragend=()=>{$$('.drag-over').forEach(c=>c.classList.remove('drag-over'));el.classList.remove('dragging')};
  });
  $$('.column').forEach(el=>{
    el.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')};
    el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drag-over')};
    el.ondrop=e=>{e.preventDefault();el.classList.remove('drag-over');const id=e.dataTransfer.getData('text/plain');if(state.tasks.some(t=>t.id===id))moveTask(id,el.dataset.status)};
  });
}
function handleAction(action) {
  if(action==='overview')selectMember('all');
  else if(action==='add-member')memberDialog();
  else if(action==='edit-member')memberDialog(currentMember());
  else if(action==='add-task')taskDialog();
  else if(action==='help')helpDialog();
  else if(action==='retry')refresh();
  else if(action==='demo')startDemo();
  else if(action==='exit-demo')exitDemo();
  else if(action==='clear-filters'){state.query='';state.week='all';render()}
  else if(action==='toggle-sidebar'||action==='close-sidebar'){
    if(sidebarMedia.matches)state.drawer=action==='toggle-sidebar'?!state.drawer:false;
    else{state.sidebarCollapsed=action==='close-sidebar'?true:!state.sidebarCollapsed;store.set('sidebarCollapsed',state.sidebarCollapsed)}
    syncSidebar();
  }
  else if(action==='open-drawer'||action==='close-drawer'){state.drawer=action==='open-drawer';syncSidebar()}
}
function advanceTask(id) {
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  const i=statuses.findIndex(s=>s.id===task.status);
  if(i===3)return;
  moveTask(id,statuses[i+1].id);
}
async function moveTask(id, status) {
  const task=state.tasks.find(t=>t.id===id);if(!task||task.status===status||state.pending.has(id))return;
  const old=task.status;state.pending.add(id);liveBusy++;renderBoard();
  try {
    let updated;
    if(state.demo)updated={...task,status,updatedAt:new Date().toISOString(),completedAt:status==='done'?new Date().toISOString():null,version:task.version+1};
    else updated=await request('/tasks/'+id,'PATCH',{status,version:task.version});
    state.tasks=state.tasks.map(t=>t.id===id?updated:t);state.pending.delete(id);render();
    toast(statuses.find(s=>s.id===status).title,()=>moveTask(id,old));
  } catch(error) {state.pending.delete(id);toast(error.message,null,true);if(error.status===409){liveBusy--;await refresh();liveBusy++}else renderBoard()}
  finally{liveBusy--}
}
function toast(message, undo=null, error=false) {
  clearTimeout(toastTimer);$('#toasts').innerHTML=`<div class="toast ${error?'error':''}" role="status">${icon(error?'info':'check')}<span>${esc(message)}</span>${undo?'<button id="undo-action">撤销</button>':''}</div>`;
  if(undo)$('#undo-action').onclick=()=>{$('#toasts').innerHTML='';undo()};
  toastTimer=setTimeout(()=>{$('#toasts').innerHTML=''},undo?6500:4200);
}
function dialog(content, {wide=false,label='dialog-title',onClose=null}={}) {
  if(dialogCleanup)dialogCleanup();
  dialogFocus=document.activeElement;
  $('#overlay-root').innerHTML=`<div class="dialog-backdrop"><section class="dialog ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="${label}" tabindex="-1">${content}</section></div>`;
  document.body.style.overflow='hidden';
  const key=e=>{
    if(e.key==='Escape'){e.preventDefault();closeDialog()}
    if(e.key==='Tab'){
      const focusables=$$('button:not(:disabled),input,textarea,select,[tabindex="0"]',$('.dialog')).filter(el=>el.offsetParent!==null),first=focusables[0],last=focusables.at(-1);
      if(e.shiftKey&&(document.activeElement===first||!$('.dialog').contains(document.activeElement))){e.preventDefault();last?.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }
  };
  document.addEventListener('keydown',key);
  dialogCleanup=()=>{document.removeEventListener('keydown',key);onClose?.();dialogCleanup=null};
  $$('[data-close]',$('#overlay-root')).forEach(el=>el.onclick=closeDialog);
  requestAnimationFrame(()=>($('.dialog [autofocus]')||$('.dialog'))?.focus());
}
function closeDialog() {
  if($('.dialog [type="submit"]:disabled'))return;
  dialogCleanup?.();$('#overlay-root').innerHTML='';document.body.style.overflow='';
  if(dialogFocus?.isConnected)dialogFocus.focus();
}
const dialogHeading = title => `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-btn" type="button" data-close title="关闭" aria-label="关闭">${icon('close')}</button></div>`;
function formError(form, message) {const el=$('.form-error',form);el.textContent=message;el.hidden=false;el.scrollIntoView({block:'nearest'})}
function memberDialog(member) {
  let color=member?.color||Object.keys(colorNames)[state.members.length%6];
  dialog(`${dialogHeading(member?'编辑成员':'添加成员')}<form id="member-form"><label class="field"><span>姓名</span><input name="name" required maxlength="30" value="${esc(member?.name||'')}" autocomplete="off" autofocus></label><label class="field"><span>角色</span><input name="role" maxlength="40" value="${esc(member?.role||'')}"></label><div class="color-options" role="radiogroup" aria-label="头像颜色">${Object.entries(colorNames).map(([id,name])=>`<button type="button" class="color-option ${id}" role="radio" aria-checked="${id===color}" aria-label="${name}" title="${name}" data-color="${id}">${id===color?icon('check'):''}</button>`).join('')}</div><p class="form-error" role="alert" hidden></p><div class="dialog-footer">${member?`<button type="button" class="danger-btn" id="delete-member" title="删除成员" aria-label="删除成员">${icon('trash')}</button>`:''}<button type="button" class="secondary-btn" data-close>取消</button><button class="primary-btn" type="submit">${member?'保存':'添加'}</button></div></form>`);
  const form=$('#member-form'),name=form.elements.name;
  $$('[data-color]').forEach(el=>{el.onclick=()=>{color=el.dataset.color;$$('[data-color]').forEach(b=>{b.setAttribute('aria-checked',b.dataset.color===color);b.innerHTML=b.dataset.color===color?icon('check'):''})};el.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const options=$$('[data-color]'),i=options.indexOf(el),target=options[(i+(e.key==='ArrowRight'?1:5))%6];target.click();target.focus()}}});
  if(member)$('#delete-member').onclick=()=>deleteMemberDialog(member);
  form.onsubmit=async e=>{
    e.preventDefault();const submit=$('[type=submit]',form);if(submit.disabled)return;submit.disabled=true;submit.textContent='保存中';liveBusy++;
    try{
      const data={name:name.value.trim(),role:form.elements.role.value.trim(),color};if(!data.name)throw new Error('请填写成员姓名');
      let result;
      if(state.demo){if(state.members.some(m=>m.name.toLowerCase()===data.name.toLowerCase()&&m.id!==member?.id))throw new Error('这个成员已存在');result={...data,id:member?.id||crypto.randomUUID(),createdAt:member?.createdAt||new Date().toISOString()}}
      else result=await request('/members'+(member?'/'+member.id:''),member?'PATCH':'POST',data);
      if(member)state.members=state.members.map(m=>m.id===member.id?result:m);else state.members.push(result);
      submit.disabled=false;closeDialog();selectMember(result.id);
    }catch(error){formError(form,error.message);submit.disabled=false;submit.textContent=member?'保存':'添加'}finally{liveBusy--}
  };
}
function taskDialog(task) {
  if(!state.members.length){memberDialog();return}
  const editing=Boolean(task), member=editing?memberFor(task.memberId):currentMember();
  dialog(`${dialogHeading(editing?'任务':'新建任务')}<form id="task-form"><label class="field"><span>标题</span><input name="title" required maxlength="120" value="${esc(task?.title||'')}" autocomplete="off" autofocus></label><label class="field"><span>描述</span><textarea name="description" maxlength="4000">${esc(task?.description||'')}</textarea></label><div class="field-row"><label class="field"><span>成员</span><span class="filter-select"><select name="memberId" ${editing?'disabled':''} aria-label="所属成员">${state.members.map(m=>`<option value="${esc(m.id)}" ${member?.id===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>${icon('chevron')}</span></label><label class="field"><span>优先级</span><span class="filter-select"><select name="priority" aria-label="任务优先级">${Object.entries(priorities).map(([id,title])=>`<option value="${id}" ${(task?.priority||'normal')===id?'selected':''}>${title}</option>`).join('')}</select>${icon('chevron')}</span></label></div>${editing?`<label class="field"><span>状态</span><span class="filter-select"><select name="status" aria-label="当前状态">${statuses.map(s=>`<option value="${s.id}" ${s.id===task.status?'selected':''}>${s.title}</option>`).join('')}</select>${icon('chevron')}</span></label><details class="task-history"><summary title="时间记录" aria-label="时间记录">${icon('clock')}${icon('chevron')}</summary><div class="task-meta"><span>创建 ${fullDate(task.createdAt)}</span><span>更新 ${fullDate(task.updatedAt)}</span>${task.completedAt?`<span>完成 ${fullDate(task.completedAt)}</span>`:''}</div></details>`:''}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${editing?`<button type="button" class="danger-btn" id="delete-task" title="删除任务" aria-label="删除任务">${icon('trash')}</button>`:''}<button type="button" class="secondary-btn" data-close>取消</button><button class="primary-btn" type="submit">${editing?'保存':'创建'}</button></div></form>`,{wide:true});
  const form=$('#task-form');if(editing)$('#delete-task').onclick=()=>deleteTaskDialog(task);
  form.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();form.requestSubmit()}};
  form.onsubmit=async e=>{
    e.preventDefault();const submit=$('[type=submit]',form);if(submit.disabled)return;submit.disabled=true;submit.textContent='保存中';liveBusy++;
    try{
      const data={title:form.elements.title.value.trim(),description:form.elements.description.value.trim(),priority:form.elements.priority.value};if(!data.title)throw new Error('请填写任务标题');
      if(editing){data.status=form.elements.status.value;data.version=task.version}else data.memberId=form.elements.memberId.value;
      let result;
      if(state.demo){const now=new Date().toISOString();result=editing?{...task,...data,updatedAt:now,completedAt:data.status==='done'?(task.completedAt||now):null,version:task.version+1}:{...data,id:crypto.randomUUID(),status:'todo',createdAt:now,updatedAt:now,completedAt:null,version:1}}
      else result=await request('/tasks'+(editing?'/'+task.id:''),editing?'PATCH':'POST',data);
      if(editing)state.tasks=state.tasks.map(t=>t.id===task.id?result:t);else {state.tasks.unshift(result);state.week='all';state.query='';state.collapsed.delete(weekKey(result.createdAt))}
      submit.disabled=false;closeDialog();render();
    }catch(error){formError(form,error.message);submit.disabled=false;submit.textContent=editing?'保存':'创建';if(error.status===409){const fresh=await request('/state').catch(()=>null);if(fresh){state.members=fresh.members;state.tasks=fresh.tasks;const latest=state.tasks.find(t=>t.id===task.id);if(latest){task.version=latest.version;formError(form,'任务已更新。你的输入已保留，请确认后再次保存。')}else{submit.disabled=true;formError(form,'这条任务已被删除，请关闭窗口。')}}}}
    finally{liveBusy--}
  };
}
function confirmDialog(title,message,onConfirm,onCancel) {
  dialog(`${dialogHeading(title)}<p class="confirm-message">${message}</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="secondary-btn" id="cancel-delete">取消</button><button class="primary-btn confirm-danger" type="submit" id="confirm-delete">删除</button></div>`);
  $('#cancel-delete').onclick=()=>onCancel?onCancel():closeDialog();
  $('#confirm-delete').onclick=async()=>{const b=$('#confirm-delete');b.disabled=true;b.textContent='删除中';liveBusy++;try{await onConfirm();b.disabled=false;closeDialog();render()}catch(error){$('.form-error').hidden=false;$('.form-error').textContent=error.message;b.disabled=false;b.textContent='删除'}finally{liveBusy--}};
}
function deleteTaskDialog(task) {
  confirmDialog('删除任务？',`「${esc(task.title)}」`,async()=>{if(!state.demo)await request('/tasks/'+task.id,'DELETE',{version:task.version});state.tasks=state.tasks.filter(t=>t.id!==task.id);toast('已删除')},()=>taskDialog(task));
}
function deleteMemberDialog(member) {
  const count=state.tasks.filter(t=>t.memberId===member.id).length;
  confirmDialog('删除成员？',`${esc(member.name)}${count?` · ${count} 条任务`:''}`,async()=>{if(!state.demo)await request('/members/'+member.id,'DELETE');state.members=state.members.filter(m=>m.id!==member.id);state.tasks=state.tasks.filter(t=>t.memberId!==member.id);state.selected='all';store.set('member','all');toast('已删除')},()=>memberDialog(member));
}
function helpDialog() {
  dialog(`${dialogHeading('快捷键')}<ul class="shortcut-list"><li><span>新建</span><kbd>N</kbd></li><li><span>搜索</span><kbd>/</kbd></li><li><span>编辑</span><kbd>Enter / 单击</kbd></li><li><span>推进</span><kbd>⌘ Ctrl + Enter / 双击</kbd></li><li><span>保存</span><kbd>⌘ Ctrl + Enter</kbd></li><li><span>关闭</span><kbd>Esc</kbd></li></ul>`);
}
function startDemo() {
  realData={members:state.members,tasks:state.tasks,selected:state.selected};state.demo=true;
  const now=new Date();
  const day=(offset,hour=10)=>{const d=new Date(now);d.setDate(d.getDate()+offset);d.setHours(hour,20,0,0);return d.toISOString()};
  state.members=[{id:'demo-lin',name:'林小满',role:'产品设计',color:'sage',createdAt:day(-20)},{id:'demo-zhou',name:'周亦舟',role:'前端开发',color:'blue',createdAt:day(-20)},{id:'demo-chen',name:'陈可',role:'内容运营',color:'rose',createdAt:day(-18)}];
  const seeds=[
    ['梳理新版本的设计方向','把零散的想法收一收，整理成清晰的设计方案。','todo','high',0,'demo-lin'],
    ['整理组件库中的小细节','统一按钮、间距和表单的交互状态。','todo','normal',0,'demo-lin'],
    ['工作台首页视觉设计','试着让信息更有层次，也留出一点呼吸感。','progress','high',0,'demo-lin'],
    ['新成员引导流程','从第一次打开，到顺利开始第一件事。','review','normal',0,'demo-lin'],
    ['完成用户访谈整理','整理了 5 位同事的使用反馈，发现了几个值得改进的地方。','done','normal',0,'demo-lin'],
    ['画完第一版页面线框图','从纸上的小草图，到可以讨论的方案。','done','low',-7,'demo-lin'],
    ['和开发对齐交互细节','把容易遗漏的边界情况也一起说清楚。','review','normal',-7,'demo-lin'],
    ['搭建任务看板基础布局','让不同屏幕上的工作空间都井井有条。','progress','high',0,'demo-zhou'],
    ['优化任务保存体验','每一笔记录，都值得被稳妥保存。','todo','normal',0,'demo-zhou'],
    ['整理本周内容选题','记录有价值的想法，慢慢打磨成好内容。','todo','normal',0,'demo-chen'],
    ['发布团队每周简报','把大家这一周的进展，认真记录下来。','done','normal',0,'demo-chen']
  ];
  state.tasks=seeds.map(([title,description,status,priority,offset,memberId],i)=>({id:'demo-task-'+i,memberId,title,description,status,priority,createdAt:day(offset,9+(i%5)),updatedAt:day(0),completedAt:status==='done'?day(0):null,version:1}));
  state.selected='demo-lin';state.query='';state.week='all';state.collapsed.clear();render();
}
function exitDemo() {if(!realData)return;Object.assign(state,realData);realData=null;state.demo=false;state.query='';state.week='all';state.collapsed.clear();render();refresh(true)}
document.addEventListener('keydown',e=>{
  if($('#overlay-root').children.length||e.ctrlKey||e.metaKey||e.altKey||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
  if(e.key.toLowerCase()==='n'){e.preventDefault();taskDialog()}
  if(e.key==='/'){e.preventDefault();$('#task-search')?.focus()}
  if(e.key==='Escape'&&state.drawer)handleAction('close-drawer');
});
window.addEventListener('focus',()=>refresh(true));
sidebarMedia.addEventListener('change',()=>{state.drawer=false;syncSidebar()});
setInterval(()=>{if(!document.hidden)refresh(true)},20000);
render();refresh();
