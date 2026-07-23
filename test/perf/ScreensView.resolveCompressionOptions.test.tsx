/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { resolveCompressionOptions } from '../../src/utils/mediaCompression/compressionPresets';
import { MediaCompressionPresets } from '../../src/utils/mediaCompression/compressionTypes';

test('resolveCompressionOptions allocates a fresh object every call (the bug)', () => {
    const presets: MediaCompressionPresets = { image: 'medium', audio: 'low', video: 'low' };
    const a = resolveCompressionOptions(presets);
    const b = resolveCompressionOptions(presets);
    expect(a).not.toBe(b);           // fresh allocation
    expect(a).toEqual(b);            // but equal by value
});

test('useMemo over presets gives referential stability across renders', () => {
    const presets = { image: 'medium' as const, audio: 'low' as const, video: 'low' as const };

    let memoizedResult: ReturnType<typeof resolveCompressionOptions> | null = null;
    let renderCount = 0;

    function Surrogate({ presets }: { presets: MediaCompressionPresets }) {
        const opts = React.useMemo(() => resolveCompressionOptions(presets), [presets]);
        renderCount += 1;
        memoizedResult = opts;
        return null;
    }

    const { rerender } = render(<Surrogate presets={presets} />);
    const firstResult = memoizedResult;
    expect(renderCount).toBe(1);
    expect(firstResult).not.toBeNull();

    rerender(<Surrogate presets={presets} />);
    expect(renderCount).toBe(2);
    expect(memoizedResult).toBe(firstResult);

    const newPresets = { ...presets };
    rerender(<Surrogate presets={newPresets} />);
    expect(renderCount).toBe(3);
    expect(memoizedResult).not.toBe(firstResult);
});
