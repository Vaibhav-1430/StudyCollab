import { STUN_SERVERS, getIceServers } from './config.js';
import { showToast } from './utils.js';

export class WebRTCManager {
  constructor(socket, remoteContainer) {
    this.socket = socket;
    this.remoteContainer = remoteContainer;
    this.peers = new Map();
    this.remoteStreams = new Map();
    this.localStream = null;
    this.screenStream = null;
    this.iceServers = STUN_SERVERS;
    this.onRemoteStream = null;
    this.onRemoteRemoved = null;
    this.onScreenShareChange = null;
  }

  async init() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: true
      });

      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
      }
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }

    this.socket.on('webrtc:offer', (payload) => this.handleOffer(payload));
    this.socket.on('webrtc:answer', (payload) => this.handleAnswer(payload));
    this.socket.on('webrtc:candidate', (payload) =>
      this.handleCandidate(payload)
    );

    this.iceServers = await getIceServers();
  }

  async connectToPeers(users, selfSocketId) {
    const targets = users
      .filter((user) => user.socketId && user.socketId !== selfSocketId)
      .map((user) => user.socketId);

    for (const targetId of targets) {
      if (this.peers.has(targetId)) continue;
      // One side creates the offer to avoid glare when both peers would negotiate.
      if (selfSocketId < targetId) {
        await this.callPeer(targetId);
      }
    }
  }

  async callPeer(peerId) {
    const pc = this.createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit('webrtc:offer', { targetId: peerId, sdp: offer });
  }

  createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:candidate', {
          targetId: peerId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      this.remoteStreams.set(peerId, stream);
      this.renderRemoteStream(peerId, stream);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.removePeer(peerId);
      }
    };

    return pc;
  }

  async handleOffer({ fromId, sdp }) {
    const pc = this.createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit('webrtc:answer', { targetId: fromId, sdp: answer });
  }

  async handleAnswer({ fromId, sdp }) {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async handleCandidate({ fromId, candidate }) {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Ignore invalid candidates
    }
  }

  toggleMute() {
    if (!this.localStream) return false;
    const enabled = this.localStream.getAudioTracks().some((track) => track.enabled);
    const nextEnabled = !enabled;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    return !nextEnabled;
  }

  async toggleScreenShare() {
    if (this.screenStream) {
      this.stopScreenShare();
      return false;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      const screenTrack = this.screenStream.getVideoTracks()[0];

      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          pc.addTrack(screenTrack, this.screenStream);
        }
      });

      screenTrack.onended = () => this.stopScreenShare();
      if (typeof this.onScreenShareChange === 'function') {
        this.onScreenShareChange(true, this.screenStream);
      }
      return true;
    } catch (err) {
      showToast('Screen share failed', 'error');
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    const track = this.screenStream.getTracks()[0];
    if (track) track.stop();

    this.peers.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        try {
          sender.replaceTrack(null);
        } catch (err) {
          if (sender.track) sender.track.stop();
        }
      }
    });

    this.screenStream = null;
    if (typeof this.onScreenShareChange === 'function') {
      this.onScreenShareChange(false, null);
    }
  }

  renderRemoteStream(peerId, stream) {
    if (!this.remoteContainer) return;
    let element = this.remoteContainer.querySelector(
      `[data-peer="${peerId}"]`
    );

    if (!element) {
      element = document.createElement(stream.getVideoTracks().length ? 'video' : 'audio');
      element.dataset.peer = peerId;
      element.className = 'remote-video';
      element.autoplay = true;
      element.playsInline = true;
      this.remoteContainer.appendChild(element);
    }

    element.srcObject = stream;
    if (typeof this.onRemoteStream === 'function') {
      this.onRemoteStream(peerId, stream, element);
    }
  }

  removePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }

    this.remoteStreams.delete(peerId);
    const element = this.remoteContainer?.querySelector(`[data-peer="${peerId}"]`);
    if (element) element.remove();
    if (typeof this.onRemoteRemoved === 'function') {
      this.onRemoteRemoved(peerId);
    }
  }

  getRemoteStream(peerId) {
    return this.remoteStreams.get(peerId) || null;
  }

  getScreenStream() {
    return this.screenStream || null;
  }
}
