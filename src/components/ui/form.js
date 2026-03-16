import clsx from "clsx";

export function Label({ className, ...props }) {
  return <label className={clsx("label", className)} {...props} />;
}

export function Input({ className, ...props }) {
  return <input className={clsx("input", className)} {...props} />;
}

export function Select({ className, ...props }) {
  return <select className={clsx("select", className)} {...props} />;
}

export function Textarea({ className, ...props }) {
  return <textarea className={clsx("textarea", className)} {...props} />;
}
