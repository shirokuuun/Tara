import { useEffect } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

import { LoadingScreen } from '@/components/ScreenState';
import { useTara } from '@/providers/TaraProvider';

export const ONBOARDING_KEY = '@tara/onboarding-complete';

export default function IndexScreen() {
  const tara = useTara();

  useEffect(() => {
    if (tara.loading) return;
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((complete) => router.replace(tara.isAuthenticated ? '/home' : complete ? '/auth' : '/onboarding'))
      .catch(() => router.replace('/onboarding'));
  }, [tara.isAuthenticated, tara.loading]);

  return (
    <View className="flex-1 bg-cream">
      <LoadingScreen />
    </View>
  );
}
