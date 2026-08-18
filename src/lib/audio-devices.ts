/**
 * Gerencia dispositivos de áudio — enumera mics, seleciona o melhor automaticamente
 * e permite seleção manual do usuário.
 */

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput" | "audiotrack";
}

const AUDIO_DEVICE_STORAGE_KEY = "dexy_selected_audio_device";

/**
 * Enumerae todos os devices de áudio disponíveis
 */
export async function enumerateAudioDevices(): Promise<AudioDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || `Mic ${device.deviceId.substring(0, 5)}`,
        kind: device.kind as "audioinput",
      }));
  } catch (err) {
    console.error("Erro ao enumerar devices de áudio:", err);
    return [];
  }
}

/**
 * Detecta automaticamente o "melhor" mic disponível.
 * Heurística:
 * 1. Procura por "headset" ou "headphone" (qualidade alta)
 * 2. Depois procura por "microphone" explícito
 * 3. Ignora "default" e "communication" (são aliases, não real)
 * 4. Fallback para o primeiro mic se nenhum match
 */
export async function detectBestAudioDevice(): Promise<AudioDevice | null> {
  const devices = await enumerateAudioDevices();
  if (devices.length === 0) return null;

  // Score cada device
  let bestDevice = devices[0];
  let bestScore = -1;

  for (const device of devices) {
    const label = device.label.toLowerCase();
    let score = 0;

    // Alta qualidade: headset, headphone, external
    if (label.includes("headset") || label.includes("headphone")) score = 100;
    // Qualidade média: mic explícito, usb
    else if (label.includes("microphone") || label.includes("usb")) score = 50;
    // Qualidade baixa: default, communication, webcam
    else if (
      label.includes("default") ||
      label.includes("communication") ||
      label.includes("webcam") ||
      label.includes("camera")
    )
      score = -10;
    // Qualidade desconhecida: assume 25
    else score = 25;

    if (score > bestScore) {
      bestScore = score;
      bestDevice = device;
    }
  }

  return bestDevice;
}

/**
 * Pega o device selecionado do usuário, ou auto-detects se nunca selecionou
 */
export async function getSelectedAudioDevice(): Promise<AudioDevice | null> {
  const saved = localStorage.getItem(AUDIO_DEVICE_STORAGE_KEY);
  if (saved) {
    const devices = await enumerateAudioDevices();
    const found = devices.find((d) => d.deviceId === saved);
    if (found) return found;
  }

  // Auto-detect
  return detectBestAudioDevice();
}

/**
 * Salva a escolha do usuário
 */
export function saveSelectedAudioDevice(deviceId: string) {
  localStorage.setItem(AUDIO_DEVICE_STORAGE_KEY, deviceId);
}

/**
 * Limpa a seleção (volta para auto-detect)
 */
export function clearSelectedAudioDevice() {
  localStorage.removeItem(AUDIO_DEVICE_STORAGE_KEY);
}
