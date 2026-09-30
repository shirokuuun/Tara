import { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { Avatar, AvatarStack } from '@/components/Avatar';
import { EmptyState, LoadingScreen } from '@/components/ScreenState';
import { usePlan } from '@/providers/TaraProvider';
import type { RSVPStatus } from '@/types';
import { formatPlanDate, inviteUrl, isPlanReadOnly } from '@/utils/format';

function SectionHeader({ icon, title, meta }: { icon: keyof typeof Ionicons.glyphMap; title: string; meta: string }) {
  return (
    <View className="mb-4 flex-row items-center justify-between">
      <View className="flex-row items-center">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-cream">
          <Ionicons name={icon} size={19} color="#F36F56" />
        </View>
        <Text className="ml-3 text-xl font-black text-ink">{title}</Text>
      </View>
      <Text className="text-xs font-bold text-muted">{meta}</Text>
    </View>
  );
}

function ShareSheet({ visible, onClose, title, code }: { visible: boolean; onClose: () => void; title: string; code: string }) {
  const url = inviteUrl(code);
  const share = () => Share.share({ message: `Join “${title}” on Tara: ${url}\nInvite code: ${code}` });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable className="rounded-t-[32px] bg-cream px-6 pb-10 pt-4" onPress={(event) => event.stopPropagation()}>
          <View className="mb-5 h-1 w-12 self-center rounded-full bg-line" />
          <Text className="text-center text-2xl font-black text-ink">Bring the group in</Text>
          <Text className="mt-2 text-center text-sm leading-5 text-muted">Share the link, show the QR code, or send the fallback code.</Text>
          <View className="my-6 self-center rounded-3xl bg-white p-5">
            <QRCode value={url} size={180} color="#20302C" backgroundColor="#FFFFFF" />
          </View>
          <View className="mb-5 items-center rounded-2xl border border-dashed border-teal bg-teal-soft p-4">
            <Text className="text-xs font-bold tracking-[1.5px] text-teal">INVITE CODE</Text>
            <Text selectable className="mt-1 text-2xl font-black tracking-[4px] text-ink">{code}</Text>
          </View>
          <AppButton label="Share invite" icon="share-social" onPress={() => void share()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const rsvpOptions: { status: RSVPStatus; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { status: 'going', label: 'Going', icon: 'checkmark-circle' },
  { status: 'maybe', label: 'Maybe', icon: 'help-circle' },
  { status: 'no', label: 'Can’t go', icon: 'close-circle' },
];

export default function PlanBoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tara = usePlan(id);
  const [shareVisible, setShareVisible] = useState(false);
  const [contribution, setContribution] = useState('');
  const [task, setTask] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [managementPending, setManagementPending] = useState<string | null>(null);

  if (tara.loading) return <LoadingScreen />;
  if (!tara.plan) {
    return (
      <SafeAreaView className="flex-1 justify-center bg-cream px-6">
        <EmptyState icon="map-outline" title="Plan not found" message="It may have been removed, or your invitation is no longer active." action="Back to plans" onAction={() => router.replace('/home')} />
      </SafeAreaView>
    );
  }

  const plan = tara.plan;
  const currentRsvp = tara.planRsvps.find((entry) => entry.userId === tara.currentUser.id)?.status;
  const organizer = plan.organizerId === tara.currentUser.id;
  const readOnly = isPlanReadOnly(plan.dateTime, plan.status);
  const going = tara.planRsvps.filter((entry) => entry.status === 'going');
  const openItems = tara.planContributions.filter((entry) => !entry.claimedBy).length;
  const openTasks = tara.planTasks.filter((entry) => !entry.done).length;

  const run = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      Alert.alert('Couldn’t update the plan', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const addContribution = async () => {
    const value = contribution.trim();
    if (!value) return;
    setContribution('');
    await run(() => tara.addContribution(plan.id, value, 'General'));
  };

  const addTask = async () => {
    const value = task.trim();
    if (!value) return;
    setTask('');
    await run(() => tara.addTask(plan.id, value));
  };

  const refresh = async () => {
    setRefreshing(true);
    await tara.refresh();
    setRefreshing(false);
  };

  const confirmRemoveMember = (userId: string, memberName: string) => Alert.alert(
    `Remove ${memberName}?`,
    'They will lose access to this plan. Their claimed items and tasks will be released.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setManagementPending(userId);
          void run(() => tara.removePlanMember(plan.id, userId)).finally(() => setManagementPending(null));
        },
      },
    ],
  );

  const confirmLeave = () => Alert.alert(
    'Leave this plan?',
    'You will lose access to the plan and your claimed items and tasks will be released.',
    [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave plan',
        style: 'destructive',
        onPress: () => {
          setManagementPending('leave');
          void tara.leavePlan(plan.id)
            .then(() => router.replace('/home'))
            .catch((error) => Alert.alert('Couldn\'t leave the plan', error instanceof Error ? error.message : 'Please try again.'))
            .finally(() => setManagementPending(null));
        },
      },
    ],
  );

  const confirmDelete = () => Alert.alert(
    'Delete this plan permanently?',
    'This removes the plan, members, RSVPs, lists, tasks, chat, and invite. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete plan',
        style: 'destructive',
        onPress: () => {
          setManagementPending('delete');
          void tara.deletePlan(plan.id)
            .then(() => router.replace('/home'))
            .catch((error) => Alert.alert('Couldn\'t delete the plan', error instanceof Error ? error.message : 'Please try again.'))
            .finally(() => setManagementPending(null));
        },
      },
    ],
  );

  const confirmFinish = () => Alert.alert(
    'Mark this plan as finished?',
    'Everyone can still view it, but no one will be able to edit, RSVP, claim items, complete tasks, or send messages.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as finished',
        onPress: () => {
          setManagementPending('finish');
          void tara.finishPlan(plan.id)
            .catch((error) => Alert.alert('Couldn\'t finish the plan', error instanceof Error ? error.message : 'Please try again.'))
            .finally(() => setManagementPending(null));
        },
      },
    ],
  );

  return (
    <View className="flex-1 bg-cream">
      <Stack.Screen options={{
        title: '',
        headerRight: () => organizer && !readOnly ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit plan"
            onPress={() => router.push({ pathname: '/create', params: { id: plan.id } })}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/25"
          >
            <Ionicons name="create-outline" size={21} color="#FFFFFF" />
          </Pressable>
        ) : null,
      }} />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#FFFFFF" />}
          contentContainerClassName="pb-12"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
        >
        <View className="relative min-h-[360px] overflow-hidden bg-teal">
          {plan.coverUri ? <Image source={{ uri: plan.coverUri }} className="absolute h-full w-full" resizeMode="cover" /> : null}
          <LinearGradient
            colors={plan.coverUri ? ['rgba(18,53,49,0.25)', 'rgba(18,53,49,0.92)'] : ['#3BA99C', '#176C62']}
            className="absolute h-full w-full"
          />
          <View className="px-5 pb-7 pt-28">
            <View className="self-start rounded-full bg-white/20 px-3 py-2">
              <Text className="text-xs font-black tracking-[1.4px] text-white">{readOnly ? 'FINISHED PLAN' : 'PLAN BOARD'}</Text>
            </View>
            <Text className="mt-4 text-[34px] font-black leading-[39px] text-white">{plan.title}</Text>
            <View className="mt-5 flex-row items-start">
              <Ionicons name="calendar-outline" size={19} color="#FFFFFF" />
              <Text className="ml-3 flex-1 font-semibold text-white">{formatPlanDate(plan.dateTime)}</Text>
            </View>
            <View className="mt-3 flex-row items-start">
              <Ionicons name="location-outline" size={19} color="#FFFFFF" />
              <Text className="ml-3 flex-1 font-semibold text-white">{plan.location || 'Location to be decided'}</Text>
            </View>
            <View className="mt-6 flex-row items-center justify-between">
              <AvatarStack names={tara.planMembers.map((member) => member.name)} limit={5} />
              {!readOnly ? (
                <Pressable onPress={() => setShareVisible(true)} className="flex-row items-center rounded-2xl bg-white px-4 py-3">
                  <Ionicons name="share-social-outline" size={18} color="#248F83" />
                  <Text className="ml-2 font-bold text-teal">Invite</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View className="-mt-1 flex-row border-b border-line bg-white px-4 py-4">
          {[
            { value: going.length, label: 'going' },
            { value: openItems, label: 'items open' },
            { value: openTasks, label: 'tasks left' },
          ].map((stat, index) => (
            <View key={stat.label} className={`flex-1 items-center ${index ? 'border-l border-line' : ''}`}>
              <Text className="text-xl font-black text-ink">{stat.value}</Text>
              <Text className="mt-1 text-[11px] font-semibold text-muted">{stat.label}</Text>
            </View>
          ))}
        </View>

        <View className="px-5 pt-5">
          {readOnly ? (
            <View className="mb-5 flex-row rounded-2xl border border-gold bg-white p-4">
              <Ionicons name="lock-closed-outline" size={21} color="#9B6714" />
              <View className="ml-3 flex-1">
                <Text className="font-black text-ink">This plan is finished</Text>
                <Text className="mt-1 text-xs leading-5 text-muted">It is available as a record, but all plan activity is now read-only.</Text>
              </View>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open plan chat"
            onPress={() => router.push({ pathname: '/plan/[id]/chat', params: { id: plan.id } })}
            className="mb-5 flex-row items-center rounded-3xl bg-teal px-5 py-4"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-white/20">
              <Ionicons name="chatbubbles-outline" size={23} color="#FFFFFF" />
            </View>
            <View className="ml-4 flex-1">
              <View className="flex-row items-center">
                <Text className="text-lg font-black text-white">Plan chat</Text>
                {tara.chatStatus?.unread ? <View className="ml-2 h-2.5 w-2.5 rounded-full bg-coral-soft" /> : null}
              </View>
              <Text className="mt-1 text-xs font-semibold text-white/80">
                {tara.chatStatus?.unreadPing ? 'Someone pinged you' : 'Updates, pings, and requests'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
          </Pressable>
          <View className="mb-5 rounded-3xl border border-line bg-white p-5">
            <SectionHeader icon="people-outline" title="Your RSVP" meta={`${tara.planRsvps.length}/${tara.planMembers.length} replied`} />
            <View className="flex-row gap-2">
              {rsvpOptions.map((option) => {
                const selected = currentRsvp === option.status;
                return (
                  <Pressable
                    key={option.status}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    disabled={readOnly}
                    onPress={() => void run(() => tara.setRsvp(plan.id, option.status))}
                    className={`flex-1 items-center rounded-2xl border px-2 py-3 ${selected ? 'border-coral bg-coral-soft' : 'border-line bg-cream'}`}
                  >
                    <Ionicons name={option.icon} size={21} color={selected ? '#F36F56' : '#71807C'} />
                    <Text className={`mt-1 text-xs font-bold ${selected ? 'text-coral' : 'text-muted'}`}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="mt-5 gap-3">
              {tara.planMembers.map((member) => {
                const response = tara.planRsvps.find((entry) => entry.userId === member.userId)?.status;
                return (
                  <View key={member.userId} className="flex-row items-center">
                    <Avatar name={member.name} size="sm" />
                    <Text className="ml-3 flex-1 text-sm font-semibold text-ink">{member.name}</Text>
                    {organizer && !readOnly && member.userId !== tara.currentUser.id ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${member.name}`}
                        disabled={managementPending !== null}
                        onPress={() => confirmRemoveMember(member.userId, member.name)}
                        className="mr-3 h-8 w-8 items-center justify-center rounded-xl bg-coral-soft"
                      >
                        <Ionicons name="person-remove-outline" size={16} color="#F36F56" />
                      </Pressable>
                    ) : null}
                    <Text className={`text-xs font-bold ${response === 'going' ? 'text-teal' : response === 'no' ? 'text-coral' : 'text-muted'}`}>
                      {response === 'going' ? 'Going' : response === 'maybe' ? 'Maybe' : response === 'no' ? 'Can’t go' : 'No reply'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View className="mb-5 rounded-3xl border border-line bg-white p-5">
            <SectionHeader icon="basket-outline" title="Bring list" meta={`${openItems} unclaimed`} />
            <View className="gap-3">
              {tara.planContributions.map((item) => {
                const mine = item.claimedBy === tara.currentUser.id;
                return (
                  <View key={item.id} className="flex-row items-center rounded-2xl bg-cream p-3">
                    <View className={`h-10 w-10 items-center justify-center rounded-xl ${item.claimedBy ? 'bg-teal-soft' : 'bg-white'}`}>
                      <Ionicons name={item.claimedBy ? 'checkmark' : 'add'} size={20} color={item.claimedBy ? '#248F83' : '#F36F56'} />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="font-bold text-ink">{item.name}</Text>
                      <Text className="mt-1 text-xs text-muted">{item.claimedByName ? `${item.claimedByName} is bringing this` : item.category}</Text>
                    </View>
                    {!readOnly ? (
                      <Pressable
                        accessibilityLabel={`Ask the chat about ${item.name}`}
                        onPress={() => router.push({ pathname: '/plan/[id]/chat', params: { id: plan.id, requestKind: 'contribution', targetId: item.id, prefill: `Can someone bring ${item.name}?` } })}
                        className="mr-2 h-9 w-9 items-center justify-center rounded-xl bg-white"
                      >
                        <Ionicons name="chatbubble-ellipses-outline" size={17} color="#248F83" />
                      </Pressable>
                    ) : null}
                    {!readOnly && (!item.claimedBy || mine) ? (
                      <Pressable onPress={() => void run(() => tara.claimContribution(plan.id, item.id))} className={`rounded-xl px-3 py-2 ${mine ? 'bg-white' : 'bg-coral-soft'}`}>
                        <Text className={`text-xs font-bold ${mine ? 'text-muted' : 'text-coral'}`}>{mine ? 'Release' : 'I’ll bring it'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {!readOnly ? <View className="mt-4 flex-row rounded-2xl border border-line bg-white p-1">
              <TextInput
                value={contribution}
                onChangeText={setContribution}
                placeholder="Add food, drinks, or gear"
                placeholderTextColor="#93A09C"
                className="h-11 flex-1 px-3 text-sm text-ink"
                onSubmitEditing={() => void addContribution()}
              />
              <Pressable accessibilityLabel="Add contribution" onPress={() => void addContribution()} className="h-11 w-11 items-center justify-center rounded-xl bg-coral">
                <Ionicons name="add" size={22} color="#FFFFFF" />
              </Pressable>
            </View> : null}
          </View>

          <View className="mb-5 rounded-3xl border border-line bg-white p-5">
            <SectionHeader icon="checkbox-outline" title="Tasks" meta={`${openTasks} left`} />
            <View className="gap-3">
              {tara.planTasks.map((planTask) => {
                const mine = planTask.assignedTo === tara.currentUser.id;
                const canToggle = mine || organizer;
                return (
                  <View key={planTask.id} className="flex-row items-center rounded-2xl bg-cream p-3">
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: planTask.done, disabled: !canToggle || readOnly }}
                      disabled={!canToggle || readOnly}
                      onPress={() => void run(() => tara.toggleTask(plan.id, planTask.id))}
                      className={`h-10 w-10 items-center justify-center rounded-xl ${planTask.done ? 'bg-teal' : 'border border-line bg-white'}`}
                    >
                      <Ionicons name={planTask.done ? 'checkmark' : 'ellipse-outline'} size={20} color={planTask.done ? '#FFFFFF' : '#C1C9C6'} />
                    </Pressable>
                    <View className="ml-3 flex-1">
                      <Text className={`font-bold ${planTask.done ? 'text-muted line-through' : 'text-ink'}`}>{planTask.title}</Text>
                      <Text className="mt-1 text-xs text-muted">{planTask.assignedToName ? `Assigned to ${planTask.assignedToName}` : 'Needs an owner'}</Text>
                    </View>
                    {!readOnly ? (
                      <Pressable
                        accessibilityLabel={`Ask the chat about ${planTask.title}`}
                        onPress={() => router.push({ pathname: '/plan/[id]/chat', params: { id: plan.id, requestKind: 'task', targetId: planTask.id, prefill: `Can someone help with ${planTask.title}?` } })}
                        className="mr-2 h-9 w-9 items-center justify-center rounded-xl bg-white"
                      >
                        <Ionicons name="chatbubble-ellipses-outline" size={17} color="#248F83" />
                      </Pressable>
                    ) : null}
                    {!readOnly && (!planTask.assignedTo || mine) && !planTask.done ? (
                      <Pressable onPress={() => void run(() => tara.claimTask(plan.id, planTask.id))} className="rounded-xl bg-teal-soft px-3 py-2">
                        <Text className="text-xs font-bold text-teal">{mine ? 'Unclaim' : 'I’ll do it'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {!readOnly ? <View className="mt-4 flex-row rounded-2xl border border-line bg-white p-1">
              <TextInput
                value={task}
                onChangeText={setTask}
                placeholder="Add a to-do"
                placeholderTextColor="#93A09C"
                className="h-11 flex-1 px-3 text-sm text-ink"
                onSubmitEditing={() => void addTask()}
              />
              <Pressable accessibilityLabel="Add task" onPress={() => void addTask()} className="h-11 w-11 items-center justify-center rounded-xl bg-teal">
                <Ionicons name="add" size={22} color="#FFFFFF" />
              </Pressable>
            </View> : null}
          </View>

          <View className="rounded-3xl border border-line bg-white p-5">
            <SectionHeader icon="information-circle-outline" title="Plan details" meta={organizer ? 'You’re organizing' : `By ${plan.organizerName}`} />
            <Text className="text-sm leading-6 text-muted">{plan.description || 'No extra details yet.'}</Text>
            {organizer && !readOnly ? (
              <View className="mt-5">
                <AppButton label="Edit details" icon="create-outline" variant="ghost" compact onPress={() => router.push({ pathname: '/create', params: { id: plan.id } })} />
              </View>
            ) : null}
          </View>

          <View className="mt-5 rounded-3xl border border-coral bg-coral-soft p-5">
            <Text className="text-lg font-black text-ink">{organizer ? 'Plan management' : 'Leave this plan'}</Text>
            <Text className="mb-4 mt-2 text-sm leading-5 text-muted">
              {organizer
                ? readOnly
                  ? 'This finished plan is locked. You can keep it as a record or delete it permanently.'
                  : 'Finish the plan to lock activity, or delete it and all of its content permanently.'
                : 'Leaving removes your access and releases anything you claimed.'}
            </Text>
            <View className="gap-3">
              {organizer && !readOnly ? (
                <AppButton
                  label="Mark as finished"
                  icon="checkmark-done-outline"
                  variant="secondary"
                  loading={managementPending === 'finish'}
                  disabled={managementPending !== null}
                  onPress={confirmFinish}
                />
              ) : null}
              <AppButton
                label={organizer ? 'Delete plan' : 'Leave plan'}
                icon={organizer ? 'trash-outline' : 'exit-outline'}
                variant="ghost"
                loading={managementPending === (organizer ? 'delete' : 'leave')}
                disabled={managementPending !== null}
                onPress={organizer ? confirmDelete : confirmLeave}
              />
            </View>
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ShareSheet visible={shareVisible} onClose={() => setShareVisible(false)} title={plan.title} code={plan.inviteCode} />
    </View>
  );
}
