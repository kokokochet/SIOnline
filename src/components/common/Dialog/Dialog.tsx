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
	/**
	 * When true, a top-level Escape keydown calls `onClose`. Default false so
	 * existing consumers keep their current dismiss behaviour. The close (×)
	 * button always calls `onClose` regardless.
	 *
	 * NOTE: this prop only gates the Escape handler. A separate `modal` prop
	 * (focus trap + `aria-modal`) is the sole driver of `aria-modal`; a merely
	 * Escape-closable dialog does not claim modality. Contract unchanged by the
	 * `modal` addition below.
	 */
	dismissable?: boolean;
	/**
	 * Opt-in modal semantics: on open, focus moves into the dialog; Tab/Shift-Tab
	 * are trapped within it (which also removes background content from the tab
	 * order while open — the WCAG 2.4.3 fix); on close, focus is restored to the
	 * element focused before the dialog opened. Default false. Drives `aria-modal`
	 * (modality holds only when focus is actually trapped).
	 */
	modal?: boolean;
}

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

	// React 17 has no useId; derive a stable title id from the optional id prop
	// (kept unchanged). When no id is given, aria-labelledby is omitted;
	// role='dialog' is still set.
	const titleId = id ? `${id}-title` : undefined;

	const innerRef = useRef<HTMLElement | null>(null);
	// Element focused before the dialog opened; restored on close (WCAG 2.4.3).
	const previouslyFocused = useRef<Element | null>(null);

	// Merge the caller's forwarded ref with the internal one we manage for focus.
	const setRef = useCallback((node: HTMLElement | null) => {
		innerRef.current = node;
		if (typeof ref === 'function') {
			ref(node);
		} else if (ref) {
			(ref as React.MutableRefObject<HTMLElement | null>).current = node;
		}
	}, [ref]);

	// Escape -> onClose (opt-in, Phase 2 — UNCHANGED).
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

	// Modal focus management: move focus in, trap Tab, restore on unmount.
	// ASSUMPTION: Dialog renders inline (no portal / no Shadow DOM), so
	// innerRef.current.querySelectorAll(...) reaches descendants. A future portal
	// refactor would silently break the trap and must rework this.
	useEffect(() => {
		if (!modal) {
			return;
		}
		const node = innerRef.current;
		if (!node) {
			return;
		}

		previouslyFocused.current = document.activeElement;
		// Focus the container itself (tabIndex=-1) so the title (aria-labelledby)
		// is announced; subsequent Tab moves to the first control.
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
			// If focus is on the container or has escaped outside, jump to an edge.
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
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			const toRestore = previouslyFocused.current as HTMLElement | null;
			if (toRestore && typeof toRestore.focus === 'function') {
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
