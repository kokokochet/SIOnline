import * as React from 'react';
import localization from '../../../model/resources/localization';
import { ForwardedRef, useCallback, useEffect, useRef } from 'react';

import closeSvg from '../../../../assets/images/close.svg';

import './Dialog.css';

interface DialogProps {
	id?: string;
	className?: string;
	title: string;
	children?: any;
	onClose: () => void;
	/** When true, a top-level Escape keydown calls `onClose`. Default false. */
	dismissable?: boolean;
	/** Opt-in modal: focus trap + Tab cycling + focus restore. Drives `aria-modal`. */
	modal?: boolean;
}

// Focusable selector for the Tab trap; excludes hidden/disabled so an edge .focus() can't silently fail. Assumes a single (non-nested) modal.
const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'textarea:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'[tabindex]:not([tabindex^="-"])',
].map(sel => `${sel}:not([hidden]):not([aria-hidden="true"])`).join(', ');

const Dialog = React.forwardRef((props: DialogProps, ref: ForwardedRef<HTMLElement>) => {
	const {
		title,
		onClose,
		dismissable = false,
		modal = false,
		id,
		className,
		children,
	} = props;

	// React 17 has no useId; derive a labelledby id from the optional id prop.
	const titleId = id ? `${id}-title` : undefined;

	const innerRef = useRef<HTMLElement | null>(null);
	// Element focused before the dialog opened; restored on close.
	const previouslyFocused = useRef<Element | null>(null);
	// Guards the focusin snap against infinite loops (re-entrant programmatic focus).
	const isRestoringFocus = useRef(false);

	const setRef = useCallback((node: HTMLElement | null) => {
		innerRef.current = node;
		if (typeof ref === 'function') {
			ref(node);
		} else if (ref) {
			(ref as React.MutableRefObject<HTMLElement | null>).current = node;
		}
	}, [ref]);

	useEffect(() => {
		if (!dismissable) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [dismissable, onClose]);

	// ASSUMPTION: Dialog renders inline (no portal/Shadow DOM), so querySelectorAll reaches descendants.
	useEffect(() => {
		if (!modal) {
			return;
		}
		const node = innerRef.current;
		if (!node) {
			return;
		}

		previouslyFocused.current = document.activeElement;
		// Focus the container so the labelledby title is announced.
		(node as HTMLElement).focus();

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') {
				return;
			}
			const current = innerRef.current;
			if (!current) {
				return;
			}
			const items = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
			const active = document.activeElement;
			if (items.length === 0) {
				e.preventDefault();
				(current as HTMLElement).focus();
				return;
			}
			const firstItem = items[0];
			const lastItem = items[items.length - 1];
			if (active === current || !current.contains(active)) {
				e.preventDefault();
				(e.shiftKey ? lastItem : firstItem).focus();
				return;
			}
			if (e.shiftKey && active === firstItem) {
				e.preventDefault();
				lastItem.focus();
			} else if (!e.shiftKey && active === lastItem) {
				e.preventDefault();
				firstItem.focus();
			}
		};
		// Snap back focus that escapes via programmatic .focus() or background click (guarded vs re-entrant loops by isRestoringFocus).
		const onFocusIn = (e: FocusEvent) => {
			const current = innerRef.current;
			if (!current || isRestoringFocus.current) {
				return;
			}
			const target = e.target as Node | null;
			if (target && !current.contains(target)) {
				isRestoringFocus.current = true;
				const items = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
				const snapTo = items[0] ?? (current as HTMLElement);
				snapTo.focus();
				// Defer reset so our own programmatic focusin is ignored.
				setTimeout(() => {
					isRestoringFocus.current = false;
				}, 0);
			}
		};
		document.addEventListener('focusin', onFocusIn);

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			// Remove before restoring focus, else the outside trigger is re-trapped.
			document.removeEventListener('focusin', onFocusIn);
			const toRestore = previouslyFocused.current as HTMLElement | null;
			if (toRestore && toRestore.isConnected && typeof toRestore.focus === 'function') {
				toRestore.focus();
			}
		};
	}, [modal]);

	return (
		<section
			id={id}
			className={`dialog ${className ?? ''}`}
			ref={setRef}
			role="dialog"
			aria-modal={modal ? 'true' : undefined}
			aria-labelledby={titleId}
			tabIndex={-1}
		>
			<header><h1 id={titleId}>{title}</h1></header>

			<button type="button" className="dialog_closeButton" onClick={onClose} title={localization.close}>
				<img src={closeSvg} alt={localization.close} />
			</button>

			{children}
		</section>
	);
});

Dialog.displayName = 'Dialog';

export default Dialog;
