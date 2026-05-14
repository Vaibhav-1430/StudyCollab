import { apiFetch } from './api.js';
import { API_BASE } from './config.js';
import { requireAuth, logout, getUser, getToken, setUser } from './auth.js';
import { qs, showToast, toggleModal, debounce, copyText } from './utils.js';
import { initUI } from './ui.js';

requireAuth();

const roomsGrid = qs('#roomsGrid');
const friendsList = qs('#friendsList');
const requestsList = qs('#requestsList');
const userSearchInput = qs('#userSearchInput');
const searchResults = qs('#searchResults');
const welcomeTitle = qs('#welcomeTitle');
const profileName = qs('#profileName');
const profileStatus = qs('#profileStatus');
const roomsCount = qs('#roomsCount');
const friendsCount = qs('#friendsCount');
const liveRooms = qs('#liveRooms');
const recentRooms = qs('#recentRooms');
const notificationList = qs('#notificationList');
const activityList = qs('#activityList');

const dashboardRoot = qs('.dashboard');
const sections = Array.from(document.querySelectorAll('[data-section]'));
const navLinks = Array.from(document.querySelectorAll('[data-nav]'));
const openProfileBtn = qs('#openProfileBtn');

const friendsPageList = qs('#friendsPageList');
const friendsRequestsList = qs('#friendsRequestsList');
const friendsSearchInput = qs('#friendsSearchInput');
const friendsSearchResults = qs('#friendsSearchResults');
const refreshFriendsBtn = qs('#refreshFriendsBtn');

const filesUploadForm = qs('#filesUploadForm');
const filesUploadInput = qs('#filesUploadInput');
const filesUploadBtn = qs('#filesUploadBtn');
const filesRoomCode = qs('#filesRoomCode');
const filesRoomList = qs('#filesRoomList');
const filesUploadProgress = qs('#filesUploadProgress');
const filesLibraryList = qs('#filesLibraryList');
const refreshFilesBtn = qs('#refreshFilesBtn');

const profileForm = qs('#profileForm');
const profileNameInput = qs('#profileNameInput');
const profileEmailInput = qs('#profileEmailInput');
const profileStatusPill = qs('#profileStatusPill');
const profileAvatarImg = qs('#profileAvatarImg');
const avatarInput = qs('#avatarInput');
const avatarUploadBtn = qs('#avatarUploadBtn');

const createRoomBtn = qs('#createRoomBtn');
const joinRoomBtn = qs('#joinRoomBtn');
const logoutBtn = qs('#logoutBtn');
const createRoomModal = qs('#createRoomModal');
const joinRoomModal = qs('#joinRoomModal');
const createRoomForm = qs('#createRoomForm');
const joinRoomForm = qs('#joinRoomForm');

let notificationSocket = null;
let cachedRooms = [];
let cachedFriends = [];
let cachedRequests = [];

initUI();

const closeModal = (overlay) => toggleModal(`#${overlay.id}`, false);

[createRoomModal, joinRoomModal].forEach((overlay) => {
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.hasAttribute('data-close')) {
      closeModal(overlay);
    }
  });
});

createRoomBtn?.addEventListener('click', () => toggleModal('#createRoomModal', true));
joinRoomBtn?.addEventListener('click', () => toggleModal('#joinRoomModal', true));
logoutBtn?.addEventListener('click', logout);

const sectionMap = {
  dashboard: 'dashboard',
  rooms: 'dashboard',
  friends: 'friends',
  files: 'files',
  profile: 'profile'
};

const setActiveSection = (navId, options = {}) => {
  const sectionId = sectionMap[navId] || 'dashboard';
  sections.forEach((section) => {
    section.classList.toggle('active', section.dataset.section === sectionId);
  });

  navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === navId);
  });

  if (dashboardRoot) {
    dashboardRoot.classList.toggle('is-wide', sectionId !== 'dashboard');
  }

  if (options.scrollTarget) {
    const target = qs(options.scrollTarget);
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }
};

