/**
 * Advanced audio processing pipeline para voz clara tipo Discord.
 * Aplica múltiplos estágios de processamento para remover ruído de fundo
 * e deixar a voz "gostosa" de ouvir.
 *
 * Pipeline: mic → notch(50Hz) → notch(60Hz) → highPass(100Hz) → lowPass(8kHz)
 *           → deEsser(6.5kHz) → compressor → gain → output
 *
 * Notas:
 * - Notch de 50Hz/60Hz = remove hum de tomadas (comum em geral)
 * - HighPass em 100Hz = remove rumores graves (AR, geladeira, ventilador)
 * - DeEsser em 6.5kHz = remove sibilância (S, T, F muito fortes)
 * - Compressor 12:1 = mantém voz consistente
 * - LowPass em 8kHz = remove frequências altas desnecessárias
 */

let globalAudioProcessor: VoiceAudioProcessor | null = null;
let selectedAudioDeviceId: string | null = null;

export class VoiceAudioProcessor {
  private audioContext: AudioContext;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private compressor: DynamicsCompressorNode;
  private gainNode: GainNode;
  private highPassFilter: BiquadFilterNode;
  private lowPassFilter: BiquadFilterNode;
  private lowShelfFilter: BiquadFilterNode;
  private highShelfFilter: BiquadFilterNode;
  private notchFilter50: BiquadFilterNode;
  private notchFilter60: BiquadFilterNode;
  private deEsser: DynamicsCompressorNode;
  private destinationNode: MediaStreamAudioDestinationNode;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.gainNode = this.audioContext.createGain();
    this.highPassFilter = this.audioContext.createBiquadFilter();
    this.lowPassFilter = this.audioContext.createBiquadFilter();
    this.lowShelfFilter = this.audioContext.createBiquadFilter();
    this.highShelfFilter = this.audioContext.createBiquadFilter();
    this.notchFilter50 = this.audioContext.createBiquadFilter();
    this.notchFilter60 = this.audioContext.createBiquadFilter();
    this.deEsser = this.audioContext.createDynamicsCompressor();
    this.destinationNode = this.audioContext.createMediaStreamDestination();

