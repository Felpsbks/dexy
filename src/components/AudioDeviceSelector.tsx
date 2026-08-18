import { useEffect, useState } from "react";
import { ChevronUp, Mic, Volume2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AudioDevice } from "@/lib/audio-devices";
import {
  enumerateAudioDevices,
  detectBestAudioDevice,
  getSelectedAudioDevice,
  saveSelectedAudioDevice,
} from "@/lib/audio-devices";

/**
 * Seletor de dispositivo de áudio (microfone)
 * Botão chevron sutil ao lado do mic (estilo Discord)
 */
export function AudioDeviceSelector() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [bestDeviceId, setBestDeviceId] = useState<string>("");
  const [open, setOpen] = useState(false);

  // Carregar devices disponíveis
  useEffect(() => {
    const loadDevices = async () => {
      setLoading(true);
      const audioDevices = await enumerateAudioDevices();
      setDevices(audioDevices);

      const best = await detectBestAudioDevice();
      if (best) {
        setBestDeviceId(best.deviceId);
        const selected = await getSelectedAudioDevice();
        const deviceId = selected?.deviceId || best.deviceId;
        setSelectedDeviceId(deviceId);
      }

      setLoading(false);
    };

    loadDevices();

    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
    };
  }, []);

  const handleSelect = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    saveSelectedAudioDevice(deviceId);
    setOpen(false);
  };

  if (loading || devices.length <= 1) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Alterar microfone"
          className="p-1 rounded hover:bg-secondary transition text-muted-foreground hover:text-foreground -ml-1"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" side="top" align="start">
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Mic className="w-3 h-3" />
            Dispositivo de entrada
          </div>

          {devices.map((device) => {
            const isSelected = device.deviceId === selectedDeviceId;
            const isBest = device.deviceId === bestDeviceId;
            return (
              <button
                key={device.deviceId}
                onClick={() => handleSelect(device.deviceId)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded text-sm text-left transition ${
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-secondary text-foreground"
                }`}
              >
                <div className="flex-1 truncate">{device.label}</div>
                {isBest && (
                  <span title="Melhor qualidade" className="shrink-0">
                    <Volume2 className="w-3.5 h-3.5 text-green-500" />
                  </span>
                )}
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