const initNavigation = () => {
  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const navId = link.dataset.nav;
      const scrollTarget = link.dataset.scroll;
      if (navId) {
        setActiveSection(navId, { scrollTarget });
        window.location.hash = navId;
      }
    });
  });

  openProfileBtn?.addEventListener('click', () => {
    setActiveSection('profile');
    window.location.hash = 'profile';
  });

  const initial = window.location.hash.replace('#', '') || 'dashboard';
  setActiveSection(initial, {
    scrollTarget: initial === 'rooms' ? '#roomsPanel' : null
  });
};

const setButtonLoading = (button, loadingText) => {
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
};

const renderRooms = (rooms = []) => {
  if (!roomsGrid) return;
  if (!rooms.length) {
    roomsGrid.innerHTML = '<div class="room-card">No rooms yet. Create one!</div>';
    return;
  }
  roomsGrid.innerHTML = rooms
    .map(
      (room) => `
      <div class="room-card">
        <h4>${room.name}</h4>
        <p class="muted">Code: ${room.code}</p>
        <span class="badge">${room.isPublic ? 'Public' : 'Private'}</span>
        <div style="display:flex; gap:10px; flex-wrap: wrap;">
          <button class="btn btn-primary" data-room="${room.code}">Open</button>
          <button class="btn btn-ghost" data-invite="${room.code}">Invite</button>
        </div>
      </div>
    `
    )
    .join('');

  roomsGrid.querySelectorAll('button[data-room]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.href = `/room/${button.dataset.room}`;
    });
  });

  roomsGrid.querySelectorAll('button[data-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.invite;
      const success = await copyText(code);
      showToast(success ? `Room code copied: ${code}` : 'Copy failed', success ? 'success' : 'error');
    });
  });
};

const renderRecentRooms = (rooms = []) => {
  if (!recentRooms) return;
  if (!rooms.length) {
    recentRooms.innerHTML = '<div class="room-card">No recent rooms yet.</div>';
    return;
  }
  recentRooms.innerHTML = rooms
    .slice(0, 3)
    .map(
      (room) => `
      <div class="room-card">
        <h4>${room.name}</h4>
        <p class="muted">Code: ${room.code}</p>
        <div style="display:flex; gap:10px; flex-wrap: wrap;">
          <button class="btn btn-ghost" data-room="${room.code}">Rejoin</button>
          <button class="btn btn-outline" data-invite="${room.code}">Invite</button>
        </div>
      </div>
    `
    )
    .join('');

  recentRooms.querySelectorAll('button[data-room]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.href = `/room/${button.dataset.room}`;
    });
  });

  recentRooms.querySelectorAll('button[data-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.invite;
      const success = await copyText(code);
      showToast(success ? `Room code copied: ${code}` : 'Copy failed', success ? 'success' : 'error');
    });
  });
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');

const populateRoomDatalist = (rooms = []) => {
  const dl = filesRoomList;
  if (!dl) return;
  dl.innerHTML = '';
  rooms.forEach((room) => {
    const opt = document.createElement('option');
    opt.value = room.code;
    opt.textContent = `${room.name} (${room.code})`;
    dl.appendChild(opt);
  });
};

const downloadUserFile = async (fileId, fallbackName) => {
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

const renderUserFilesLibrary = (files = []) => {
  if (!filesLibraryList) return;
  if (!files.length) {
    filesLibraryList.innerHTML = '<div class="muted">No uploads yet. Upload a file to a room, or use the form above.</div>';
    return;
  }
  filesLibraryList.innerHTML = files
    .map((file) => {
      const id = file._id || file.id;
      const name = escapeHtml(file.originalName || 'File');
      const room = file.room;
      const roomLabel = room ? escapeHtml(`${room.name} · ${room.code}`) : '';
      const mime = file.mimeType || '';
      const isImage = mime.startsWith('image/');
      const isPdf = mime === 'application/pdf';
      const preview =
        isImage && file.url
          ? `<a class="btn btn-ghost" href="${encodeURI(file.url)}" target="_blank" rel="noopener">Preview</a>`
          : isPdf && file.url
            ? `<a class="btn btn-ghost" href="${encodeURI(file.url)}" target="_blank" rel="noopener">Open PDF</a>`
            : '';
      return `
      <div class="file-library-row">
        <div class="file-library-meta">
          <div class="file-library-name">${name}</div>
          ${roomLabel ? `<div class="muted file-library-room">${roomLabel}</div>` : ''}
        </div>
        <div class="file-library-actions">
          ${preview}
          <button type="button" class="btn btn-primary" data-dl="${id}">Download</button>
        </div>
      </div>`;
    })
    .join('');

  filesLibraryList.querySelectorAll('[data-dl]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.dl;
      const file = files.find((f) => String(f._id || f.id) === id);
      downloadUserFile(id, file?.originalName);
    });
  });
};