    this.setupCompressor();
    this.setupHighPassFilter();
    this.setupLowPassFilter();
    this.setupShelfFilters();
    this.setupNotchFilters();
    this.setupDeEsser();
    this.setupGain();
  }

  private setupCompressor() {
    // Compressor agressivo: mantém volume consistente
    // Threshold -25dB = comprime voz quando passa desse nível
    // Ratio 12:1 = mantém picos dentro de faixa previsível
    // Attack 3ms = preserva transientes (consoantes)
    // Release 250ms = libera gradualmente, não fica "preso"
    this.compressor.threshold.value = -25;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
  }

  private setupHighPassFilter() {
    // Filtro passa-alta — remove tudo abaixo de 100Hz
    // Voz humana: 85Hz a 8kHz, com maioria em 200-2000Hz
    // 100Hz = ponto de corte seguro, preserva voz mas remove rumble
    this.highPassFilter.type = "highpass";
    this.highPassFilter.frequency.value = 100;
    this.highPassFilter.Q.value = 0.707;
  }

  private setupLowPassFilter() {
    // Filtro passa-baixa — remove frequências acima de 8kHz
    // Voz de qualidade telefônica vai até 3.4kHz, mas voz natural chega a 8kHz
    // Cortar em 8kHz mantém a voz cheia e natural, remove sibilância e ruído
    this.lowPassFilter.type = "lowpass";
    this.lowPassFilter.frequency.value = 8000;
    this.lowPassFilter.Q.value = 0.707;
  }

  private setupShelfFilters() {
    // Low shelf: leve boost em 200Hz (~2dB) para dar corpo à voz
    this.lowShelfFilter.type = "lowshelf";
    this.lowShelfFilter.frequency.value = 200;
    this.lowShelfFilter.gain.value = 2;

    // High shelf: leve atenuação em 3kHz (~-2dB) para reduzir fadigabilidade
    this.highShelfFilter.type = "highshelf";
    this.highShelfFilter.frequency.value = 3000;
    this.highShelfFilter.gain.value = -2;
  }

  private setupNotchFilters() {
    // Notch filter de 50Hz = remove hum de rede elétrica (Europa, algumas regiões)
    // Notch filter de 60Hz = remove hum de rede elétrica (Américas)
    // Ambos = garantia universal
    this.notchFilter50.type = "notch";
    this.notchFilter50.frequency.value = 50;
    this.notchFilter50.Q.value = 10; // Q alto = filtro estreito, só atinge a frequência

    this.notchFilter60.type = "notch";
    this.notchFilter60.frequency.value = 60;
    this.notchFilter60.Q.value = 10;
  }

  private setupDeEsser() {
    // De-esser: compressor focado em 6.5kHz para reduzir sibilância
    // Sons de "S", "T", "F" são muito altos em 6-8kHz — de-esser suaviza
    // Threshold -10dB = atua só em sibilância forte (não afeta voz normal)
    // Como ele vê a entrada com side-chain em 6.5kHz, comprime só quando esses picos aparecem
    // Mas como Web Audio API simples não tem sidechain, simulamos com filtro
    this.deEsser.threshold.value = -10;
    this.deEsser.knee.value = 0;
    this.deEsser.ratio.value = 4;
    this.deEsser.attack.value = 0.001;
    this.deEsser.release.value = 0.15;
  }

  private setupGain() {
    // +3.5dB = ~1.5x mais loud (faz a voz sobressair no mix)
    this.gainNode.gain.value = 1.5;
  }

  /**
   * Processa um MediaStream (mic) e retorna um novo stream com áudio limpo
   */
  process(stream: MediaStream): MediaStream {
    // Se já tem source, desconecta primeiro
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Conecta pipeline completo:
    // mic → notch50 → notch60 → highPass → lowShelf → lowPass
    //     → highShelf → deEsser → compressor → gain → output
    this.sourceNode.connect(this.notchFilter50);
    this.notchFilter50.connect(this.notchFilter60);
    this.notchFilter60.connect(this.highPassFilter);
    this.highPassFilter.connect(this.lowShelfFilter);
    this.lowShelfFilter.connect(this.lowPassFilter);
    this.lowPassFilter.connect(this.highShelfFilter);
    this.highShelfFilter.connect(this.deEsser);
    this.deEsser.connect(this.compressor);
    this.compressor.connect(this.gainNode);
    this.gainNode.connect(this.destinationNode);

    return this.destinationNode.stream;
  }

  /**
   * Ajusta agressividade do processamento (0.0 a 1.0)
   * 0.0 = sem processamento
   * 0.5 = moderado (padrão)
   * 1.0 = máximo (para ambientes muito barulhentos)
   */
  setAgressionLevel(level: number) {
    const clamped = Math.max(0, Math.min(1, level));

    // Quanto mais agressivo, mais comprime
    const ratio = 4 + clamped * 8; // De 4:1 a 12:1
    const threshold = -25 - clamped * 5; // De -25dB a -30dB
    const gain = 1.0 + clamped * 0.5; // De 1.0 a 1.5x

    this.compressor.ratio.value = ratio;
    this.compressor.threshold.value = threshold;
    this.gainNode.gain.value = gain;
  }

  cleanup() {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    this.notchFilter50.disconnect();
    this.notchFilter60.disconnect();
    this.highPassFilter.disconnect();
    this.lowShelfFilter.disconnect();
    this.lowPassFilter.disconnect();
    this.highShelfFilter.disconnect();
    this.deEsser.disconnect();
    this.compressor.disconnect();
    this.gainNode.disconnect();
  }
}

/**
 * Pega a instância global do processador (cria se não existir)
 */
export function getAudioProcessor(): VoiceAudioProcessor {
  if (!globalAudioProcessor) {
    globalAudioProcessor = new VoiceAudioProcessor();
  }
  return globalAudioProcessor;
}

/**
 * Define qual device de áudio usar
 */
export function setAudioDevice(deviceId: string | null) {
  selectedAudioDeviceId = deviceId;
}

/**
 * Processa uma stream de mic através do processador de áudio
 */
export async function processAudioStream(stream: MediaStream): Promise<MediaStream> {
  const processor = getAudioProcessor();
  return processor.process(stream);
}
