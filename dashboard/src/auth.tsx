import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  agentDisplayName,
  subscribeAgentRole,
  subscribeAuthState,
  type Agent,
  type AgentRole,
  type ClayverError,
  type User,
} from "@clayver/core";
import { useClient } from "./clayver";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      user: User;
      /** Still resolving `agents/{uid}`. */
      roleLoading: boolean;
      roleError: ClayverError | null;
      agent: Agent | null;
      role: AgentRole | null;
      displayName: string;
    };

const AuthContext = createContext<AuthState>({ status: "loading" });

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [roleState, setRoleState] = useState<{
    uid: string;
    agent: Agent | null;
    role: AgentRole | null;
    error: ClayverError | null;
  } | null>(null);

  useEffect(() => subscribeAuthState(client, setUser), [client]);

  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return subscribeAgentRole(
      client,
      uid,
      ({ agent, role }) => setRoleState({ uid, agent, role, error: null }),
      (error) => setRoleState({ uid, agent: null, role: null, error }),
    );
  }, [client, uid]);

  const value = useMemo<AuthState>(() => {
    if (user === undefined) return { status: "loading" };
    if (user === null) return { status: "signed-out" };
    const current = roleState?.uid === user.uid ? roleState : null;
    return {
      status: "signed-in",
      user,
      roleLoading: !current,
      roleError: current?.error ?? null,
      agent: current?.agent ?? null,
      role: current?.role ?? null,
      displayName: agentDisplayName(user, current?.agent),
    };
  }, [user, roleState]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Auth state for components rendered only for active agents. */
export function useAgent() {
  const state = useAuth();
  if (state.status !== "signed-in" || !state.role) {
    throw new Error("useAgent used outside of an agent-only route.");
  }
  return { ...state, role: state.role };
}