const loadUserFilesLibrary = async () => {
  if (!filesLibraryList) return;
  try {
    const data = await apiFetch('/api/files/mine');
    renderUserFilesLibrary(data.files || []);
  } catch (err) {
    filesLibraryList.innerHTML = `<div class="muted">${escapeHtml(err.message)}</div>`;
  }
};

const applyProfileForm = (user) => {
  if (!user) return;
  if (profileNameInput) profileNameInput.value = user.name || '';
  if (profileEmailInput) profileEmailInput.value = user.email || '';
  if (profileStatusPill) profileStatusPill.textContent = user.status || 'offline';
  if (profileAvatarImg) {
    if (user.avatar) {
      profileAvatarImg.src = user.avatar;
      profileAvatarImg.alt = user.name || 'Avatar';
      profileAvatarImg.classList.remove('is-empty');
    } else {
      profileAvatarImg.removeAttribute('src');
      profileAvatarImg.alt = '';
      profileAvatarImg.classList.add('is-empty');
    }
  }
};

const renderFriendsList = (container, friends = [], options = {}) => {
  if (!container) return;
  if (!friends.length) {
    container.innerHTML = '<div class="muted">No friends yet</div>';
    return;
  }
  container.innerHTML = friends
    .map(
      (friend) => {
        const fid = friend._id || friend.id;
        const studyBtn = showStudy
          ? `<button type="button" class="btn btn-primary" data-study="${fid}">Study</button>`
          : '';
        return `
      <div class="friend-item">
        <div>
          <span class="status-dot" style="background: ${
            friend.status === 'online' ? '#4ade80' : '#64748b'
          }"></span>
          ${escapeHtml(friend.name)}
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="badge">${friend.status || 'offline'}</span>
          ${studyBtn}
        </div>
      </div>
    `;
      }
    )
    .join('');

  container.querySelectorAll('[data-study]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reset = setButtonLoading(button, 'Starting…');
      try {
        const res = await apiFetch('/api/rooms/study-with', {
          method: 'POST',
          body: JSON.stringify({ friendId: button.dataset.study })
        });
        showToast('Opening your study room', 'success');
        window.location.href = `/room/${res.room.code}`;
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        reset();
      }
    });
  });
};
const renderActivity = (friends = []) => {
  if (!activityList) return;
  if (!friends.length) {
    activityList.innerHTML = '<div class="muted">No recent activity</div>';
    return;
  }
  activityList.innerHTML = friends
    .slice(0, 4)
    .map(
      (friend) => `
      <div class="friend-item">
        <div>${escapeHtml(friend.name)}</div>
        <span class="badge">${friend.status === 'online' ? 'Active now' : 'Offline'}</span>
      </div>
    `
    )
    .join('');
};

const bindRequestActions = (container) => {
  if (!container) return;
  container.querySelectorAll('[data-accept]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reset = setButtonLoading(button, 'Accepting...');
      try {
        await apiFetch('/api/friends/accept', {
          method: 'POST',
          body: JSON.stringify({ requestId: button.dataset.accept })
        });
        showToast('Friend request accepted', 'success');
        loadDashboard();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        reset();
      }
    });
  });

  container.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reset = setButtonLoading(button, 'Rejecting...');
      try {
        await apiFetch('/api/friends/reject', {
          method: 'POST',
          body: JSON.stringify({ requestId: button.dataset.reject })
        });
        showToast('Request rejected', 'info');
        loadDashboard();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        reset();
      }
    });
  });
};

