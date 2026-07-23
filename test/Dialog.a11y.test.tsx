/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dialog from '../src/components/common/Dialog/Dialog';

afterEach(cleanup);

describe('Dialog', () => {
	it('is a dialog with its title as the accessible name', () => {
		const { getByRole } = render(
			<Dialog id='a11y-dlg' title='Compression settings' onClose={jest.fn()}>
				<p>body</p>
			</Dialog>,
		);
		const dialog = getByRole('dialog', { name: 'Compression settings' });
		expect(dialog).toBeInTheDocument();
	});

	it('does not call onClose on Escape when dismissable is not set', () => {
		const onClose = jest.fn();
		render(<Dialog title='T' onClose={onClose} />);
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
	});

	it('calls onClose on Escape when dismissable', () => {
		const onClose = jest.fn();
		render(<Dialog title='T' onClose={onClose} dismissable />);
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('moves focus into the dialog and restores it on close (modal)', () => {
		const trigger = document.createElement('button');
		trigger.textContent = 'open';
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		const { unmount } = render(
			<Dialog title='T' onClose={jest.fn()} modal>
				<button>inside</button>
			</Dialog>,
		);

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog!.contains(document.activeElement)).toBe(true);

		// Unmount restores focus to the trigger (WCAG 2.4.3).
		unmount();
		expect(document.activeElement).toBe(trigger);

		document.body.removeChild(trigger);
	});

	it('traps Tab focus inside the modal dialog', () => {
		const { container } = render(
			<Dialog title='T' onClose={jest.fn()} modal>
				<button>a</button>
				<button>b</button>
			</Dialog>,
		);
		const firstBtn = container.querySelectorAll('button')[0];
		const lastBtn = container.querySelectorAll('button')[2];

		lastBtn.focus();
		expect(document.activeElement).toBe(lastBtn);

		fireEvent.keyDown(window, { key: 'Tab' });
		// Close (X) renders before children, so Tab past the last focusable wraps to it.
		const closeButton = container.querySelector('.dialog_closeButton') as HTMLElement;
		expect(document.activeElement).toBe(closeButton);
	});
});
