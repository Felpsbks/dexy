/**
 * Hook para aplicar processamento de áudio avançado em chamadas de voz.
 * Intercepta getUserMedia para:
 * 1. Forçar o deviceId selecionado pelo usuário (não pegar mic da câmera)
 * 2. Aplicar processamento Web Audio API (compressão, EQ, filtros)
 *
 * Cadeia: mic correto → highPass → lowPass → compressor → gain → LiveKit
 */

import { useEffect, useRef } from "react";
import { getAudioProcessor } from "./audio-processor";
import { getSelectedAudioDevice } from "./audio-devices";
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
    // Só processa se é audio-only request (não processa video+audio combinado
    // porque isso é camera/screenshare, não mic isolado)
    if (constraints?.audio && !constraints?.video) {
      // Injetar o deviceId selecionado pelo usuário
      const selectedDevice = await getSelectedAudioDevice();
      if (selectedDevice) {
        const audioConstraints =
          typeof constraints.audio === "object" ? { ...constraints.audio } : {};
        audioConstraints.deviceId = { exact: selectedDevice.deviceId };
        constraints = { ...constraints, audio: audioConstraints };
      }

      const stream = await originalGetUserMedia!(constraints);

      // Aplicar processamento de áudio
      try {
        const processor = getAudioProcessor();
        return processor.process(stream);
      } catch (err) {
        console.warn("[VoiceProcessor] Falha no processamento, usando mic raw:", err);
        return stream;
      }
    }

    return originalGetUserMedia!(constraints);
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
    }
  }, [voiceHook?.status]);

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
