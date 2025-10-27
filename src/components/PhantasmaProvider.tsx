"use client";

import { ReactNode } from "react";
import { PhaConnectCtx, PhaConnectState } from "@phantasma/connect-react";

// Provider component
interface PhantasmaProviderProps {
  children: ReactNode;
}

export function PhantasmaProvider({ children }: PhantasmaProviderProps) {
  const phaConnectState = new PhaConnectState();

  return (
    <PhaConnectCtx.Provider value={phaConnectState}>
      {children}
    </PhaConnectCtx.Provider>
  );
}
