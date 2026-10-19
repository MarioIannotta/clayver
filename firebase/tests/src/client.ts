import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  type Auth,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, ref, serverTimestamp, set, push, get, type Database } from "firebase/database";
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { adminAuth, AUTH_HOST, BASE, DB_HOST, FUNCTIONS_HOST, NS, PROJECT, WS } from "./env";

/** One simulated app install or browser: its own Firebase app, auth state and connections. */
export interface Client {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  fns: Functions;
  uid: string;
  call<T = unknown>(name: string, data: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

let counter = 0;

async function makeClient(signIn: (auth: Auth) => Promise<void>): Promise<Client> {
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "fake-api-key", databaseURL: `http://${DB_HOST}?ns=${NS}` },
    `client-${++counter}-${Date.now()}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getDatabase(app);
  const [h, p] = DB_HOST.split(":");
  connectDatabaseEmulator(db, h, Number(p));
  const fns = getFunctions(app, "us-central1");
  const [fh, fp] = FUNCTIONS_HOST.split(":");
  connectFunctionsEmulator(fns, fh, Number(fp));
  await signIn(auth);
  return {
    app,
    auth,
    db,
    fns,
    uid: auth.currentUser!.uid,
    async call<T>(name: string, data: Record<string, unknown>) {
      const res = await httpsCallable(fns, name)({ projectId: WS, ...data });
      return res.data as T;
    },
    async close() {
      await deleteApp(app);
    },
  };
}

export const anonymousClient = () => makeClient(async (auth) => void (await signInAnonymously(auth)));

/** A password user created by the admin SDK, e.g. an agent or a host-app user. */
export async function passwordClient(email: string, opts: { verified?: boolean } = {}): Promise<Client> {
  const password = "correct-horse-battery";
  try {
    await adminAuth().createUser({ email, password, emailVerified: opts.verified ?? true });
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/email-already-exists") throw e;
    // Created by an invite (no password yet): set one, like the invitee would via the setup link.
    const existing = await adminAuth().getUserByEmail(email);
    await adminAuth().updateUser(existing.uid, { password, emailVerified: opts.verified ?? true });
  }
  return makeClient(async (auth) => void (await signInWithEmailAndPassword(auth, email, password)));
}

export async function startConversation(client: Client, customerId: string, text = "Hello, I need help"): Promise<string> {
  const convRef = push(ref(client.db, `${BASE}/conversations`));
  await set(convRef, { customerId, status: "open", createdAt: serverTimestamp() });
  await sendCustomerMessage(client, convRef.key!, customerId, text);
  return convRef.key!;
}

export async function sendCustomerMessage(client: Client, conversationId: string, customerId: string, text: string) {
  await set(push(ref(client.db, `${BASE}/messages/${conversationId}`)), {
    senderId: customerId,
    senderType: "customer",
    text,
    createdAt: serverTimestamp(),
  });
}

export async function sendAgentMessage(client: Client, conversationId: string, text: string) {
  await set(push(ref(client.db, `${BASE}/messages/${conversationId}`)), {
    senderId: client.uid,
    senderType: "agent",
    senderName: "Agent",
    text,
    createdAt: serverTimestamp(),
  });
}

export async function registerDevice(
  client: Client,
  owner: { type: "customers" | "agents"; id: string },
  deviceId: string,
  pushToken: string,
  platform = "ios",
) {
  await set(ref(client.db, `${BASE}/devices/${owner.type}/${owner.id}/${deviceId}`), {
    uid: client.uid,
    platform,
    pushToken,
    active: true,
    updatedAt: serverTimestamp(),
  });
}

export const read = async (client: Client, path: string) => (await get(ref(client.db, path))).val();
