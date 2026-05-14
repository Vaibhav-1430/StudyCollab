import { getToken, requireAuth } from './auth.js';
import { apiFetch } from './api.js';
import { API_BASE } from './config.js';
import { qs, showToast, toggleModal, throttle, copyText, formatBytes } from './utils.js';
import { initUI } from './ui.js';
import { Whiteboard } from './whiteboard.js';
import { AnnotationLayer } from './annotation.js';
import { WebRTCManager } from './webrtc.js';
import { ChatManager } from './chat.js';

requireAuth();

const roomTitle = qs('#roomTitle');
const roomCodeBadge = qs('#roomCodeBadge');
const copyCodeBtn = qs('#copyCodeBtn');
const participantsList = qs('#participantsList');
const filesList = qs('#filesList');
const notesList = qs('#notesList');
const notesInput = qs('#notesInput');
const saveNoteBtn = qs('#saveNoteBtn');
const cursorLayer = qs('#cursorLayer');
const boardStage = qs('#boardStage');
const canvas = qs('#boardCanvas');
const screenStage = qs('#screenStage');
const screenVideo = qs('#screenVideo');
const screenCanvas = qs('#screenCanvas');
const screenPlaceholder = qs('#screenPlaceholder');
const presenterBadge = qs('#presenterBadge');
const startShareBtn = qs('#startShareBtn');
const modeToggle = qs('#modeToggle');
const annotateToggleBtn = qs('#annotateToggleBtn');
const whiteboardZoomGroup = qs('#whiteboardZoomGroup');

const saveBoardBtn = qs('#saveBoardBtn');
const uploadFileBtn = qs('#uploadFileBtn');
const leaveRoomBtn = qs('#leaveRoomBtn');
const uploadModal = qs('#uploadModal');
const uploadForm = qs('#uploadForm');
const uploadProgress = qs('#uploadProgress');
const fileDropzone = qs('#fileDropzone');
const fileViewerModal = qs('#fileViewerModal');
const fileViewerImage = qs('#fileViewerImage');
const fileViewerCanvas = qs('#fileViewerCanvas');
const fileViewerTitle = qs('#fileViewerTitle');
const fileDownloadBtn = qs('#fileDownloadBtn');
const viewerColorPicker = qs('#viewerColorPicker');
const viewerStrokeSize = qs('#viewerStrokeSize');
const viewerZoomInBtn = qs('#viewerZoomInBtn');
const viewerZoomOutBtn = qs('#viewerZoomOutBtn');
const viewerFullscreenBtn = qs('#viewerFullscreenBtn');
const viewerUndoBtn = qs('#viewerUndoBtn');
const viewerRedoBtn = qs('#viewerRedoBtn');
const viewerClearBtn = qs('#viewerClearBtn');
const fileViewerStage = qs('#fileViewerStage');

const muteBtn = qs('#muteBtn');
const shareScreenBtn = qs('#shareScreenBtn');

const colorPicker = qs('#colorPicker');
const strokeSize = qs('#strokeSize');
const undoBtn = qs('#undoBtn');
const redoBtn = qs('#redoBtn');
const clearBtn = qs('#clearBtn');
const zoomInBtn = qs('#zoomInBtn');
const zoomOutBtn = qs('#zoomOutBtn');

initUI();

const resetUploadUI = () => {
  if (uploadProgress) uploadProgress.style.width = '0%';
  if (fileDropzone) fileDropzone.textContent = 'Drag files here or click upload';
};

const toolbar = qs('.workspace-toolbar');
let toolbarDrag = null;

const getActiveStage = () => (workspaceMode === 'whiteboard' ? boardStage : screenStage);

toolbar?.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button') || event.target.closest('input')) return;
  toolbar.setPointerCapture(event.pointerId);
  const rect = toolbar.getBoundingClientRect();
  toolbarDrag = {
    id: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
});

