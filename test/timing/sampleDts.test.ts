import { SampleDtsAccumulator } from '../../src/utils/mediaCompression/sampleDts';

test('SampleDtsAccumulator bounds cumulative drift to < 1 µs over 60s of 44.1 kHz audio', () => {
    const timescale = 44100;
    const frameCount = Math.floor((60 * 44100) / 1024);
    const sampleDuration = 1024; // AAC frame duration in timescale units

    const acc = new SampleDtsAccumulator(timescale);
    let totalDurationMicros = 0;
    for (let i = 0; i < frameCount; i += 1) {
        totalDurationMicros += acc.advance(sampleDuration);
    }

    const exactTotalMicros = (frameCount * sampleDuration) * 1_000_000 / timescale;
    const driftMicros = Math.abs(totalDurationMicros - exactTotalMicros);

    expect(driftMicros).toBeLessThan(1);
});

test('SampleDtsAccumulator: first sample duration is the rounded frame duration', () => {
    const acc = new SampleDtsAccumulator(1000);
    expect(acc.advance(100)).toBe(100_000);
    expect(acc.advance(100)).toBe(100_000);
});

test('SampleDtsAccumulator: throws on non-positive timescale', () => {
    expect(() => new SampleDtsAccumulator(0)).toThrow(/timescale/);
    expect(() => new SampleDtsAccumulator(-1)).toThrow(/timescale/);
});
