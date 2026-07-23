/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dialog from '../src/components/common/Dialog/Dialog';

describe('Dialog', () => {
    test('renders with dialog semantics and aria-labelledby pointing at the title', () => {
        render(
            <Dialog id='dlg' title='My Title' onClose={() => {}}>
                <p>body</p>
            </Dialog>,
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        const heading = screen.getByRole('heading', { name: 'My Title' });
        expect(heading.id).toBe('dlg-title');
        expect(dialog).toHaveAttribute('aria-labelledby', 'dlg-title');
    });

    test('Escape does NOT close when dismissable is not set (default — preserves existing behaviour)', () => {
        const onClose = jest.fn();
        render(<Dialog title='T' onClose={onClose}><p>x</p></Dialog>);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).not.toHaveBeenCalled();
        // aria-modal is driven by the `modal` prop, not dismissable.
        expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    });

    test('Escape closes when dismissable is set', () => {
        const onClose = jest.fn();
        render(<Dialog title='T' onClose={onClose} dismissable><p>x</p></Dialog>);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
        // dismissable alone does not set aria-modal.
        expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    });
});
