import clsx from "clsx";

export default function Modal({ open, onClose, className, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={clsx("modal", className)}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
