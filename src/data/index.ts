// 데이터 계층 진입점.
// 공개 API: backend (Backend), isDemoMode
// VITE_FIREBASE_API_KEY 가 있으면 Firebase, 없으면 데모 모드(localStorage).
// firebase SDK 는 firebaseBackend 내부에서 동적 import 하므로 데모 모드 번들에는 들어가지 않는다.
import type { Backend } from './backend';
import { createFirebaseBackend } from './firebaseBackend';
import { createLocalBackend } from './localBackend';

const env = import.meta.env;
const apiKey = (env.VITE_FIREBASE_API_KEY as string | undefined)?.trim();

export const isDemoMode = !apiKey;

export const backend: Backend = apiKey
  ? createFirebaseBackend({
      apiKey,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL as string | undefined,
      appId: env.VITE_FIREBASE_APP_ID as string | undefined,
    })
  : createLocalBackend();

export type { Backend, Unsub } from './backend';
