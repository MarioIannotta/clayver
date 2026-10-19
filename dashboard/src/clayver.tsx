import { createContext, useContext, type ReactNode } from "react";
import type { ClayverClient } from "@clayver/core";
import type { DashboardConfig } from "./config";

interface ClayverContextValue {
  client: ClayverClient;
  config: DashboardConfig;
}

const ClayverContext = createContext<ClayverContextValue | null>(null);

export function ClayverProvider({
  client,
  config,
  children,
}: ClayverContextValue & { children: ReactNode }) {
  return <ClayverContext.Provider value={{ client, config }}>{children}</ClayverContext.Provider>;
}

export function useClayver(): ClayverContextValue {
  const ctx = useContext(ClayverContext);
  if (!ctx) throw new Error("useClayver must be used inside <ClayverProvider>.");
  return ctx;
}

export function useClient(): ClayverClient {
  return useClayver().client;
}
