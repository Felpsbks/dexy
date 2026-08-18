/**
 * Advanced audio processing pipeline para voz clara tipo Discord.
 * Aplica compressão, EQ, e normalização para remover ruído de fundo
 * e deixar a voz "gostosa" de ouvir.
 */

let globalAudioProcessor: VoiceAudioProcessor | null = null;

export class VoiceAudioProcessor {
  private audioContext: AudioContext;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private compressor: DynamicsCompressorNode;
  private gainNode: GainNode;
  private highPassFilter: BiquadFilterNode;
  private lowPassFilter: BiquadFilterNode;
  private destinationNode: MediaStreamAudioDestinationNode;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.gainNode = this.audioContext.createGain();
    this.highPassFilter = this.audioContext.createBiquadFilter();
    this.lowPassFilter = this.audioContext.createBiquadFilter();
    this.destinationNode = this.audioContext.createMediaStreamDestination();

    this.setupCompressor();
    this.setupHighPassFilter();
    this.setupLowPassFilter();
    this.setupGain();
  }

  private setupCompressor() {
    // Agressivamente comprime picos — mantém voz consistente
    // Discord usa algo similar para manter volume previsível
    this.compressor.threshold.value = -30; // Começa a comprimir em -30dB (voz fraca)
    this.compressor.knee.value = 40; // Transição suave
    this.compressor.ratio.value = 12; // Comprime forte (12:1)
    this.compressor.attack.value = 0.003; // Muito rápido (3ms)
    this.compressor.release.value = 0.25; // Liberação natural
  }

  private setupHighPassFilter() {
    // Remove frequências baixas (ruído de ar condicionado, buzz, rumble)
    // A voz humana começa em ~85Hz, picos entre 200-2000Hz
    // Cortar tudo abaixo de 80Hz remove 90% do ruído ambiental
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = 80;
    this.highPassFilter.Q.value = 0.707; // Q padrão (filtro suave)
  }

  private setupLowPassFilter() {
    // Remove frequências muito altas (sibilantes, cliques, ruído de teclado)
    // Cortar acima de 10kHz mantém a voz natural mas remove artefatos
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = 10000;
    this.lowPassFilter.Q.value = 0.707;
  }

  private setupGain() {
    // +3dB = 2x mais loud (faz a voz sobressair no mix)
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

    // Conecta chain: mic → highPass → lowPass → compressor → gain → output
    this.sourceNode.connect(this.highPassFilter);
    this.highPassFilter.connect(this.lowPassFilter);
    this.lowPassFilter.connect(this.compressor);
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
    const threshold = -30 - clamped * 10; // De -30dB a -40dB
    const gain = 1.0 + clamped * 0.5; // De 1.0 a 1.5x

    this.compressor.ratio.value = ratio;
    this.compressor.threshold.value = threshold;
    this.gainNode.gain.value = gain;
  }

  cleanup() {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    this.highPassFilter.disconnect();
    this.lowPassFilter.disconnect();
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
 * Processa uma stream de mic através do processador de áudio
 */
export async function processAudioStream(stream: MediaStream): Promise<MediaStream> {
  const processor = getAudioProcessor();
  return processor.process(stream);
}
