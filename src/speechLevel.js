const TARGET_RMS = 10 ** (-20 / 20);
const MAX_GAIN = 10 ** (12 / 20);
const PEAK_CEILING = 10 ** (-1 / 20);
const SILENCE_POWER = 10 ** (-60 / 10);

// Estimate active speech level, excluding pauses. One gain per sentence preserves
// its dynamics; this is gated RMS, not a frequency-weighted LUFS measurement.
export function speechGain(audio) {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const blockSize = Math.round(audio.sampleRate * 0.02);
  const blocks = [];
  let peak = 0, audibleEnergy = 0, audibleSamples = 0;
  for (let start = 0; start < audio.length; start += blockSize) {
    const end = Math.min(start + blockSize, audio.length);
    const count = (end - start) * channels.length;
    let energy = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index++) {
        const sample = channel[index];
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    if (energy / count > SILENCE_POWER) {
      blocks.push({ energy, count });
      audibleEnergy += energy;
      audibleSamples += count;
    }
  }
  if (!audibleSamples) return 1;
  const gate = audibleEnergy / audibleSamples * 0.1;
  let speechEnergy = 0, speechSamples = 0;
  for (const { energy, count } of blocks) {
    if (energy / count >= gate) { speechEnergy += energy; speechSamples += count; }
  }
  const rms = Math.sqrt(speechEnergy / speechSamples);
  return Math.min(TARGET_RMS / rms, MAX_GAIN, PEAK_CEILING / peak);
}
