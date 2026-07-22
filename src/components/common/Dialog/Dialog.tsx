import * as React from 'react';
import localization from '../../../model/resources/localization';
import { ForwardedRef } from 'react';

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
	 * (focus trap + `aria-modal`) is introduced in a later task and is the
	 * sole driver of `aria-modal`; a merely Escape-closable dialog does not
	 * claim modality.
	 */
	dismissable?: boolean;
}

const Dialog = React.forwardRef((props: DialogProps, ref: ForwardedRef<HTMLElement>) => {
	const { onClose, dismissable } = props;
	// React 17 has no useId; derive a stable title id from the optional id prop.
	// When no id is given, aria-labelledby is omitted (graceful — role is still set).
	const titleId = props.id ? `${props.id}-title` : undefined;

	React.useEffect(() => {
		if (!dismissable) {
			return;
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		};

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [dismissable, onClose]);

	return (
		<section
			id={props.id}
			className={`dialog ${props.className ?? ''}`}
			ref={ref}
			role="dialog"
			aria-labelledby={titleId}
		>
			<header><h1 id={titleId}>{props.title}</h1></header>

			<button type="button" className="dialog_closeButton" onClick={props.onClose} title={localization.close}>
				<img src={closeSvg} alt={localization.close} />
			</button>

			{props.children}
		</section>
	);
});

export default Dialog;
