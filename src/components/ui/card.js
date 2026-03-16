import clsx from "clsx";

export function Card({ className, ...props }) {
  return <div className={clsx("card", className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={clsx("card-header", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={clsx("card-content", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <div className={clsx("card-title", className)} {...props} />;
}

export function CardSubtitle({ className, ...props }) {
  return <div className={clsx("card-subtitle", className)} {...props} />;
}
