declare module "@/components/ui/button" {
  import * as React from "react";

  type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    as?: React.ElementType;
    variant?: "primary" | "secondary" | "ghost" | "destructive" | (string & {});
    className?: string;
  };

  const Button: React.FC<ButtonProps>;
  export default Button;
}

declare module "@/components/ui/form" {
  import * as React from "react";

  export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement> & { className?: string }>;
  export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { className?: string }>;
  export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string }>;
  export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }>;
}
