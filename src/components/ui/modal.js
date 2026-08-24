import clsx from "clsx";

// backdropClassName lifts a modal above another one (both backdrops are z-50,
// so stacked dialogs — e.g. a picker opened from inside an editor — need an
// explicit higher z on the top one).
export default function Modal({ open, onClose, className, backdropClassName, children }) {
  if (!open) return null;
  return (
    <div className={clsx("modal-backdrop", backdropClassName)} onClick={onClose} role="presentation">
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
