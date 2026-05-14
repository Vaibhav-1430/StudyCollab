const runtimeBase = window.__APP_CONFIG__?.apiBase;
export const API_BASE = runtimeBase || window.location.origin;

export const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export const getIceServers = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/config/webrtc`);
    const data = await response.json();
    if (response.ok && Array.isArray(data.iceServers)) {
      return data.iceServers;
    }
  } catch (err) {
    // Ignore and fall back to STUN
  }
  return STUN_SERVERS;
};
