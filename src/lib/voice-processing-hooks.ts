/**
 * Hook para aplicar processamento de áudio avançado em chamadas de voz.
 * Intercepta getUserMedia para:
 * 1. Forçar o deviceId selecionado pelo usuário (não pegar mic da câmera)
 * 2. Aplicar processamento Web Audio API (compressão, EQ, filtros)
 *
 * IMPORTANTE: O override é instalado IMEDIATAMENTE quando o usuário seleciona
 * um mic (não apenas quando entra na chamada), porque o LiveKit SDK chama
 * getUserMedia() durante o setMicrophoneEnabled() — antes do status mudar para
 * "connected". Instalar depois deixa o mic sem processamento.
 *
 * Cadeia: mic correto → notch50 → notch60 → highPass → lowPass → compressor → gain → LiveKit
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
        // Garante que o AudioContext está rodando (Chrome suspende
        // AudioContext criado sem interação do usuário)
        if (processor.audioContext.state === "suspended") {
          await processor.audioContext.resume();
        }
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
 * Aplica processamento de áudio desde o mount do app — garante que está
 * instalado ANTES que o usuário clique em ativar mic.
 */
export function useGlobalAudioProcessing() {
  useEffect(() => {
    // Instalar IMEDIATAMENTE quando o componente montar
    installAudioProcessingOverride();

    return () => {
      // Não remove no unmount — o app inteiro é o lifecycle
    };
  }, []);
}

/**
 * Mantido para compat — agora o override é global, mas deixamos os hooks
 * de voice/dm para futuras extensões (ex: ajustar agressividade por contexto).
 */
export function useVoiceAudioProcessing(voiceHook: VoiceRoomHook | null) {
  useEffect(() => {
    // Nada — o override já é global via useGlobalAudioProcessing
  }, [voiceHook?.status]);
}

export function useDmAudioProcessing(dmCallStatus: string) {
  useEffect(() => {
    // Nada — o override já é global via useGlobalAudioProcessing
  }, [dmCallStatus]);
}

// Remove override quando o app desmonta (cleanup)
export function cleanupAudioProcessing() {
  uninstallAudioProcessingOverride();
  getAudioProcessor().cleanup();
}