window.addEventListener('pointermove', (event) => {
  if (!toolbarDrag) return;
  const stage = getActiveStage();
  if (!stage) return;
  const stageRect = stage.getBoundingClientRect();
  const nextLeft = Math.min(
    Math.max(event.clientX - stageRect.left - toolbarDrag.offsetX, 8),
    stageRect.width - toolbar.offsetWidth - 8
  );
  const nextTop = Math.min(
    Math.max(event.clientY - stageRect.top - toolbarDrag.offsetY, 8),
    stageRect.height - toolbar.offsetHeight - 8
  );
  toolbar.style.left = `${nextLeft}px`;
  toolbar.style.top = `${nextTop}px`;
});

window.addEventListener('pointerup', () => {
  toolbarDrag = null;
});

const toolButtons = {
  pencil: qs('#toolPencil'),
  highlighter: qs('#toolHighlighter'),
  eraser: qs('#toolEraser'),
  rect: qs('#toolRect'),
  ellipse: qs('#toolEllipse'),
  text: qs('#toolText'),
  sticky: qs('#toolSticky')
};

const remoteMedia = qs('#remoteMedia');

const codeRaw =
  window.location.pathname.split('/').pop() ||
  new URLSearchParams(window.location.search).get('code');
const code = String(codeRaw || '')
  .trim()
  .toUpperCase();

if (!code) {
  showToast('Missing room code', 'error');
  window.location.href = '/dashboard';
}

const socket = io({ auth: { token: getToken() }, autoConnect: false });
const whiteboard = new Whiteboard(canvas, boardStage, socket, code);
const screenAnnotator = new AnnotationLayer(screenCanvas, screenStage, socket, code, 'screen');
const rtc = new WebRTCManager(socket, qs('#remoteMedia'));
const rtcReady = rtc.init();
const chat = new ChatManager(socket, code, {
  list: qs('#chatMessages'),
  form: qs('#chatForm'),
  input: qs('#chatInput'),
  typing: qs('#typingIndicator')
});

rtc.onScreenShareChange = (isSharing) => {
  if (shareScreenBtn) {
    shareScreenBtn.textContent = isSharing ? 'Stop share' : 'Share screen';
  }
  if (!isSharing && currentPresenter?.socketId === socket.id) {
    socket.emit('screen:share:stopped', { code });
    clearPresenter();
  }
  updateScreenStream();
};

let workspaceMode = 'screen';
let annotateEnabled = true;
let activeLayer = whiteboard;
let activeTool = 'pencil';
let currentPresenter = null;
let viewerAnnotator = null;
let currentViewerFile = null;
let viewerZoom = 1;

const updateMediaLayout = () => {
  if (!remoteMedia) return;
  const items = remoteMedia.querySelectorAll('video, audio');
  remoteMedia.classList.toggle('empty', items.length === 0);
};

const placeFloatingVideo = (element) => {
  if (!screenStage) return;
  const stageRect = screenStage.getBoundingClientRect();
  const width = element.offsetWidth || 180;
  const height = element.offsetHeight || 120;
  const padding = 18;
  element.style.position = 'absolute';
  const index = remoteMedia?.querySelectorAll('.remote-video').length || 1;
  const col = (index - 1) % 2;
  const row = Math.floor((index - 1) / 2);
  const left = Math.max(stageRect.width - (col + 1) * (width + 12) - padding, 12);
  const top = Math.max(stageRect.height - (row + 1) * (height + 12) - padding, 12);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
};

