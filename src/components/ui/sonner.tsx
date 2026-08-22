"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          // 24x24 for WCAG 2.5.8, WITHOUT redrawing the toast (#639). Sonner
          // paints this control as a bordered 20px circle from its own
          // stylesheet, so unlike the dialog and sheet X — invisible until it
          // is hovered — growing the box here would be a visible change to
          // every toast in the product. The painted circle keeps its 20px and
          // `hit-area-6` (globals.css) extends the target with a centred
          // `::after`. The overlay's far edge lands 15px in and the toast pads
          // its content to 16px, so it collides with nothing.
          closeButton: "hit-area-6",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