const renderRequestsList = (container, requests = []) => {
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = '<div class="muted">No pending requests</div>';
    return;
  }
  container.innerHTML = requests
    .map(
      (request) => `
      <div class="request-item">
        <div>${escapeHtml(request.from?.name || 'User')}</div>
        <div style="display:flex; gap:8px">
          <button class="btn btn-ghost" data-accept="${request._id}">Accept</button>
          <button class="btn btn-outline" data-reject="${request._id}">Reject</button>
        </div>
      </div>
    `
    )
    .join('');

  bindRequestActions(container);
};

const loadDashboard = async () => {
  try {
    if (roomsGrid) {
      roomsGrid.innerHTML = Array.from({ length: 3 })
        .map(() => '<div class="room-card skeleton" style="height:120px"></div>')
        .join('');
    }
    if (recentRooms) {
      recentRooms.innerHTML = Array.from({ length: 2 })
        .map(() => '<div class="room-card skeleton" style="height:110px"></div>')
        .join('');
    }
    if (friendsList) {
      friendsList.innerHTML = Array.from({ length: 3 })
        .map(() => '<div class="friend-item skeleton" style="height:42px"></div>')
        .join('');
    }
    if (requestsList) {
      requestsList.innerHTML = Array.from({ length: 2 })
        .map(() => '<div class="request-item skeleton" style="height:42px"></div>')
        .join('');
    }
    const [roomsData, friendsData, requestsData, meData] = await Promise.all([
      apiFetch('/api/rooms'),
      apiFetch('/api/friends/list'),
      apiFetch('/api/friends/requests'),
      apiFetch('/api/users/me')
    ]);

    cachedRooms = roomsData.rooms || [];
    cachedFriends = friendsData.friends || [];
    cachedRequests = requestsData.requests || [];

    const user = meData.user || getUser();
    if (user) {
      setUser(user);
    }
    if (welcomeTitle && user?.name) {
      welcomeTitle.textContent = `Welcome back, ${user.name}`;
    }

    if (profileName && user?.name) {
      profileName.textContent = user.name;
    }
    if (profileStatus) {
      profileStatus.textContent = 'Online';
    }
    if (roomsCount) roomsCount.textContent = cachedRooms.length;
    if (friendsCount) friendsCount.textContent = cachedFriends.length;
    if (liveRooms) {
      liveRooms.textContent = `${cachedRooms.length} active right now`;
    }

    renderRooms(cachedRooms);
    renderRecentRooms(cachedRooms);
    renderFriendsList(friendsList, cachedFriends);
    renderFriendsList(friendsPageList, cachedFriends, { showStudy: true });
    renderActivity(cachedFriends);
    renderRequestsList(requestsList, cachedRequests);
    renderRequestsList(friendsRequestsList, cachedRequests);
    populateRoomDatalist(cachedRooms);
    applyProfileForm(user);
    await loadUserFilesLibrary();
  } catch (err) {
    showToast(err.message, 'error');
    if (roomsGrid) {
      roomsGrid.innerHTML =
        '<div class="room-card"><p class="muted">Could not load rooms. Try refresh or sign in again.</p></div>';
    }
    if (recentRooms) {
      recentRooms.innerHTML = '<div class="room-card muted">—</div>';
    }
    if (friendsList) {
      friendsList.innerHTML = '<div class="muted">—</div>';
    }
    if (requestsList) {
      requestsList.innerHTML = '<div class="muted">—</div>';
    }
  }
};

createRoomForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(createRoomForm);
  try {
    const response = await apiFetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: data.get('name'),
        isPublic: Boolean(data.get('isPublic'))
      })
    });
    toggleModal('#createRoomModal', false);
    window.location.href = `/room/${response.room.code}`;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

joinRoomForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(joinRoomForm);
  const code = String(data.get('code') || '')
    .trim()
    .toUpperCase();
  try {
    const response = await apiFetch('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ code })
    });
    toggleModal('#joinRoomModal', false);
    window.location.href = `/room/${response.room.code}`;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

