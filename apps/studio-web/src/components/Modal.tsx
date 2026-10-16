// SPDX-License-Identifier: Apache-2.0
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A modal dialog: focus moves in on open and back on close; Escape asks the owner to close. */
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>(".modal-body input, .modal-body select, .modal-body textarea, .modal-body button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  return createPortal(
    <div className="modal-backdrop">
      <div ref={panel} className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="modal-head"><h2 id={id}>{title}</h2><button type="button" className="icon" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
