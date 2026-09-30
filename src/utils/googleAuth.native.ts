import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

let configured = false;

export async function getGoogleIdToken(): Promise<string | undefined> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw new Error('Google sign-in needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID from Firebase Authentication settings.');
  if (!configured) {
    GoogleSignin.configure({ webClientId });
    configured = true;
  }
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut();
  const result = await GoogleSignin.signIn();
  if (result.type === 'cancelled') return undefined;
  if (!result.data.idToken) throw new Error('Google did not return a secure sign-in token. Check the Web client ID.');
  return result.data.idToken;
}
