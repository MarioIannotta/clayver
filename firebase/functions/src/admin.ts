import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) initializeApp();

export const db = () => getDatabase();
export const auth = () => getAuth();
export const messaging = () => getMessaging();
