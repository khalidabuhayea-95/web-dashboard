import clsx from "clsx";

export function Table({ className, ...props }) {
  return <table className={clsx("table", className)} {...props} />;
}

export function TableHead({ className, ...props }) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }) {
  return <tr className={className} {...props} />;
}

export function TableHeaderCell({ className, ...props }) {
  return <th className={className} {...props} />;
}

export function TableCell({ className, ...props }) {
  return <td className={className} {...props} />;
}
