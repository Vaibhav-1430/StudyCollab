import { STUN_SERVERS, getIceServers } from './config.js';
import { showToast } from './utils.js';

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  sampleSize: 16
};

export class WebRTCManager {
  constructor(socket, remoteContainer) {
    this.socket = socket;
    this.remoteContainer = remoteContainer;
    this.peers = new Map();
    this.remoteAudioStreams = new Map();
    this.remoteScreenStreams = new Map();
    this.pendingCandidates = new Map();
    this.connectionTimers = new Map();
    this.makingOffer = new Set();
    this.localStream = null;
    this.screenStream = null;
    this.iceServers = STUN_SERVERS;
    this.selfId = null;
    this.isMuted = false;
    this.onRemoteStream = null;
    this.onRemoteRemoved = null;
    this.onScreenShareChange = null;
  }

  async init() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false
      });
      this.optimizeAudioTracks();
    } catch (err) {
      showToast('Microphone access is needed for room audio', 'error');
      this.localStream = new MediaStream();
    }

    this.socket.on('webrtc:offer', (payload) => this.handleOffer(payload));
    this.socket.on('webrtc:answer', (payload) => this.handleAnswer(payload));
    this.socket.on('webrtc:candidate', (payload) => this.handleCandidate(payload));
    this.socket.on('connect', () => this.restartAllIce());
    this.iceServers = await getIceServers();
  }

  optimizeAudioTracks() {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
      track.contentHint = 'speech';
    });
  }

  setSelfId(socketId) {
    this.selfId = socketId;
  }

  async connectToPeers(users, selfSocketId) {
    this.selfId = selfSocketId;
    const active = new Set(
      users
        .filter((user) => user.socketId && user.socketId !== selfSocketId)
        .map((user) => user.socketId)
    );

    [...this.peers.keys()].forEach((peerId) => {
      if (!active.has(peerId)) this.removePeer(peerId);
    });

    for (const peerId of active) {
      if (!this.peers.has(peerId)) this.createPeerConnection(peerId);
      if (selfSocketId < peerId) await this.negotiate(peerId);
    }
  }

  createPeerConnection(peerId) {
    const existing = this.peers.get(peerId);
    if (existing && existing.connectionState !== 'closed') return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });
    this.peers.set(peerId, pc);

    this.localStream?.getAudioTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    const screenTrack = this.screenStream?.getVideoTracks()[0];
    if (screenTrack) pc.addTrack(screenTrack, this.screenStream);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.socket.emit('webrtc:candidate', {
        targetId: peerId,
        candidate: event.candidate
      });
    };

    pc.ontrack = (event) => {
      const track = event.track;
      const stream = event.streams[0] || new MediaStream([track]);
      if (track.kind === 'audio') {
        this.remoteAudioStreams.set(peerId, stream);
        this.renderRemoteAudio(peerId, stream);
      }
      if (track.kind === 'video') {
        this.remoteScreenStreams.set(peerId, stream);
        if (typeof this.onRemoteStream === 'function') this.onRemoteStream(peerId, stream);
      }
      track.onended = () => {
        if (track.kind === 'video') this.remoteScreenStreams.delete(peerId);
      };
    };

    pc.onconnectionstatechange = () => this.handleConnectionState(peerId, pc);
    pc.oniceconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
        this.scheduleIceRestart(peerId, pc.iceConnectionState === 'failed' ? 0 : 2500);
      }
    };
    pc.onnegotiationneeded = () => this.negotiate(peerId);

    return pc;
  }

  handleConnectionState(peerId, pc) {
    if (pc.connectionState === 'failed') this.scheduleIceRestart(peerId, 0);
    if (pc.connectionState === 'disconnected') this.scheduleIceRestart(peerId, 3000);
    if (['connected', 'completed'].includes(pc.connectionState)) {
      const timer = this.connectionTimers.get(peerId);
      if (timer) clearTimeout(timer);
      this.connectionTimers.delete(peerId);
    }
    if (pc.connectionState === 'closed') this.removePeer(peerId);
  }

  scheduleIceRestart(peerId, delay) {
    if (this.connectionTimers.has(peerId)) return;
    const timer = window.setTimeout(() => {
      this.connectionTimers.delete(peerId);
      this.restartIce(peerId);
    }, delay);
    this.connectionTimers.set(peerId, timer);
  }

  async negotiate(peerId, options = {}) {
    const pc = this.peers.get(peerId);
    if (!pc || pc.signalingState !== 'stable' || this.makingOffer.has(peerId)) return;
    if (!options.force && this.selfId && this.selfId > peerId) return;
    try {
      this.makingOffer.add(peerId);
      const offer = await pc.createOffer(options.iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc:offer', { targetId: peerId, sdp: pc.localDescription });
    } catch (err) {
      // Negotiation can be retried by the next state change.
    } finally {
      this.makingOffer.delete(peerId);
    }
  }

  async handleOffer({ fromId, sdp }) {
    const pc = this.peers.get(fromId) || this.createPeerConnection(fromId);
    try {
      const offerCollision = this.makingOffer.has(fromId) || pc.signalingState !== 'stable';
      const polite = !this.selfId || this.selfId > fromId;
      if (offerCollision && !polite) return;
      if (offerCollision) {
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }),
          pc.setRemoteDescription(new RTCSessionDescription(sdp))
        ]);
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
      await this.flushCandidates(fromId);
      await pc.setLocalDescription(await pc.createAnswer());
      this.socket.emit('webrtc:answer', { targetId: fromId, sdp: pc.localDescription });
    } catch (err) {
      this.removePeer(fromId);
    }
  }

  async handleAnswer({ fromId, sdp }) {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushCandidates(fromId);
    } catch (err) {
      this.scheduleIceRestart(fromId, 1000);
    }
  }

  async handleCandidate({ fromId, candidate }) {
    const pc = this.peers.get(fromId);
    if (!pc || !pc.remoteDescription) {
      this.queueCandidate(fromId, candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Candidate may be stale after a reconnect.
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  async setAudioInputDevice(deviceId) {
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } },
        video: false
      });
      const nextTrack = nextStream.getAudioTracks()[0];
      if (!nextTrack) return false;
      nextTrack.enabled = !this.isMuted;
      nextTrack.contentHint = 'speech';

      const oldTracks = this.localStream?.getAudioTracks() || [];
      this.localStream = new MediaStream([nextTrack]);

      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((entry) => entry.track?.kind === 'audio');
        if (sender) sender.replaceTrack(nextTrack);
        else pc.addTrack(nextTrack, this.localStream);
      });
      oldTracks.forEach((track) => track.stop());
      return true;
    } catch (err) {
      return false;
    }
  }

  async toggleScreenShare() {
    if (this.screenStream) {
      this.stopScreenShare();
      return false;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen track');
      screenTrack.contentHint = 'detail';
      screenTrack.onended = () => this.stopScreenShare();

      this.peers.forEach((pc, peerId) => {
        const sender = pc.getSenders().find((entry) => entry.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
        else pc.addTrack(screenTrack, this.screenStream);
        this.negotiate(peerId, { force: true });
      });

      if (typeof this.onScreenShareChange === 'function') {
        this.onScreenShareChange(true, this.screenStream);
      }
      return true;
    } catch (err) {
      this.screenStream = null;
      showToast('Screen share failed', 'error');
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;

    this.peers.forEach((pc, peerId) => {
      const sender = pc.getSenders().find((entry) => entry.track?.kind === 'video');
      if (sender) sender.replaceTrack(null);
      this.negotiate(peerId, { force: true });
    });

    if (typeof this.onScreenShareChange === 'function') {
      this.onScreenShareChange(false, null);
    }
  }

  renderRemoteAudio(peerId, stream) {
    if (!this.remoteContainer) return;
    let element = this.remoteContainer.querySelector(`[data-peer="${peerId}"]`);
    if (!element) {
      element = document.createElement('audio');
      element.dataset.peer = peerId;
      element.autoplay = true;
      element.playsInline = true;
      this.remoteContainer.appendChild(element);
    }
    element.srcObject = stream;
  }

  removePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.peers.delete(peerId);
    }
    const timer = this.connectionTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.connectionTimers.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.remoteAudioStreams.delete(peerId);
    this.remoteScreenStreams.delete(peerId);
    this.remoteContainer?.querySelector(`[data-peer="${peerId}"]`)?.remove();
    if (typeof this.onRemoteRemoved === 'function') this.onRemoteRemoved(peerId);
  }

  getRemoteScreenStream(peerId) {
    return this.remoteScreenStreams.get(peerId) || null;
  }

  getScreenStream() {
    return this.screenStream || null;
  }

  queueCandidate(peerId, candidate) {
    const list = this.pendingCandidates.get(peerId) || [];
    list.push(candidate);
    this.pendingCandidates.set(peerId, list.slice(-40));
  }

  async flushCandidates(peerId) {
    const pc = this.peers.get(peerId);
    const list = this.pendingCandidates.get(peerId);
    if (!pc || !pc.remoteDescription || !list?.length) return;
    this.pendingCandidates.delete(peerId);
    for (const candidate of list) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        // Ignore stale candidate.
      }
    }
  }

  restartAllIce() {
    this.peers.forEach((_, peerId) => this.restartIce(peerId));
  }

  async restartIce(peerId) {
    await this.negotiate(peerId, { iceRestart: true, force: true });
  }
}
