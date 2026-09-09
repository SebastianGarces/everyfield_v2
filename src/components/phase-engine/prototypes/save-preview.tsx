"use client";

import { createContext, useContext } from "react";
import { toast } from "sonner";

// Throwaway #533 boundary. Remove with the layout switcher after the ruling.
export const PhaseSavePreview = createContext(false);

export function usePhaseSavePreview() {
  const preview = useContext(PhaseSavePreview);
  return () => {
    if (preview) {
      toast.info(
        "Layout preview: no changes saved. Your draft stays on this page."
      );
    }
    return preview;
  };
}