const makeDraggableVideo = (element) => {
  if (!element || element.dataset.dragReady) return;
  element.dataset.dragReady = 'true';
  let drag = null;

  element.addEventListener('pointerdown', (event) => {
    if (!screenStage) return;
    element.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    element.style.zIndex = '12';
    element.classList.add('dragging');
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const stageRect = screenStage.getBoundingClientRect();
    const left = Math.min(
      Math.max(event.clientX - stageRect.left - drag.offsetX, 8),
      stageRect.width - element.offsetWidth - 8
    );
    const top = Math.min(
      Math.max(event.clientY - stageRect.top - drag.offsetY, 8),
      stageRect.height - element.offsetHeight - 8
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  window.addEventListener('pointerup', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    element.classList.remove('dragging');
    element.style.zIndex = '';
  });
};

const setScreenPlaceholder = (visible) => {
  if (!screenPlaceholder) return;
  screenPlaceholder.classList.toggle('hidden', !visible);
};

const updateScreenStream = () => {
  if (!screenVideo) return;
  const localScreen = rtc.getScreenStream();
  if (localScreen) {
    screenVideo.srcObject = localScreen;
    setScreenPlaceholder(false);
    return;
  }

  if (currentPresenter?.socketId) {
    const stream = rtc.getRemoteStream(currentPresenter.socketId);
    if (stream) {
      screenVideo.srcObject = stream;
      setScreenPlaceholder(false);
      return;
    }
  }

  screenVideo.srcObject = null;
  setScreenPlaceholder(true);
};

const setPresenter = (payload) => {
  currentPresenter = payload;
  if (presenterBadge) {
    presenterBadge.textContent = payload?.name ? `${payload.name} presenting` : 'Presenter';
    presenterBadge.classList.toggle('active', Boolean(payload));
  }
  screenAnnotator.requestSync();
  updateScreenStream();
};

const clearPresenter = () => {
  currentPresenter = null;
  if (presenterBadge) presenterBadge.classList.remove('active');
  updateScreenStream();
};

const cursorDots = new Map();
const cursorColor = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 85%, 65%)`;
};

rtc.onRemoteStream = (peerId, stream, element) => {
  updateMediaLayout();
  if (element) {
    placeFloatingVideo(element);
    makeDraggableVideo(element);
  }
  if (currentPresenter?.socketId === peerId) {
    updateScreenStream();
  }
};

rtc.onRemoteRemoved = (peerId) => {
  if (currentPresenter?.socketId === peerId) {
    clearPresenter();
  }
  updateMediaLayout();
};

const renderParticipants = (users = []) => {
  if (!participantsList) return;
  participantsList.innerHTML = users
    .map(
      (user) => `
      <div class="participant">
        <div>${user.name}</div>
        <span class="badge">${user.status || 'online'}</span>
      </div>
    `
    )
    .join('');
};

const setAnnotateEnabled = (nextEnabled) => {
  annotateEnabled = Boolean(nextEnabled);
  screenAnnotator.setEnabled(annotateEnabled);
  if (annotateToggleBtn) {
    annotateToggleBtn.textContent = annotateEnabled ? 'Annotate' : 'Pointer';
    annotateToggleBtn.classList.toggle('active', annotateEnabled);
  }
};

const setWorkspaceMode = (mode) => {
  workspaceMode = mode;
  if (screenStage) screenStage.classList.toggle('active', mode !== 'whiteboard');
  if (boardStage) boardStage.classList.toggle('active', mode === 'whiteboard');
  if (whiteboardZoomGroup) {
    whiteboardZoomGroup.style.display = mode === 'whiteboard' ? 'flex' : 'none';
  }
  if (modeToggle) {
    modeToggle.querySelectorAll('button[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
  }

  if (mode === 'whiteboard') {
    activeLayer = whiteboard;
    setAnnotateEnabled(false);
  } else if (mode === 'presentation') {
    activeLayer = screenAnnotator;
    setAnnotateEnabled(false);
    screenAnnotator.resizeCanvas();
    screenAnnotator.requestSync();
  } else {
    activeLayer = screenAnnotator;
    setAnnotateEnabled(true);
    screenAnnotator.resizeCanvas();
    screenAnnotator.requestSync();
  }
};

const downloadFileWithAuth = async (fileId, fallbackName) => {
  try {
    const response = await fetch(`${API_BASE}/api/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fallbackName || 'file';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

const renderFiles = (files = []) => {
  if (!filesList) return;

  if (!files.length) {
    filesList.innerHTML = '<div class="muted">No shared files yet</div>';
    return;
  }

  filesList.innerHTML = files
    .map(
      (file) => {
        const name = file.originalName || file.name;
        const isImage = file.mimeType?.startsWith('image/');
        const isPdf = file.mimeType === 'application/pdf';
        const preview = isImage
          ? `<img src="${file.url}" alt="${name}" loading="lazy" />`
          : `<div class="file-icon">${isPdf ? 'PDF' : 'FILE'}</div>`;

        return `
      <div class="file-card">
        <div class="file-preview" data-open="${file._id || file.id}">
          ${preview}
        </div>
        <div class="file-meta">
          <div class="file-name" title="${name}">${name}</div>
          <div class="file-badges">
            <span class="badge">${formatBytes(file.size || 0)}</span>
            <span class="badge">${file.mimeType || 'file'}</span>
          </div>
        </div>
        <div class="file-actions">
          <button class="btn btn-ghost" data-download="${file._id || file.id}">Download</button>
          <button class="btn btn-ghost" data-delete="${file._id || file.id}">Delete</button>
        </div>
      </div>
    `;
      }
    )
    .join('');

  filesList.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.open;
      const file = files.find((entry) => String(entry._id || entry.id) === id);
      if (!file) return;
      openFileViewer(file);
    });
  });

  filesList.querySelectorAll('[data-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.download;
      const file = files.find((entry) => String(entry._id || entry.id) === id);
      downloadFileWithAuth(id, file?.originalName || file?.name);
    });
  });

  filesList.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.delete;
      const file = files.find((entry) => String(entry._id || entry.id) === id);
      if (!file) return;
      await deleteFile(id, file.originalName || file.name);
    });
  });
};

