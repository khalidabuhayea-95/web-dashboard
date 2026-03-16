import clsx from "clsx";

const variants = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  ghost: "btn btn-ghost",
  destructive: "btn btn-destructive",
};

export default function Button({
  as: Component = "button",
  variant = "primary",
  className,
  ...props
}) {
  return (
    <Component
      className={clsx(variants[variant] ?? variants.primary, className)}
      {...props}
    />
  );
}
