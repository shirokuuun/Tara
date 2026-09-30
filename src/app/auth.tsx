import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { TaraLogo } from '@/components/TaraLogo';
import { useTara } from '@/providers/TaraProvider';
import { getGoogleIdToken } from '@/utils/googleAuth';

type AuthMode = 'signin' | 'signup';
type PendingAction = 'email' | 'google' | 'guest' | null;

function authMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('invalid-credential')) return 'The email or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'That email already has an account. Try signing in.';
  if (code.includes('weak-password')) return 'Use a password with at least 6 characters.';
  if (code.includes('invalid-email')) return 'Enter a valid email address.';
  if (code.includes('too-many-requests') || code.includes('resource-exhausted')) return 'Too many attempts. Wait a moment and try again.';
  return error instanceof Error ? error.message : 'Authentication could not be completed.';
}

export default function AuthScreen() {
  const tara = useTara();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const attempts = useRef<number[]>([]);

  const run = async (action: Exclude<PendingAction, null>, operation: () => Promise<void | boolean>) => {
    const now = Date.now();
    attempts.current = attempts.current.filter((value) => now - value < 60_000);
    if (attempts.current.length >= 5) {
      Alert.alert('Please slow down', 'Wait a minute before trying to authenticate again.');
      return;
    }
    attempts.current.push(now);
    setPending(action);
    try {
      const completed = await operation();
      if (completed === false) return;
      router.replace('/home');
    } catch (error) {
      Alert.alert('Couldn\'t continue', authMessage(error));
    } finally {
      setPending(null);
    }
  };

  const submitEmail = () => {
    if (!email.trim() || !password) {
      Alert.alert('Complete your details', 'Enter both your email and password.');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      Alert.alert('What should friends call you?', 'Enter your name to create your Tara profile.');
      return;
    }
    void run('email', () => mode === 'signup'
      ? tara.signUpWithEmail(name, email, password)
      : tara.signInWithEmail(email, password));
  };

  const submitGoogle = () => void run('google', async () => {
    const idToken = await getGoogleIdToken();
    if (Platform.OS !== 'web' && !idToken) return false;
    await tara.signInWithGoogle(idToken);
    return true;
  });

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerClassName="px-6 pb-10 pt-4"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
        >
          <TaraLogo compact />
          <View className="mb-7 mt-10">
            <View className="mb-5 h-16 w-16 items-center justify-center rounded-3xl bg-coral-soft">
              <Ionicons name="people" size={30} color="#F36F56" />
            </View>
            <Text className="text-[34px] font-black leading-10 text-ink">Plan together, your way.</Text>
            <Text className="mt-3 text-base leading-6 text-muted">Sign in to keep your plans across devices, or continue privately as a guest.</Text>
          </View>

          <View className="mb-5 rounded-3xl border border-line bg-white p-5">
            <View className="mb-5 flex-row rounded-2xl bg-cream p-1">
              {(['signin', 'signup'] as const).map((value) => (
                <Pressable key={value} onPress={() => setMode(value)} className={`flex-1 rounded-xl py-3 ${mode === value ? 'bg-white' : ''}`}>
                  <Text className={`text-center font-bold ${mode === value ? 'text-ink' : 'text-muted'}`}>{value === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>
            {mode === 'signup' ? <FormField label="Your name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} placeholder="What should friends call you?" /> : null}
            <FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" />
            <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'signup' ? 'newPassword' : 'password'} placeholder="At least 6 characters" />
            <AppButton label={mode === 'signin' ? 'Sign in with email' : 'Create my account'} icon="mail-outline" loading={pending === 'email'} disabled={pending !== null} onPress={submitEmail} />
          </View>

          <View className="mb-5 flex-row items-center">
            <View className="h-px flex-1 bg-line" />
            <Text className="px-3 text-xs font-bold text-muted">OR</Text>
            <View className="h-px flex-1 bg-line" />
          </View>

          <View className="gap-3">
            <AppButton label="Continue with Google" icon="logo-google" variant="ghost" loading={pending === 'google'} disabled={pending !== null} onPress={submitGoogle} />
            <AppButton label="Continue as guest" icon="person-outline" variant="secondary" loading={pending === 'guest'} disabled={pending !== null} onPress={() => void run('guest', tara.continueAsGuest)} />
          </View>
          <Text className="mt-5 text-center text-xs leading-5 text-muted">Guest access uses an anonymous Firebase account and stays tied to this app installation. No password is required.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