const loadFiles = async () => {
  try {
    const data = await apiFetch(`/api/files/room/${code}`);
    renderFiles(data.files || []);
  } catch (err) {
    renderFiles([]);
  }
};

const deleteFile = async (fileId, name) => {
  try {
    await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
    showToast(`${name || 'File'} deleted`, 'success');
    socket.emit('files:deleted', { code, fileId });
    loadFiles();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

const ensureViewerAnnotator = () => {
  if (!viewerAnnotator && fileViewerCanvas && fileViewerStage) {
    viewerAnnotator = new AnnotationLayer(
      fileViewerCanvas,
      fileViewerStage,
      socket,
      code,
      'file:temp'
    );
  }
  return viewerAnnotator;
};

const applyViewerZoom = () => {
  const clamped = Math.min(Math.max(viewerZoom, 0.6), 2.5);
  viewerZoom = clamped;
  if (fileViewerImage) {
    fileViewerImage.style.transform = `scale(${clamped})`;
  }
  if (fileViewerCanvas) {
    fileViewerCanvas.style.transform = `scale(${clamped})`;
  }
};

const openFileViewer = (file) => {
  if (!fileViewerModal || !fileViewerImage) return;
  if (!file.mimeType?.startsWith('image/')) {
    window.open(file.url, '_blank', 'noopener');
    return;
  }

  currentViewerFile = file;
  fileViewerTitle.textContent = file.originalName || file.name || 'File preview';
  fileViewerImage.src = file.url;
  viewerZoom = 1;
  applyViewerZoom();

  const annotator = ensureViewerAnnotator();
  if (annotator) {
    annotator.setTarget(`file:${file._id || file.id}`);
    annotator.setEnabled(true);
    annotator.setTool(activeTool === 'sticky' ? 'pencil' : activeTool);
  }

  if (typeof updateViewerToolActive === 'function') {
    updateViewerToolActive(activeTool === 'sticky' ? 'pencil' : activeTool);
  }

  toggleModal('#fileViewerModal', true);
  setTimeout(() => annotator?.resizeCanvas(), 50);
};

const renderNotes = (notes = []) => {
  if (!notesList) return;
  if (!notes.length) {
    notesList.innerHTML = '<div class="muted">No notes yet</div>';
    return;
  }

  notesList.innerHTML = notes
    .slice()
    .reverse()
    .map(
      (note) => `
      <div class="chat-message">
        <div class="meta">${note.createdBy?.name || 'Anon'}</div>
        <div>${note.content}</div>
      </div>
    `
    )
    .join('');
};

const loadNotes = async () => {
  try {
    const data = await apiFetch(`/api/rooms/${code}/notes`);
    renderNotes(data.notes || []);
  } catch (err) {
    renderNotes([]);
  }
};

const updateToolActive = (tool) => {
  if (tool === 'sticky' && activeLayer !== whiteboard) {
    showToast('Sticky notes are available on the whiteboard', 'info');
    return;
  }
  Object.values(toolButtons).forEach((button) =>
    button?.classList.remove('active')
  );
  toolButtons[tool]?.classList.add('active');
  activeTool = tool;
  activeLayer.setTool(tool);
};

Object.entries(toolButtons).forEach(([tool, button]) => {
  button?.addEventListener('click', () => updateToolActive(tool));
});

modeToggle?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  setWorkspaceMode(button.dataset.mode);
  updateToolActive(activeTool);
});

