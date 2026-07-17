"use client";
/**
 * WebRTC voice chat: a small audio mesh between the players in a room.
 *
 * Signaling is relayed through the game room server (see the voice-signal
 * protocol messages) — no public MQTT, no public TURN. STUN is Google's public
 * server; without TURN, players behind symmetric NATs may not connect, and
 * that's fine: **voice is fully isolated from the game.** Every failure path
 * here is swallowed so a broken mic or a failed peer connection can never
 * affect game state or reconnection.
 *
 * One RTCPeerConnection and one <audio> element per remote peer (the legacy app
 * funneled every peer into a single shared element — a real bug in 3+ player
 * games, fixed here). Connection state is mirrored onto each audio element's
 * dataset so the harness can assert "connected" without reaching into internals.
 */
import type { PlayerId, VoiceSignal } from "@/protocol";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement;
}

export interface VoiceCallbacks {
  sendSignal: (to: PlayerId, signal: VoiceSignal) => void;
  /** Fired when the set of peers we're hearing audio from changes. */
  onRemoteAudioChange?: (anyRemoteAudio: boolean) => void;
}

export class VoiceChat {
  private peers = new Map<PlayerId, Peer>();
  private localStream: MediaStream | null = null;
  private container: HTMLDivElement;
  micEnabled = false;
  speakerEnabled = true;

  constructor(
    private myId: PlayerId,
    private cb: VoiceCallbacks,
  ) {
    this.container = document.createElement("div");
    this.container.style.display = "none";
    this.container.dataset.voiceContainer = "";
    document.body.appendChild(this.container);
  }

  /** Reconcile the peer set with the current room seating. */
  setPeers(peerIds: PlayerId[]): void {
    for (const pid of peerIds) {
      if (pid !== this.myId && !this.peers.has(pid)) this.createPeer(pid);
    }
    for (const pid of [...this.peers.keys()]) {
      if (!peerIds.includes(pid)) this.closePeer(pid);
    }
  }

  async enableMic(): Promise<boolean> {
    try {
      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      this.micEnabled = true;
      for (const peer of this.peers.values()) this.addLocalTracks(peer);
      return true;
    } catch {
      // Permission denied / no device — the game plays on untouched.
      this.micEnabled = false;
      return false;
    }
  }

  disableMic(): void {
    this.micEnabled = false;
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track) {
          sender.track.enabled = false;
          try {
            peer.pc.removeTrack(sender);
          } catch {
            /* ignore */
          }
        }
      }
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  setSpeaker(enabled: boolean): void {
    this.speakerEnabled = enabled;
    for (const peer of this.peers.values()) peer.audio.muted = !enabled;
  }

  /** Handle an inbound signal (perfect negotiation). Never throws. */
  async onSignal(from: PlayerId, signal: VoiceSignal): Promise<void> {
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const { pc } = peer;
    try {
      if (signal.kind === "description") {
        const description: RTCSessionDescriptionInit = {
          type: signal.sdpType,
          sdp: signal.sdp,
        };
        const collision =
          description.type === "offer" &&
          (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.sendDescription(from, pc);
        }
      } else {
        try {
          await pc.addIceCandidate({
            candidate: signal.candidate,
            sdpMid: signal.sdpMid ?? undefined,
            sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
            usernameFragment: signal.usernameFragment ?? undefined,
          });
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch {
      // Voice must never break the game — drop the bad signal.
    }
  }

  destroy(): void {
    for (const pid of [...this.peers.keys()]) this.closePeer(pid);
    this.disableMic();
    this.container.remove();
  }

  // ---- internals ----------------------------------------------------------

  private createPeer(pid: PlayerId): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.muted = !this.speakerEnabled;
    audio.dataset.voicePeer = pid;
    audio.dataset.state = "new";
    this.container.appendChild(audio);

    const peer: Peer = { pc, polite: this.myId < pid, makingOffer: false, ignoreOffer: false, audio };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(pid, pc);
      } catch {
        /* ignore — voice must never break the game */
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.sendSignal(pid, {
          kind: "candidate",
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        });
      }
    };
    pc.ontrack = ({ streams }) => {
      audio.srcObject = streams[0] ?? null;
      this.notifyRemoteAudio();
    };
    pc.onconnectionstatechange = () => {
      audio.dataset.state = pc.connectionState;
      if (pc.connectionState === "failed") {
        // A dropped voice link self-heals via ICE restart; ignore failures.
        try {
          pc.restartIce();
        } catch {
          /* ignore */
        }
      }
      this.notifyRemoteAudio();
    };

    this.peers.set(pid, peer);
    if (this.micEnabled) this.addLocalTracks(peer);
    return peer;
  }

  private addLocalTracks(peer: Peer): void {
    if (!this.localStream) return;
    const hasAudio = peer.pc.getSenders().some((s) => s.track?.kind === "audio");
    if (hasAudio) return;
    // Adding a track fires onnegotiationneeded → offer.
    for (const track of this.localStream.getTracks()) {
      peer.pc.addTrack(track, this.localStream);
    }
  }

  private sendDescription(to: PlayerId, pc: RTCPeerConnection): void {
    const d = pc.localDescription;
    if (!d) return;
    this.cb.sendSignal(to, { kind: "description", sdpType: d.type, sdp: d.sdp });
  }

  private closePeer(pid: PlayerId): void {
    const peer = this.peers.get(pid);
    if (!peer) return;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(pid);
    this.notifyRemoteAudio();
  }

  private notifyRemoteAudio(): void {
    const any = [...this.peers.values()].some(
      (p) => p.pc.connectionState === "connected" && p.audio.srcObject !== null,
    );
    this.cb.onRemoteAudioChange?.(any);
  }
}
