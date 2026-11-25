const MAX_FILE_BYTES = 100 * 1024 * 1024;
const uuid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const sizeLabel = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const stored = (key, fallback = null) => { try { return JSON.parse(localStorage.getItem('weekflow.lan.' + key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem('weekflow.lan.' + key, JSON.stringify(value)); } catch {} };

export function createLanPanel({ isDemo, icon, esc }) {
  const root = document.createElement('aside');
  root.className = 'lan-panel'; root.hidden = true; root.id = 'lan-panel'; root.setAttribute('aria-label', '消息与屏幕');
  root.innerHTML = `<header class="lan-heading"><button class="icon-btn lan-back" data-lan="back" hidden title="设备列表" aria-label="返回设备列表">${icon('chevron')}</button><div class="lan-heading-label"><h2 id="lan-title">在线设备</h2><small id="lan-self" title="本机"></small></div><span class="lan-connection" role="status" aria-label="未连接" title="未连接"></span><button class="text-btn" data-lan="share" title="向所有在线设备共享屏幕">${icon('screen')}共享</button><button class="icon-btn" data-lan="close" title="关闭" aria-label="关闭消息">${icon('close')}</button></header>
    <div class="lan-shares" aria-label="屏幕共享" hidden></div>
    <section class="lan-stage" hidden aria-label="共享画面"><video autoplay playsinline muted></video><div class="lan-stage-actions"><span id="lan-video-status" role="status"></span><button class="icon-btn" data-lan="retry" title="重连" aria-label="重新连接画面">${icon('refresh')}</button><button class="icon-btn" data-lan="fullscreen" title="全屏" aria-label="全屏观看">${icon('expand')}</button><button class="icon-btn" data-lan="leave" title="退出观看" aria-label="退出观看">${icon('close')}</button></div></section>
    <div class="lan-peers" aria-label="设备列表"></div>
    <div class="lan-room" hidden><div class="lan-history"><button class="icon-btn" data-lan="older" hidden title="更早消息" aria-label="更早消息">${icon('more')}</button><div class="lan-messages" role="log" aria-label="双人消息" aria-live="polite" aria-relevant="additions"></div></div>
    <div class="lan-upload" hidden><span></span><progress max="100" value="0" aria-label="上传进度"></progress><button class="icon-btn" data-lan="cancel-upload" title="取消上传" aria-label="取消上传">${icon('close')}</button></div>
    <form class="lan-compose"><input id="lan-files" type="file" multiple hidden><button class="icon-btn" type="button" data-lan="attach" title="发送给当前设备" aria-label="发送附件">${icon('file')}</button><textarea rows="1" maxlength="4000" placeholder="消息" aria-label="消息内容"></textarea><button class="icon-btn lan-send" type="submit" title="发送 · Enter" aria-label="发送">${icon('send')}</button></form></div><div class="lan-error" role="alert" hidden></div>`;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);
  const history = $('.lan-history'), list = $('.lan-messages'), input = $('.lan-compose textarea'), video = $('video');
  let session = null, source = null, connected = false, connecting = false, connectionVersion = 0, reconnectTimer = null, reconnectDelay = 1500;
  let messages = [], hasMore = false, loadingOlder = false, disposed = false, pendingSend = null, sending = false, upload = null;
  let activeShare = null, localStream = null, watching = false, capturing = false, signalQueue = Promise.resolve();
  let selectedRoom = null, roomVersion = 0, devices = [];
  const rooms = new Map(), drafts = new Map(), unreadRooms = new Set(), availableShares = new Map();
  const peers = new Map(), pendingWatchers = new Map();
  function error(message = '') { $('.lan-error').textContent = message; $('.lan-error').hidden = !message; }
  function syncButton() {
    const button = document.querySelector('[data-action="messages"]');
    if (!button) return;
    const unread = unreadRooms.size > 0;
    button.classList.toggle('has-unread', unread);
    button.classList.toggle('has-share', [...availableShares.values()].some(s => s.deviceId !== session?.deviceId));
    button.setAttribute('aria-expanded', String(!root.hidden));
    button.setAttribute('aria-label', unread ? '消息，有新消息' : '消息与屏幕');
    button.title = unread ? '新消息' : button.classList.contains('has-share') ? '有屏幕共享' : '消息与屏幕';
  }
  function renderDevices() {
    const all = new Map([...rooms.values()].map(room => [room.peer.id, { ...room.peer, online: false }]));
    devices.forEach(device => { if (device.id !== session?.deviceId) all.set(device.id, device); });
    $('.lan-peers').innerHTML = [...all.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label)).map(device => {
      const room = [...rooms.values()].find(r => r.peer.id === device.id);
      return `<button class="lan-device ${unreadRooms.has(room?.id) ? 'unread' : ''}" data-peer="${esc(device.id)}" ${!connected || sending || upload ? 'disabled' : ''}><span class="lan-device-status ${device.online ? 'online' : ''}" title="${device.online ? '在线' : '离线'}"></span><span>${esc(device.ip)}<small>${esc(device.id.slice(0, 6))}${device.online ? '' : ' · 离线'}</small></span>${icon('message')}</button>`;
    }).join('') || `<div class="lan-no-peers">${icon('users')}</div>`;
  }
  function renderShares() {
    $('.lan-shares').hidden = availableShares.size === 0;
    $('.lan-shares').innerHTML = [...availableShares.values()].map(share => {
      const own = share.ownerId === session?.id;
      const viewing = watching && activeShare?.id === share.id;
      return `<div class="lan-sharing"><span>${own ? '公开共享' : esc(share.name)}<small>${own ? `${share.viewers} 人观看` : '公开共享'}</small></span>${own ? `<button class="text-btn lan-stop" data-lan="stop" title="停止所有人的观看">停止</button>` : `<button class="text-btn" data-watch="${esc(share.id)}" ${!connected || localStream || capturing ? 'disabled' : ''}>${viewing ? '退出' : '观看'}</button>`}</div>`;
    }).join('');
  }
  function controls() {
    const status = $('.lan-connection');
    status.classList.toggle('connected', connected); status.title = status.ariaLabel = connected ? '已连接' : '未连接';
    $('.lan-send').disabled = !connected || !selectedRoom || sending || !input.value.trim();
    $('[data-lan="attach"]').disabled = !connected || !selectedRoom || Boolean(upload);
    const ownShare = [...availableShares.values()].some(s => s.deviceId === session?.deviceId);
    $('[data-lan="share"]').disabled = !connected || capturing || watching || ownShare;
    $('[data-lan="back"]').hidden = !selectedRoom;
    $('[data-lan="back"]').disabled = sending || Boolean(upload);
    $('#lan-title').textContent = selectedRoom ? '发给 ' + selectedRoom.peer.label : '在线设备';
    $('#lan-title').title = selectedRoom ? selectedRoom.peer.label : '在线设备';
    $('#lan-self').textContent = session ? '我 · ' + session.label : '';
    $('#lan-self').hidden = Boolean(selectedRoom);
    $('.lan-room').hidden = !selectedRoom; $('.lan-peers').hidden = Boolean(selectedRoom);
    $('[data-lan="older"]').hidden = !hasMore;
    $('[data-lan="older"]').disabled = loadingOlder;
    $('[data-lan="retry"]').hidden = !watching;
    $('[data-lan="leave"]').hidden = !watching;
    video.title = localStream ? '本机共享预览' : activeShare ? '正在观看 ' + activeShare.name : '';
    renderDevices(); renderShares(); syncButton();
  }
  function updateShares(shares) {
    availableShares.clear(); shares.forEach(s => availableShares.set(s.id, s));
    if (activeShare) {
      if (!availableShares.has(activeShare.id)) { releaseMedia(); activeShare = null; }
      else activeShare = availableShares.get(activeShare.id);
    }
    controls();
  }
  const headers = () => ({ 'X-Lan-Session': session.id, Authorization: 'Bearer ' + session.token });
  async function call(path, method = 'GET', data, authentication = true) {
    if (authentication && !session) throw new Error('请重新连接');
    const response = await fetch('/api/lan' + path, { method, headers: { ...(authentication ? headers() : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const failure = new Error(payload.error || '连接失败'); failure.status = response.status; throw failure; }
    return payload;
  }
  function renderMessages() {
    const previous = history.scrollHeight, top = history.scrollTop, bottom = previous - history.clientHeight - top < 70;
    list.innerHTML = messages.map(message => `<article class="lan-message ${message.senderId === session?.deviceId ? 'own' : ''}" data-message="${message.id}" title="${esc(message.senderName)} · ${esc(new Date(message.createdAt).toLocaleString('zh-CN'))}"><div class="lan-bubble">${message.content ? `<p>${esc(message.content)}</p>` : ''}${message.file ? `<button class="lan-file" data-file="${esc(message.file.id)}" title="下载"><span>${icon('file')}</span><span><strong>${esc(message.file.name)}</strong><small>${sizeLabel(message.file.size)}</small></span>${icon('download')}</button>` : ''}</div></article>`).join('');
    if (bottom) history.scrollTop = history.scrollHeight;
    else history.scrollTop = top + Math.max(0, history.scrollHeight - previous) * (loadingOlder ? 1 : 0);
  }
  function merge(incoming) {
    const all = new Map(messages.map(m => [m.id, m]));
    incoming.filter(m => m.roomId === selectedRoom?.id).forEach(m => all.set(m.id, m));
    messages = [...all.values()].sort((a, b) => a.id - b.id); renderMessages();
  }
  async function loadRoom() {
    if (!selectedRoom || !connected) return;
    const id = selectedRoom.id, version = roomVersion, connection = connectionVersion;
    try {
      const data = await call('/messages?room=' + encodeURIComponent(id));
      if (version === roomVersion && connection === connectionVersion && selectedRoom?.id === id) { hasMore = data.hasMore; merge(data.messages); controls(); }
    } catch (e) { if (version === roomVersion) error(e.message); }
  }
  async function selectDevice(id) {
    if (!connected || sending || upload) return;
    try {
      let room = [...rooms.values()].find(r => r.peer.id === id);
      if (!room) { room = await call('/rooms', 'POST', { peerId: id }); rooms.set(room.id, room); }
      if (selectedRoom) drafts.set(selectedRoom.id, input.value);
      selectedRoom = room; roomVersion++; messages = []; hasMore = false; pendingSend = null;
      unreadRooms.delete(room.id); save('room', room.id); input.value = drafts.get(room.id) || ''; renderMessages(); controls(); error();
      await loadRoom(); input.focus();
    } catch (e) { error(e.message); }
  }
  function back() {
    if (sending || upload) return;
    if (selectedRoom) drafts.set(selectedRoom.id, input.value);
    selectedRoom = null; roomVersion++; messages = []; save('room', null); controls();
  }
  function closePeers() {
    for (const peer of peers.values()) { clearTimeout(peer.timer); peer.pc.close(); }
    peers.clear();
  }
  function clearVideo() { video.srcObject = null; $('.lan-stage').hidden = true; $('#lan-video-status').textContent = ''; }
  function releaseMedia() {
    closePeers(); pendingWatchers.clear(); watching = false;
    const stream = localStream; localStream = null;
    stream?.getTracks().forEach(track => track.stop());
    clearVideo();
  }
  function updateShare(next) {
    if (activeShare?.id !== next?.id) releaseMedia();
    activeShare = next;
    controls();
  }
  async function signal(to, type, data) {
    if (!activeShare) return;
    return call('/signal', 'POST', { to, type, data, shareId: activeShare.id });
  }
  function createPeer(id) {
    const previous = peers.get(id);
    if (previous) { clearTimeout(previous.timer); previous.pc.close(); }
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { pc, candidates: [], timer: null };
    peers.set(id, peer);
    pc.onicecandidate = event => { if (event.candidate && peers.get(id) === peer) signal(id, 'ice', event.candidate.toJSON()).catch(e => error(e.message)); };
    pc.ontrack = event => {
      if (peers.get(id) !== peer || !watching) return;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch(() => {}); $('#lan-video-status').textContent = '观看 ' + activeShare.name;
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(id) !== peer) return;
      if (pc.connectionState === 'connected') { clearTimeout(peer.timer); if (watching) $('#lan-video-status').textContent = '观看 ' + activeShare.name; }
      if (['failed', 'disconnected'].includes(pc.connectionState) && watching) $('#lan-video-status').textContent = '连接中断';
    };
    peer.timer = setTimeout(() => {
      if (pc.connectionState !== 'connected' && watching) $('#lan-video-status').textContent = '连接失败，请重连';
    }, 20000);
    return peer;
  }
  async function receiveSignal(message) {
    if (!activeShare || message.shareId !== activeShare.id) return;
    const { from, type, data } = message;
    if (type === 'leave') {
      const peer = peers.get(from); if (peer) { clearTimeout(peer.timer); peer.pc.close(); peers.delete(from); }
      return;
    }
    if (type === 'watch' && !localStream && capturing) { pendingWatchers.set(from, message); return; }
    if (type === 'watch' && localStream) {
      const { pc } = createPeer(from);
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      await pc.setLocalDescription(await pc.createOffer());
      await signal(from, 'offer', pc.localDescription.toJSON());
      return;
    }
    let peer = peers.get(from);
    if (!peer || (from !== activeShare.ownerId && !localStream)) return;
    if (type === 'offer' && watching) {
      await peer.pc.setRemoteDescription(data);
      for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await signal(from, 'answer', peer.pc.localDescription.toJSON());
    } else if (type === 'answer' && localStream) {
      await peer.pc.setRemoteDescription(data);
      for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
    } else if (type === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data);
      else peer.candidates.push(data);
    }
  }
  async function stopShare() {
    const wasSharing = Boolean(localStream), id = activeShare?.id;
    releaseMedia(); activeShare = null; controls();
    if (wasSharing) {
      try { await call('/share?share=' + encodeURIComponent(id), 'DELETE'); } catch (e) { error(e.message); }
    }
  }
  let leavingView = null;
  async function leaveView() {
    if (leavingView) return leavingView;
    const previous = activeShare, wasWatching = watching;
    closePeers(); watching = false; clearVideo(); activeShare = null; controls();
    if (previous && wasWatching) {
      leavingView = call('/signal', 'POST', { to: previous.ownerId, type: 'leave', shareId: previous.id }).catch(() => {}).finally(() => { leavingView = null; });
      await leavingView;
    }
  }
  async function startShare() {
    error();
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) { error('共享屏幕需要受信任的 HTTPS 或 localhost'); return; }
    if (!connected || capturing || localStream || watching) return;
    capturing = true; controls();
    let stream;
    const version = connectionVersion;
    try {
      // Capture must be requested directly in this click handler, before any network await.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (version !== connectionVersion || root.hidden) { stream.getTracks().forEach(t => t.stop()); return; }
      const sharing = await call('/share', 'POST', {});
      if (version !== connectionVersion || root.hidden) { stream.getTracks().forEach(t => t.stop()); await call('/share?share=' + encodeURIComponent(sharing.id), 'DELETE'); return; }
      // The share event may arrive before the HTTP response. Assign the stream afterwards.
      updateShare(sharing); localStream = stream;
      video.srcObject = stream; $('.lan-stage').hidden = false; $('#lan-video-status').textContent = '本机预览'; video.play().catch(() => {});
      for (const message of pendingWatchers.values()) signalQueue = signalQueue.then(() => receiveSignal(message)).catch(e => error(e.message));
      pendingWatchers.clear();
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (localStream === stream) stopShare(); }, { once: true });
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      if (e.name !== 'NotAllowedError') error(e.message || '共享失败');
    } finally { capturing = false; controls(); }
  }
  async function watchShare(id) {
    const target = availableShares.get(id);
    if (!connected || !target || target.ownerId === session?.id || localStream || capturing) return;
    await leaveView(); error(); activeShare = target;
    watching = true; $('.lan-stage').hidden = false; $('#lan-video-status').textContent = '连接中'; controls();
    createPeer(activeShare.ownerId);
    try { await signal(activeShare.ownerId, 'watch'); }
    catch (e) { await leaveView(); error(e.message); }
  }
  async function disconnect() {
    connectionVersion++; clearTimeout(reconnectTimer); reconnectTimer = null; source?.close(); source = null;
    connected = false; upload?.abort(); releaseMedia(); activeShare = null; availableShares.clear(); devices = [];
    const old = session; session = null;
    if (old) fetch('/api/lan/session', { method: 'DELETE', headers: { 'X-Lan-Session': old.id, Authorization: 'Bearer ' + old.token }, keepalive: true }).catch(() => {});
    controls();
  }
  async function connect() {
    if (connecting || disposed || isDemo()) return;
    connecting = true; await disconnect();
    const version = connectionVersion;
    try {
      let credentials = stored('device', {}), created;
      try { created = await call('/sessions', 'POST', credentials, false); }
      catch (e) { if (e.status !== 401) throw e; created = await call('/sessions', 'POST', {}, false); }
      if (version !== connectionVersion || isDemo()) {
        fetch('/api/lan/session', { method: 'DELETE', headers: { 'X-Lan-Session': created.id, Authorization: 'Bearer ' + created.token } }).catch(() => {}); return;
      }
      session = created; save('device', { deviceId: created.deviceId, deviceToken: created.deviceToken });
      source = new EventSource(`/api/lan/events?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.token)}`);
      source.addEventListener('ready', event => {
        if (version !== connectionVersion) return;
        const data = JSON.parse(event.data);
        connected = true; reconnectDelay = 1500; error(); devices = data.clients;
        rooms.clear(); data.rooms.forEach(room => rooms.set(room.id, room));
        const previous = selectedRoom?.id || stored('room');
        selectedRoom = rooms.get(previous) || null;
        updateShares(data.shares); controls(); loadRoom();
      });
      source.addEventListener('presence', event => { if (version === connectionVersion) { devices = JSON.parse(event.data);
        for (const room of rooms.values()) { const current = devices.find(device => device.id === room.peer.id); if (current) room.peer = current; }
        if (selectedRoom) selectedRoom = rooms.get(selectedRoom.id) || selectedRoom;
        controls(); } });
      source.addEventListener('room', event => { if (version === connectionVersion) { const room = JSON.parse(event.data); rooms.set(room.id, room); if (selectedRoom?.id === room.id) selectedRoom = room; controls(); } });
      source.addEventListener('message', event => {
        if (version !== connectionVersion) return;
        const message = JSON.parse(event.data);
        if (message.senderId !== session.deviceId && (root.hidden || message.roomId !== selectedRoom?.id)) unreadRooms.add(message.roomId);
        if (message.roomId === selectedRoom?.id) merge([message]);
        controls();
      });
      source.addEventListener('shares', event => { if (version === connectionVersion) updateShares(JSON.parse(event.data)); });
      source.addEventListener('signal', event => {
        const message = JSON.parse(event.data);
        signalQueue = signalQueue.then(() => { if (version === connectionVersion) return receiveSignal(message); }).catch(e => error(e.message || '共享连接失败'));
      });
      source.onerror = () => {
        if (version !== connectionVersion) return;
        source.close(); connected = false; releaseMedia(); activeShare = null; availableShares.clear(); devices = []; controls(); error('连接中断，正在重连');
        clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      };
    } catch (e) {
      if (version !== connectionVersion) return;
      error(e.message); controls();
      if (![400, 404, 501].includes(e.status)) { reconnectTimer = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); }
    } finally { connecting = false; }
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (!connected || !selectedRoom || sending || !input.value.trim()) return;
    const content = input.value.trim();
    if (!pendingSend || pendingSend.content !== content) pendingSend = { requestId: uuid(), content, roomId: selectedRoom.id };
    sending = true; controls(); error();
    try {
      const message = await call('/messages', 'POST', pendingSend);
      merge([message]); input.value = ''; input.style.height = ''; pendingSend = null; drafts.delete(selectedRoom.id);
      history.scrollTop = history.scrollHeight;
    } catch (e) { error(e.message); }
    finally { sending = false; controls(); input.focus(); }
  }
  async function sendFiles(files) {
    if (!connected || !selectedRoom || upload) return;
    for (const file of files) {
      if (!connected || disposed) break;
      if (file.size > (session?.maxFileBytes || MAX_FILE_BYTES)) { error('文件限 100 MB'); break; }
      error();
      const bar = $('.lan-upload'); bar.hidden = false; $('progress').value = 0; $('.lan-upload span').textContent = file.name;
      try {
        const message = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest(); upload = xhr; xhr.open('POST', '/api/lan/files');
          for (const [key, value] of Object.entries(headers())) xhr.setRequestHeader(key, value);
          xhr.setRequestHeader('X-Lan-Room', selectedRoom.id);
          xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name)); xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.timeout = 10 * 60 * 1000;
          xhr.upload.onprogress = event => { if (event.lengthComputable) $('progress').value = event.loaded / event.total * 100; };
          xhr.onload = () => { let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('上传失败')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || '上传失败')); };
          xhr.onerror = () => reject(new Error('上传失败，请重试')); xhr.ontimeout = () => reject(new Error('上传超时')); xhr.onabort = () => reject(new Error('已取消'));
          xhr.send(file); controls();
        });
        merge([message]); history.scrollTop = history.scrollHeight;
      } catch (e) { error(e.message); break; }
      finally { upload = null; bar.hidden = true; controls(); }
    }
    $('#lan-files').value = '';
  }
  async function downloadFile(id, button) {
    if (!session) return;
    button.disabled = true; error();
    try {
      const response = await fetch('/api/lan/files/' + encodeURIComponent(id), { headers: headers() });
      if (!response.ok) throw new Error((await response.json()).error || '下载失败');
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = messages.find(m => m.file?.id === id)?.file.name || 'download';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { error(e.message); }
    finally { button.disabled = false; }
  }
  async function older() {
    if (!selectedRoom || !hasMore || loadingOlder || !messages.length) return;
    const id = selectedRoom.id, version = roomVersion, before = messages[0].id;
    loadingOlder = true; controls();
    try {
      const data = await call('/messages?room=' + encodeURIComponent(id) + '&before=' + before);
      if (version === roomVersion && selectedRoom?.id === id) { hasMore = data.hasMore; merge(data.messages); }
    } catch (e) { if (version === roomVersion) error(e.message); }
    finally { loadingOlder = false; controls(); }
  }
  async function close() {
    root.hidden = true;
    if (localStream) await stopShare(); else if (watching) await leaveView();
    syncButton(); document.querySelector('[data-action="messages"]')?.focus();
  }
  const actions = {
    close, back, share: startShare, stop: stopShare, leave: leaveView, retry: () => watchShare(activeShare?.id), older,
    attach: () => $('#lan-files').click(), 'cancel-upload': () => upload?.abort(),
    fullscreen: () => $('.lan-stage').requestFullscreen?.().catch(e => error(e.message))
  };
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-lan]');
    if (action) { event.preventDefault(); Promise.resolve(actions[action.dataset.lan]?.()).catch(e => error(e.message)); }
    const peer = event.target.closest('[data-peer]'); if (peer) selectDevice(peer.dataset.peer);
    const watch = event.target.closest('[data-watch]'); if (watch) { if (watching && activeShare?.id === watch.dataset.watch) leaveView(); else watchShare(watch.dataset.watch); }
    const file = event.target.closest('[data-file]'); if (file) downloadFile(file.dataset.file, file);
  });
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; controls(); };
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('.lan-compose').requestSubmit(); } };
  $('.lan-compose').onsubmit = sendMessage;
  $('#lan-files').onchange = event => sendFiles([...event.target.files]);
  root.ondragover = event => { if (selectedRoom && event.dataTransfer.types.includes('Files')) { event.preventDefault(); root.classList.add('file-over'); } };
  root.ondragleave = event => { if (!root.contains(event.relatedTarget)) root.classList.remove('file-over'); };
  root.ondrop = event => { event.preventDefault(); root.classList.remove('file-over'); sendFiles([...event.dataTransfer.files]); };
  root.onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  window.addEventListener('pagehide', disconnect);
  controls();
  return {
    start: connect,
    open() {
      if (isDemo()) return;
      root.hidden = false;
      if (selectedRoom) { unreadRooms.delete(selectedRoom.id); input.focus(); }
      controls(); if (!session && !connecting && !reconnectTimer) connect();
    },
    syncButton,
    reset() { root.hidden = true; selectedRoom = null; roomVersion++; unreadRooms.clear(); rooms.clear(); messages = []; renderMessages(); return disconnect(); },
    dispose() { disposed = true; disconnect(); root.remove(); }
  };
}
