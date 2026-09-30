import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { EmptyState, LoadingScreen } from '@/components/ScreenState';
import { PlanCard } from '@/components/PlanCard';
import { TaraLogo } from '@/components/TaraLogo';
import { useTara } from '@/providers/TaraProvider';
import { isPastPlan } from '@/utils/format';

export default function HomeScreen() {
  const tara = useTara();
  const [showPast, setShowPast] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const visiblePlans = useMemo(
    () => tara.plans
      .filter((plan) => isPastPlan(plan.dateTime, plan.status) === showPast)
      .sort((a, b) => (a.dateTime || '9999').localeCompare(b.dateTime || '9999')),
    [showPast, tara.plans],
  );

  if (tara.loading) return <LoadingScreen />;

  const refresh = async () => {
    setRefreshing(true);
    await tara.refresh();
    setRefreshing(false);
  };

  const confirmSignOut = () => Alert.alert(
    tara.currentUser.isGuest ? 'End guest session?' : 'Sign out?',
    tara.currentUser.isGuest
      ? 'Guest plans may not be recoverable after signing out on this device.'
      : 'You can sign back in at any time.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void tara.signOut() },
    ],
  );

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top']}>
      <ScrollView
        contentContainerClassName="px-5 pb-12"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#F36F56" />}
      >
        <View className="flex-row items-center justify-between pb-5 pt-4">
          <TaraLogo compact />
          <View className="flex-row items-center gap-2">
            <View className="rounded-full bg-teal-soft px-3 py-2">
              <Text className="text-xs font-bold text-teal">
                {tara.currentUser.isGuest ? 'Guest' : 'Account'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={confirmSignOut} className="h-10 w-10 items-center justify-center rounded-full border border-line bg-white">
              <Ionicons name="log-out-outline" size={19} color="#20302C" />
            </Pressable>
          </View>
        </View>

        <View className="mb-7 mt-2">
          <Text className="text-sm font-semibold text-muted">Hey {tara.currentUser.name === 'You' ? 'there' : tara.currentUser.name} 👋</Text>
          <Text className="mt-1 text-[30px] font-black leading-9 text-ink">What are we doing next?</Text>
        </View>

        {tara.startupError ? (
          <View className="mb-5 rounded-2xl border border-coral bg-coral-soft p-4">
            <Text className="font-bold text-coral">Couldn’t connect to Tara</Text>
            <Text className="mt-1 text-sm text-ink">{tara.startupError}</Text>
          </View>
        ) : null}

        <View className="mb-7 flex-row gap-3">
          <View className="flex-1">
            <AppButton label="Create plan" icon="add" onPress={() => router.push('/create')} />
          </View>
          <View className="flex-1">
            <AppButton label="Join plan" icon="link-outline" variant="ghost" onPress={() => router.push('/join')} />
          </View>
        </View>

        <View className="mb-4 flex-row items-center justify-between">
          <Text className="text-xl font-black text-ink">{showPast ? 'Past plans' : 'Coming up'}</Text>
          <AppButton
            compact
            label={showPast ? 'Upcoming' : 'Past'}
            icon={showPast ? 'calendar-outline' : 'time-outline'}
            variant="secondary"
            onPress={() => setShowPast((current) => !current)}
          />
        </View>

        {visiblePlans.length ? visiblePlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            members={tara.members.filter((member) => member.planId === plan.id)}
            rsvps={tara.rsvps.filter((rsvp) => rsvp.planId === plan.id)}
            chatStatus={tara.chatStatuses.find((status) => status.planId === plan.id)}
            onPress={() => router.push({ pathname: '/plan/[id]', params: { id: plan.id } })}
          />
        )) : (
          <EmptyState
            icon={showPast ? 'albums-outline' : 'sparkles-outline'}
            title={showPast ? 'No memories here yet' : 'Your next plan starts here'}
            message={showPast ? 'Completed plans stay here so you can remember what worked.' : 'Create a hangout or join one with an invite.'}
            action={showPast ? undefined : 'Make a plan'}
            onAction={showPast ? undefined : () => router.push('/create')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
