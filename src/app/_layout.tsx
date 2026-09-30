import '@/styles/global.css';

import { useEffect, useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TaraProvider, useTara } from '@/providers/TaraProvider';
import {
  addNotificationResponseListener,
  enablePushNotifications,
  getLastNotificationTarget,
  getNotificationPermission,
  type NotificationTarget,
} from '@/utils/notifications';

function NotificationNavigation() {
  const tara = useTara();
  const { registerPushToken } = tara;
  const [target, setTarget] = useState<NotificationTarget>({});
  const handledTarget = useRef<string | undefined>(undefined);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let mounted = true;
    void getLastNotificationTarget().then((initialTarget) => {
      if (mounted) setTarget(initialTarget);
    });
    void addNotificationResponseListener(setTarget).then((remove) => {
      if (mounted) removeListener = remove;
      else remove();
    });
    return () => {
      mounted = false;
      removeListener?.();
    };
  }, []);

  useEffect(() => {
    if (tara.loading || !tara.isAuthenticated || !tara.currentUser.id) return;
    void getNotificationPermission().then(async (permission) => {
      if (permission !== 'granted') return;
      const token = await enablePushNotifications();
      await registerPushToken(token);
    }).catch(() => {
      // Registration is best-effort; chat remains available when push setup is incomplete.
    });
  }, [registerPushToken, tara.currentUser.id, tara.isAuthenticated, tara.loading]);

  useEffect(() => {
    if (tara.loading || !target.planId) return;
    const targetKey = `${target.planId}:${target.messageId || ''}`;
    if (handledTarget.current === targetKey) return;
    handledTarget.current = targetKey;
    if (tara.plans.some((plan) => plan.id === target.planId)) {
      router.push({
        pathname: '/plan/[id]/chat',
        params: { id: target.planId, ...(target.messageId ? { messageId: target.messageId } : {}) },
      });
    }
  }, [tara.loading, tara.plans, target]);

  return null;
}

function AppStack() {
  const tara = useTara();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#FFF9F1' },
        headerTintColor: '#20302C',
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: '#FFF9F1' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!tara.isAuthenticated}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={tara.isAuthenticated}>
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="create" options={{ title: 'New plan', presentation: 'modal' }} />
        <Stack.Screen name="join" options={{ title: 'Join a plan', presentation: 'modal' }} />
        <Stack.Screen name="plan/[id]" options={{ title: '', headerTransparent: true, headerTintColor: '#FFFFFF' }} />
        <Stack.Screen name="plan/[id]/chat" options={{ title: 'Plan chat' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TaraProvider>
        <NotificationNavigation />
        <StatusBar style="dark" />
        <AppStack />
      </TaraProvider>
    </SafeAreaProvider>
  );
}
