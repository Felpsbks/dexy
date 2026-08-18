/**
 * Hook para aplicar processamento de áudio avançado em chamadas de voz.
 * Intercepta getUserMedia para aplicar processamento Web Audio API
 * ANTES do LiveKit SDK publicar a track.
 *
 * Cadeia: mic → highPass → lowPass → compressor → gain → LiveKit
 */

import { useEffect, useRef } from "react";
import { getAudioProcessor } from "./audio-processor";
import type { VoiceRoomHook } from "./livekit";

// Singleton: garante que só override uma vez mesmo com múltiplos hooks
let overrideInstalled = false;
let originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

function installAudioProcessingOverride() {
  if (overrideInstalled) return;
  overrideInstalled = true;

  originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async function (
    constraints?: MediaStreamConstraints,
  ): Promise<MediaStream> {
    const stream = await originalGetUserMedia!(constraints);

    // Só processa se é audio-only request (não processa video+audio combinado
    // porque isso é camera/screenshare, não mic isolado)
    if (constraints?.audio && !constraints?.video) {
      try {
        const processor = getAudioProcessor();
        return processor.process(stream);
      } catch (err) {
        console.warn("[VoiceProcessor] Falha no processamento, usando mic raw:", err);
        return stream;
      }
    }

    return stream;
  };
}

function uninstallAudioProcessingOverride() {
  if (!overrideInstalled || !originalGetUserMedia) return;
  navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  originalGetUserMedia = null;
  overrideInstalled = false;
}

/**
 * Aplica processamento de áudio para voice rooms (canais de voz)
 */
export function useVoiceAudioProcessing(voiceHook: VoiceRoomHook | null) {
  const activeRef = useRef(false);

  useEffect(() => {
    const connected = voiceHook?.status === "connected";

    if (connected && !activeRef.current) {
      activeRef.current = true;
      installAudioProcessingOverride();
    }

    if (!connected && activeRef.current) {
      activeRef.current = false;
      // Não remove o override aqui — pode ter DM call ativa também
    }
  }, [voiceHook?.status]);

  // Cleanup total quando o componente desmonta
  useEffect(() => {
    return () => {
      activeRef.current = false;
    };
  }, []);
}

/**
 * Aplica processamento de áudio para DM calls (chamadas 1:1)
 */
export function useDmAudioProcessing(dmCallStatus: string) {
  const activeRef = useRef(false);

  useEffect(() => {
    const inCall = dmCallStatus === "active" || dmCallStatus === "connecting" || dmCallStatus === "outgoing";

    if (inCall && !activeRef.current) {
      activeRef.current = true;
      installAudioProcessingOverride();
    }

    if (!inCall && activeRef.current) {
      activeRef.current = false;
      // Não remove override — pode ter voice room ativa
    }
  }, [dmCallStatus]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
    };
  }, []);
}

// Remove override quando NENHUM dos hooks está ativo (chamado pelo app cleanup)
export function cleanupAudioProcessing() {
  uninstallAudioProcessingOverride();
  getAudioProcessor().cleanup();
}