annotateToggleBtn?.addEventListener('click', () => {
  if (workspaceMode === 'whiteboard') return;
  setAnnotateEnabled(!annotateEnabled);
});

updateToolActive('pencil');
setWorkspaceMode('screen');
setScreenPlaceholder(true);

colorPicker?.addEventListener('input', (event) => {
  activeLayer.setColor(event.target.value);
});

strokeSize?.addEventListener('input', (event) => {
  activeLayer.setSize(Number(event.target.value));
});

undoBtn?.addEventListener('click', () => {
  if (activeLayer === screenAnnotator && !annotateEnabled) return;
  activeLayer.undo();
});
redoBtn?.addEventListener('click', () => {
  if (activeLayer === screenAnnotator && !annotateEnabled) return;
  activeLayer.redoAction();
});
clearBtn?.addEventListener('click', () => {
  if (activeLayer === screenAnnotator && !annotateEnabled) return;
  activeLayer.clear();
});
zoomInBtn?.addEventListener('click', () => whiteboard.setZoom(whiteboard.scale + 0.1));
zoomOutBtn?.addEventListener('click', () => whiteboard.setZoom(whiteboard.scale - 0.1));

saveBoardBtn?.addEventListener('click', async () => {
  try {
    await apiFetch(`/api/whiteboard/${code}/save`, {
      method: 'POST',
      body: JSON.stringify({ events: whiteboard.getEvents() })
    });
    showToast('Whiteboard saved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

uploadFileBtn?.addEventListener('click', () => {
  resetUploadUI();
  toggleModal('#uploadModal', true);
});

uploadForm?.querySelector('input[type="file"]')?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file && fileDropzone) {
    fileDropzone.textContent = file.name;
  }
});

uploadModal?.addEventListener('click', (event) => {
  if (event.target === uploadModal || event.target.hasAttribute('data-close')) {
    toggleModal('#uploadModal', false);
    resetUploadUI();
  }
});

fileViewerModal?.addEventListener('click', (event) => {
  if (event.target === fileViewerModal || event.target.hasAttribute('data-close')) {
    toggleModal('#fileViewerModal', false);
    currentViewerFile = null;
    if (viewerAnnotator) {
      viewerAnnotator.setEnabled(false);
      viewerAnnotator.setTarget('file:temp');
    }
  }
});

fileDownloadBtn?.addEventListener('click', () => {
  if (!currentViewerFile) return;
  downloadFileWithAuth(currentViewerFile._id || currentViewerFile.id, currentViewerFile.originalName || currentViewerFile.name);
});

const viewerToolButtons = fileViewerModal
  ? Array.from(fileViewerModal.querySelectorAll('[data-tool]'))
  : [];

const updateViewerToolActive = (tool) => {
  viewerToolButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  const annotator = ensureViewerAnnotator();
  annotator?.setTool(tool);
};

viewerToolButtons.forEach((button) => {
  button.addEventListener('click', () => updateViewerToolActive(button.dataset.tool));
});

viewerColorPicker?.addEventListener('input', (event) => {
  const annotator = ensureViewerAnnotator();
  annotator?.setColor(event.target.value);
});

viewerStrokeSize?.addEventListener('input', (event) => {
  const annotator = ensureViewerAnnotator();
  annotator?.setSize(Number(event.target.value));
});

viewerZoomInBtn?.addEventListener('click', () => {
  viewerZoom += 0.15;
  applyViewerZoom();
});

viewerZoomOutBtn?.addEventListener('click', () => {
  viewerZoom -= 0.15;
  applyViewerZoom();
});

viewerFullscreenBtn?.addEventListener('click', () => {
  if (!fileViewerStage) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    fileViewerStage.requestFullscreen?.();
  }
});

