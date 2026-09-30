import type { TaraRepository } from '@/types';
import { FirebaseRepository, hasFirebaseConfig } from './firebaseRepository';

let repository: TaraRepository | undefined;

export function getRepository() {
  if (!hasFirebaseConfig) {
    throw new Error('Firebase configuration is incomplete. Add every EXPO_PUBLIC_FIREBASE_* value to .env and restart Expo.');
  }
  if (!repository) repository = new FirebaseRepository();
  return repository;
}
