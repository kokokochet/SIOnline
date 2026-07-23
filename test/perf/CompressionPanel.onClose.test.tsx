/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render } from '@testing-library/react';

function Child({ onClose }: { onClose: () => void }) {
    const [runs, setRuns] = React.useState(0);
    React.useEffect(() => {
        setRuns(r => r + 1);
    }, [onClose]);
    return <div data-testid="runs">{runs}</div>;
}

function Parent({ useCallback: useCb }: { useCallback: boolean }) {
    const [, setOpen] = React.useState(false);
    const inlineOnClose = () => setOpen(false);
    const stableOnClose = React.useCallback(() => setOpen(false), []);
    return <Child onClose={useCb ? stableOnClose : inlineOnClose} />;
}

test('inline onClose re-runs the child effect on every parent render; useCallback does not', () => {
    const { rerender: rerenderInline, container: inlineContainer } = render(<Parent useCallback={false} />);
    rerenderInline(<Parent useCallback={false} />);
    rerenderInline(<Parent useCallback={false} />);
    expect(Number(inlineContainer.textContent)).toBe(3);

    const { rerender: rerenderCb, container: cbContainer } = render(<Parent useCallback={true} />);
    rerenderCb(<Parent useCallback={true} />);
    rerenderCb(<Parent useCallback={true} />);
    expect(Number(cbContainer.textContent)).toBe(1);
});
