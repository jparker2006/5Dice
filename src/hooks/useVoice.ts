"use client";
/**
 * React binding for VoiceChat. Shares the game's RoomClient socket for
 * signaling. Voice is optional and isolated — nothing here can affect the game.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomClient } from "@/lib/gameClient";
import { VoiceChat } from "@/lib/voice";
import type { PlayerId } from "@/protocol";

export interface VoiceState {
  supported: boolean;
  micOn: boolean;
  speakerOn: boolean;
  /** True when at least one peer's audio is coming through. */
  remoteAudio: boolean;
  toggleMic: () => void;
  toggleSpeaker: () => void;
}

const VOICE_SUPPORTED =
  typeof window !== "undefined" &&
  typeof RTCPeerConnection !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export function useVoice(
  client: RoomClient | null,
  myId: PlayerId,
  peerIds: PlayerId[],
): VoiceState {
  const [micOn, setMicOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [remoteAudio, setRemoteAudio] = useState(false);
  const voiceRef = useRef<VoiceChat | null>(null);
  // Latest peers, written only in effects (never during render).
  const peersRef = useRef<string>("");
  const peersKey = peerIds.slice().sort().join(",");

  useEffect(() => {
    if (!client || !VOICE_SUPPORTED) return;
    const chat = new VoiceChat(myId, {
      sendSignal: (to, signal) => client.sendVoiceSignal(to, signal),
      onRemoteAudioChange: setRemoteAudio,
    });
    voiceRef.current = chat;
    chat.setPeers(peersRef.current ? peersRef.current.split(",") : []);
    const off = client.on("voiceSignal", (from, signal) => {
      void chat.onSignal(from, signal);
    });
    return () => {
      off();
      chat.destroy();
      voiceRef.current = null;
      setMicOn(false);
      setRemoteAudio(false);
    };
  }, [client, myId]);

  // Keep the peer mesh in sync with the room's seating.
  useEffect(() => {
    peersRef.current = peersKey;
    voiceRef.current?.setPeers(peersKey ? peersKey.split(",") : []);
  }, [peersKey]);

  return useMemo(
    () => ({
      supported: VOICE_SUPPORTED,
      micOn,
      speakerOn,
      remoteAudio,
      toggleMic: () => {
        const voice = voiceRef.current;
        if (!voice) return;
        if (micOn) {
          voice.disableMic();
          setMicOn(false);
        } else {
          void voice.enableMic().then((ok) => setMicOn(ok));
        }
      },
      toggleSpeaker: () => {
        const voice = voiceRef.current;
        if (!voice) return;
        const next = !speakerOn;
        voice.setSpeaker(next);
        setSpeakerOn(next);
      },
    }),
    [micOn, speakerOn, remoteAudio],
  );
}