viewerUndoBtn?.addEventListener('click', () => ensureViewerAnnotator()?.undo());
viewerRedoBtn?.addEventListener('click', () => ensureViewerAnnotator()?.redoAction());
viewerClearBtn?.addEventListener('click', () => ensureViewerAnnotator()?.clear());

fileViewerImage?.addEventListener('load', () => {
  ensureViewerAnnotator()?.resizeCanvas();
});

uploadForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = uploadForm.querySelector('input[type="file"]').files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('roomCode', code);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (event) => {
      if (!uploadProgress || !event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      uploadProgress.style.width = `${percent}%`;
    };

    const response = await new Promise((resolve, reject) => {
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, body: xhr.responseText });
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });

    const data = JSON.parse(response.body || '{}');
    if (!response.ok) {
      throw new Error(data.message || 'Upload failed');
    }

    showToast('File uploaded', 'success');
    toggleModal('#uploadModal', false);
    resetUploadUI();
    socket.emit('files:uploaded', { code, file: data.file });
    loadFiles();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

fileDropzone?.addEventListener('click', () => {
  resetUploadUI();
  toggleModal('#uploadModal', true);
  const input = uploadForm?.querySelector('input[type="file"]');
  setTimeout(() => input?.click(), 50);
});

fileDropzone?.addEventListener('dragover', (event) => {
  event.preventDefault();
  fileDropzone.classList.add('dragover');
});

fileDropzone?.addEventListener('dragleave', () => {
  fileDropzone.classList.remove('dragover');
});

fileDropzone?.addEventListener('drop', (event) => {
  event.preventDefault();
  fileDropzone.classList.remove('dragover');
  const files = event.dataTransfer.files;
  const input = uploadForm?.querySelector('input[type="file"]');
  if (files && files[0] && input) {
    input.files = files;
    fileDropzone.textContent = files[0].name;
    toggleModal('#uploadModal', true);
  }
});