const wireUserSearch = (inputEl, resultsEl) => {
  if (!inputEl || !resultsEl) return;
  inputEl.addEventListener(
    'input',
    debounce(async (event) => {
      const query = event.target.value.trim();
      if (query.length < 2) {
        resultsEl.innerHTML = '';
        return;
      }
      try {
        const data = await apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (!data.users.length) {
          resultsEl.innerHTML = '<div class="muted">No users found</div>';
          return;
        }
        resultsEl.innerHTML = data.users
          .map((user) => {
            const uid = user._id || user.id;
            return `
          <div class="friend-item">
            <div>${escapeHtml(user.name)}</div>
            <button type="button" class="btn btn-ghost" data-add="${uid}">Add</button>
          </div>
        `;
          })
          .join('');

        resultsEl.querySelectorAll('[data-add]').forEach((button) => {
          button.addEventListener('click', async () => {
            try {
              await apiFetch('/api/friends/request', {
                method: 'POST',
                body: JSON.stringify({ toUserId: button.dataset.add })
              });
              showToast('Friend request sent', 'success');
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        });
      } catch (err) {
        showToast(err.message, 'error');
      }
    }, 350)
  );
};

wireUserSearch(userSearchInput, searchResults);
wireUserSearch(friendsSearchInput, friendsSearchResults);

filesUploadForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = filesUploadInput?.files?.[0];
  const roomCode = String(filesRoomCode?.value || '')
    .trim()
    .toUpperCase();
  if (!file || !roomCode) {
    showToast('Choose a room code and a file', 'error');
    return;
  }
  const reset = setButtonLoading(filesUploadBtn, 'Uploading…');
  if (filesUploadProgress) filesUploadProgress.style.width = '0%';
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomCode', roomCode);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (e) => {
      if (!filesUploadProgress || !e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      filesUploadProgress.style.width = `${pct}%`;
    };
    const response = await new Promise((resolve, reject) => {
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, body: xhr.responseText });
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
    const body = JSON.parse(response.body || '{}');
    if (!response.ok) {
      throw new Error(body.message || 'Upload failed');
    }
    showToast('File uploaded', 'success');
    filesUploadForm.reset();
    if (filesUploadProgress) filesUploadProgress.style.width = '0%';
    await loadUserFilesLibrary();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    reset();
  }
});

profileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(profileForm);
  try {
    const res = await apiFetch('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify({ name: fd.get('name') })
    });
    setUser(res.user);
    applyProfileForm(res.user);
    showToast('Profile saved', 'success');
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

avatarUploadBtn?.addEventListener('click', () => avatarInput?.click());

avatarInput?.addEventListener('change', async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  try {
    const res = await fetch(`${API_BASE}/api/users/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.message || 'Upload failed');
    }
    setUser(body.user);
    applyProfileForm(body.user);
    showToast('Avatar updated', 'success');
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    avatarInput.value = '';
  }
});

refreshFriendsBtn?.addEventListener('click', () => loadDashboard());
refreshFilesBtn?.addEventListener('click', () => loadUserFilesLibrary());

const initRealtimeNotifications = () => {
  const token = getToken();
  if (!token || typeof io === 'undefined') return;

  notificationSocket = io({ auth: { token } });

  notificationSocket.on('notify:friend-request', ({ from }) => {
    showToast(`New friend request from ${from?.name || 'a user'}`, 'success');
    pushNotification(`Friend request from ${from?.name || 'a user'}`);
    loadDashboard();
  });

  notificationSocket.on('notify:room-invite', ({ roomCode, roomName, from }) => {
    showToast(`Room invite: ${roomName} from ${from?.name || 'a user'}`, 'success');
    pushNotification(`Room invite: ${roomName}`);
    if (roomCode) {
      setTimeout(() => {
        loadDashboard();
      }, 400);
    }
  });

  notificationSocket.on('connect_error', () => {
    showToast('Realtime notifications offline', 'error');
  });
};

const pushNotification = (message) => {
  if (!notificationList) return;
  notificationList.querySelectorAll('.muted').forEach((node) => node.remove());
  const item = document.createElement('div');
  item.className = 'friend-item';
  item.textContent = message;
  notificationList.prepend(item);
  const children = Array.from(notificationList.children);
  if (children.length > 4) {
    children.slice(4).forEach((node) => node.remove());
  }
};

loadDashboard();
initRealtimeNotifications();
initNavigation();
window.addEventListener('hashchange', () => {
  const navId = window.location.hash.replace('#', '') || 'dashboard';
  setActiveSection(navId, {
    scrollTarget: navId === 'rooms' ? '#roomsPanel' : null
  });
});
