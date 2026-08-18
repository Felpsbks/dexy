import { useEffect, useState } from "react";
import { Mic, Volume2, Settings2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudioDevice } from "@/lib/audio-devices";
import {
  enumerateAudioDevices,
  detectBestAudioDevice,
  getSelectedAudioDevice,
  saveSelectedAudioDevice,
} from "@/lib/audio-devices";
import { setAudioDevice } from "@/lib/audio-processor";

/**
 * Seletor de dispositivo de áudio (microfone)
 * Com detecção automática do melhor device
 */
export function AudioDeviceSelector() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [bestDeviceLabel, setBestDeviceLabel] = useState<string>("");
  const [open, setOpen] = useState(false);

  // Carregar devices disponíveis
  useEffect(() => {
    const loadDevices = async () => {
      setLoading(true);
      const audioDevices = await enumerateAudioDevices();
      setDevices(audioDevices);

      // Detectar o melhor
      const best = await detectBestAudioDevice();
      if (best) {
        setBestDeviceLabel(best.label);
        // Se usuário nunca selecionou, usa o melhor
        const selected = await getSelectedAudioDevice();
        setSelectedDeviceId(selected?.deviceId || best.deviceId);
        setAudioDevice(selected?.deviceId || best.deviceId);
      }

      setLoading(false);
    };

    loadDevices();

    // Re-enumerar quando devices mudam (ex: user plugou headset)
    const handleDeviceChange = () => {
      loadDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, []);

  const handleChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    saveSelectedAudioDevice(deviceId);
    setAudioDevice(deviceId);
  };

  if (loading || devices.length === 0) {
    return null;
  }

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId);
  const isBest = selectedDevice?.label === bestDeviceLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Selecionar microfone"
          className="p-2 rounded hover:bg-secondary transition text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4" />
            <h4 className="font-semibold text-sm">Microfone</h4>
          </div>

          <Select value={selectedDeviceId} onValueChange={handleChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione mic..." />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  <div className="flex items-center gap-2">
                    <span>{device.label}</span>
                    {device.label === bestDeviceLabel && (
                      <Volume2 className="w-3 h-3 text-green-500" title="Melhor qualidade" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isBest && (
            <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              Ótima qualidade detectada
            </div>
          )}

          {!isBest && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              💡 Dica: Use o mic com ✓ para melhor qualidade
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
