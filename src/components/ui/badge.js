import clsx from "clsx";

const variants = {
  neutral: "badge",
  success: "badge badge-success",
  warning: "badge badge-warning",
  destructive: "badge badge-destructive",
};

export default function Badge({ variant = "neutral", className, ...props }) {
  return <span className={clsx(variants[variant], className)} {...props} />;
}