saveNoteBtn?.addEventListener('click', async () => {
  const content = notesInput?.value.trim();
  if (!content) return;
  try {
    await apiFetch(`/api/rooms/${code}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    notesInput.value = '';
    loadNotes();
    showToast('Note saved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

copyCodeBtn?.addEventListener('click', async () => {
  const success = await copyText(code);
  showToast(success ? `Room code copied: ${code}` : 'Copy failed', success ? 'success' : 'error');
});

leaveRoomBtn?.addEventListener('click', () => {
  socket.emit('room:leave', { code });
  window.location.href = '/dashboard';
});

muteBtn?.addEventListener('click', () => {
  const isMuted = rtc.toggleMute();
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
});

shareScreenBtn?.addEventListener('click', async () => {
  const sharing = await rtc.toggleScreenShare();
  shareScreenBtn.textContent = sharing ? 'Stop share' : 'Share screen';
  if (sharing) {
    setWorkspaceMode('screen');
    socket.emit('screen:share:started', { code });
    setPresenter({ socketId: socket.id, name: 'You' });
  } else {
    socket.emit('screen:share:stopped', { code });
    clearPresenter();
  }
});

startShareBtn?.addEventListener('click', async () => {
  const sharing = await rtc.toggleScreenShare();
  shareScreenBtn.textContent = sharing ? 'Stop share' : 'Share screen';
  if (sharing) {
    setWorkspaceMode('screen');
    socket.emit('screen:share:started', { code });
    setPresenter({ socketId: socket.id, name: 'You' });
  }
});

const sendCursor = throttle((x, y) => {
  socket.emit('cursor:move', { code, x, y });
}, 40);

boardStage?.addEventListener('pointermove', (event) => {
  if (workspaceMode !== 'whiteboard') return;
  const rect = boardStage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  sendCursor(x, y);
});

socket.on('cursor:move', ({ userId, x, y }) => {
  if (!cursorLayer) return;
  let dot = cursorDots.get(userId);
  if (!dot) {
    dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const color = cursorColor(userId);
    dot.style.background = color;
    dot.style.boxShadow = `0 0 12px ${color}`;
    cursorLayer.appendChild(dot);
    cursorDots.set(userId, dot);
  }
  dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
});

socket.on('room:user-left', ({ userId, socketId }) => {
  if (socketId) rtc.removePeer(socketId);
  const dot = cursorDots.get(userId);
  if (dot) {
    dot.remove();
    cursorDots.delete(userId);
  }
  if (currentPresenter?.socketId === socketId) {
    clearPresenter();
  }
});

socket.on('room:users', ({ users }) => {
  renderParticipants(users);
  rtcReady.then(() => rtc.connectToPeers(users, socket.id));
});

socket.on('screen:share:state', ({ presenter }) => {
  if (presenter) {
    setPresenter(presenter);
  } else {
    clearPresenter();
  }
});

socket.on('screen:share:started', ({ presenter }) => {
  setPresenter(presenter);
});

socket.on('screen:share:stopped', ({ socketId }) => {
  if (!currentPresenter || currentPresenter.socketId === socketId) {
    clearPresenter();
  }
});

socket.on('files:uploaded', () => loadFiles());
socket.on('files:deleted', () => loadFiles());

socket.on('room:user-joined', ({ user }) => {
  showToast(`${user.name} joined`, 'success');
});

const mediaObserver = new MutationObserver(() => updateMediaLayout());
if (remoteMedia) {
  mediaObserver.observe(remoteMedia, { childList: true });
  updateMediaLayout();
}

socket.on('room:error', (payload) => {
  showToast(payload.message, 'error');
  setTimeout(() => {
    window.location.href = '/dashboard';
  }, 1200);
});

socket.on('connect', async () => {
  await rtcReady;
  socket.emit('room:join', { code });
  updateMediaLayout();
  screenAnnotator.requestSync();
});

window.addEventListener('beforeunload', () => {
  socket.emit('room:leave', { code });
});

chat.init();

(async () => {
  try {
    const data = await apiFetch(`/api/rooms/${code}`);
    if (roomTitle) roomTitle.textContent = data.room.name;
    if (roomCodeBadge) roomCodeBadge.textContent = `Code: ${data.room.code}`;
  } catch (err) {
    showToast(err.message, 'error');
    window.location.href = '/dashboard';
    return;
  }

  try {
    const saved = await apiFetch(`/api/whiteboard/${code}/latest`);
    whiteboard.loadEvents(saved.events || []);
  } catch (err) {
    // Ignore missing history
  }

  await loadFiles();
  await loadNotes();
  socket.connect();
})();
