"use client";

import { ReactNode, useLayoutEffect, useState } from "react";
import { PhaConnectCtx, PhaConnectState } from "@phantasma/connect-react";

import { readStoredConnectTransportMode } from "@/lib/phantasma/connectTransportMode";

// Provider component
interface PhantasmaProviderProps {
  children: ReactNode;
}

export function PhantasmaProvider({ children }: PhantasmaProviderProps) {
  const [phaConnectState] = useState(
    () =>
      new PhaConnectState({
        transportMode: "auto",
      }),
  );

  useLayoutEffect(() => {
    // Restore runs inside the account widget on mount. Load the user's saved
    // transport preference first so explicit `I` / `S` modes can suppress
    // auto-restore before that effect fires.
    phaConnectState.set_transport_mode(readStoredConnectTransportMode());
  }, [phaConnectState]);

  return (
    <PhaConnectCtx.Provider value={phaConnectState}>
      {children}
    </PhaConnectCtx.Provider>
  );
}
