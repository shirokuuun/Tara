import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { LoadingScreen } from '@/components/ScreenState';
import { usePlan } from '@/providers/TaraProvider';
import type { ChatMessage, ChatRequestKind, ChatSnapshot } from '@/types';
import { isPlanReadOnly, makeId } from '@/utils/format';
import { enablePushNotifications, getNotificationPermission, setActiveChatPlan } from '@/utils/notifications';

function messageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function PlanChatScreen() {
  const params = useLocalSearchParams<{ id: string; messageId?: string; requestKind?: ChatRequestKind; targetId?: string; prefill?: string }>();
  const tara = usePlan(params.id);
  const { markChatRead } = tara;
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [chat, setChat] = useState<ChatSnapshot>({ messages: [], loading: true, hasOlder: false });
  const [text, setText] = useState(params.prefill || '');
  const [requestKind, setRequestKind] = useState<ChatRequestKind | null>(params.requestKind || null);
  const [targetId, setTargetId] = useState(params.targetId);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState(() => makeId('chat'));
  const [permission, setPermission] = useState<'granted' | 'prompt' | 'denied' | 'unavailable'>('unavailable');
  const ensuredMessage = useRef<string | undefined>(undefined);

  useEffect(() => {
    setActiveChatPlan(params.id);
    const unsubscribe = tara.subscribeChat(params.id, setChat);
    void getNotificationPermission().then(setPermission);
    return () => {
      setActiveChatPlan(null);
      unsubscribe();
    };
    // The repository subscription is stable for the provider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (!params.messageId || ensuredMessage.current === params.messageId) return;
    ensuredMessage.current = params.messageId;
    void tara.ensureChatMessage(params.id, params.messageId);
    // The repository action is stable for the provider lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.messageId]);

  useEffect(() => {
    if (!params.messageId) return;
    const index = chat.messages.findIndex((message) => message.id === params.messageId);
    if (index >= 0) setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }), 100);
  }, [chat.messages, params.messageId]);

  const selectedMembers = useMemo(
    () => tara.planMembers.filter((member) => mentionIds.includes(member.userId)),
    [mentionIds, tara.planMembers],
  );
  const muted = tara.chatStatus?.notificationsMuted || false;

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatMessage>[] }) => {
    const visible = viewableItems
      .map((entry) => entry.item)
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const newest = visible[0];
    if (newest) void markChatRead(params.id, newest.id, newest.createdAt);
  }, [markChatRead, params.id]);

  if (tara.loading) return <LoadingScreen />;
  if (!tara.plan) return null;
  const plan = tara.plan;
  const active = !isPlanReadOnly(plan.dateTime, plan.status);

  const send = async () => {
    const cleanText = text.trim();
    if (!cleanText || sending || !active) return;
    setSending(true);
    setSendError(null);
    try {
      await tara.sendChatMessage(plan.id, {
        operationId,
        text: cleanText,
        mentionUserIds: mentionIds,
        ...(requestKind ? {
          request: {
            kind: requestKind,
            ...(targetId ? { targetId } : { title: cleanText }),
          },
        } : {}),
      });
      setText('');
      setMentionIds([]);
      setRequestKind(null);
      setTargetId(undefined);
      setOperationId(makeId('chat'));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The message was not sent.');
    } finally {
      setSending(false);
    }
  };

  const enableNotifications = async () => {
    try {
      const token = await enablePushNotifications();
      await tara.registerPushToken(token);
      setPermission('granted');
    } catch (error) {
      Alert.alert('Couldn’t enable notifications', error instanceof Error ? error.message : 'Please try again.');
      setPermission(await getNotificationPermission());
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const mine = item.senderId === tara.currentUser.id;
    const contribution = item.request?.kind === 'contribution'
      ? tara.planContributions.find((entry) => entry.id === item.request?.targetId)
      : undefined;
    const task = item.request?.kind === 'task'
      ? tara.planTasks.find((entry) => entry.id === item.request?.targetId)
      : undefined;
    const unavailable = Boolean(item.request && !contribution && !task);
    const claimedBy = contribution?.claimedBy || task?.assignedTo;
    const claimedByName = contribution?.claimedByName || task?.assignedToName;
    const mineClaim = claimedBy === tara.currentUser.id;
    const mentionedNames = tara.planMembers.filter((member) => item.mentionUserIds.includes(member.userId)).map((member) => member.name);

    return (
      <View className={`mb-4 flex-row items-end ${mine ? 'justify-end' : 'justify-start'}`}>
        {!mine ? <View className="mr-2"><Avatar name={item.senderName} size="sm" /></View> : null}
        <View
          className={`max-w-[82%] rounded-3xl px-4 py-3 ${mine ? 'rounded-br-md bg-teal' : 'rounded-bl-md border border-line bg-white'}`}
          style={{ flexShrink: 1, maxWidth: '82%' }}
        >
          {!mine ? <Text className="mb-1 text-xs font-black text-teal">{item.senderName}</Text> : null}
          <Text className={`text-[15px] leading-5 ${mine ? 'text-white' : 'text-ink'}`}>{item.text}</Text>
          {mentionedNames.length ? (
            <Text className={`mt-2 text-xs font-bold ${mine ? 'text-white/80' : 'text-coral'}`}>Pinged {mentionedNames.join(', ')}</Text>
          ) : null}
          {item.request ? (
            <View className={`mt-3 rounded-2xl p-3 ${mine ? 'bg-white/15' : 'bg-cream'}`}>
              <View className="flex-row items-center">
                <Ionicons name={item.request.kind === 'task' ? 'checkbox-outline' : 'basket-outline'} size={18} color={mine ? '#FFFFFF' : '#248F83'} />
                <Text className={`ml-2 flex-1 text-xs font-black uppercase ${mine ? 'text-white' : 'text-teal'}`}>
                  {item.request.kind === 'task' ? 'Help needed' : 'Bring request'}
                </Text>
              </View>
              <Text className={`mt-2 font-bold ${mine ? 'text-white' : 'text-ink'}`}>
                {contribution?.name || task?.title || 'This board item is unavailable'}
              </Text>
              {!unavailable ? (
                claimedBy ? (
                  <Text className={`mt-2 text-xs ${mine ? 'text-white/80' : 'text-muted'}`}>{claimedByName} volunteered</Text>
                ) : active ? (
                  <Pressable
                    onPress={() => void (item.request?.kind === 'task'
                      ? tara.claimTask(item.planId, item.request.targetId)
                      : tara.claimContribution(item.planId, item.request!.targetId))}
                    className="mt-3 self-start rounded-xl bg-coral px-3 py-2"
                  >
                    <Text className="text-xs font-black text-white">I can help</Text>
                  </Pressable>
                ) : null
              ) : null}
              {mineClaim && active ? (
                <Pressable
                  onPress={() => void (item.request?.kind === 'task'
                    ? tara.claimTask(item.planId, item.request.targetId)
                    : tara.claimContribution(item.planId, item.request!.targetId))}
                  className="mt-2 self-start"
                >
                  <Text className={`text-xs font-bold ${mine ? 'text-white' : 'text-coral'}`}>Release claim</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Text className={`mt-2 text-right text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>{messageTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 overflow-hidden bg-cream" edges={['bottom']} style={{ maxWidth: '100%', width: '100%' }}>
      <Stack.Screen options={{
        title: tara.plan.title,
        headerRight: () => (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: muted }}
            accessibilityLabel={muted ? 'Unmute plan notifications' : 'Mute plan notifications'}
            onPress={() => void tara.setPlanNotificationsMuted(tara.plan!.id, !muted)}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name={muted ? 'notifications-off-outline' : 'notifications-outline'} size={21} color="#20302C" />
          </Pressable>
        ),
      }} />
      {permission !== 'granted' && permission !== 'unavailable' ? (
        <Pressable onPress={() => void enableNotifications()} className="mx-4 mt-3 flex-row items-center rounded-2xl bg-teal-soft px-4 py-3">
          <Ionicons name="notifications-outline" size={20} color="#248F83" />
          <Text className="ml-3 flex-1 text-sm font-bold text-teal">Enable notifications for pings and requests</Text>
          <Ionicons name="chevron-forward" size={18} color="#248F83" />
        </Pressable>
      ) : null}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
        <FlatList
          ref={listRef}
          className="flex-1"
          style={{ maxWidth: '100%', width: '100%' }}
          data={chat.messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerClassName="px-4 pb-4 pt-5"
          contentContainerStyle={{ maxWidth: '100%', width: '100%' }}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 250 }}
          onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: Math.max(0, index * 120), animated: true })}
          ListHeaderComponent={chat.hasOlder ? (
            <Pressable onPress={() => void tara.loadOlderChat(tara.plan!.id)} className="mb-5 self-center rounded-full bg-white px-4 py-2">
              <Text className="text-xs font-bold text-teal">Load older messages</Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={!chat.loading ? (
            <View className="w-full items-center px-8 py-16">
              <Ionicons name="chatbubbles-outline" size={44} color="#248F83" />
              <Text className="mt-4 text-xl font-black text-ink">Start the plan chat</Text>
              <Text className="mt-2 max-w-[300px] text-center text-sm leading-5 text-muted">Share an update, ping a member, or ask the group for help.</Text>
            </View>
          ) : null}
        />
        <View className="border-t border-line bg-white px-4 pb-3 pt-3">
          {showMentions ? (
            <View className="mb-3 max-h-40 rounded-2xl border border-line bg-cream p-2">
              {tara.planMembers.filter((member) => member.userId !== tara.currentUser.id).map((member) => {
                const selected = mentionIds.includes(member.userId);
                return (
                  <Pressable key={member.userId} onPress={() => setMentionIds((current) => selected ? current.filter((id) => id !== member.userId) : current.length < 5 ? [...current, member.userId] : current)} className="flex-row items-center rounded-xl px-3 py-2">
                    <Avatar name={member.name} size="sm" />
                    <Text className="ml-3 flex-1 font-bold text-ink">{member.name}</Text>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color="#248F83" /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {selectedMembers.length ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {selectedMembers.map((member) => <Text key={member.userId} className="rounded-full bg-coral-soft px-3 py-1 text-xs font-bold text-coral">@{member.name}</Text>)}
            </View>
          ) : null}
          {requestKind ? (
            <View className="mb-2 flex-row items-center rounded-xl bg-teal-soft px-3 py-2">
              <Ionicons name={requestKind === 'task' ? 'checkbox-outline' : 'basket-outline'} size={17} color="#248F83" />
              <Text className="ml-2 flex-1 text-xs font-bold text-teal">{targetId ? 'Sharing a board request' : requestKind === 'task' ? 'Create a task request' : 'Create a bring request'}</Text>
              <Pressable onPress={() => { setRequestKind(null); setTargetId(undefined); }}><Ionicons name="close" size={19} color="#248F83" /></Pressable>
            </View>
          ) : null}
          {sendError ? (
            <Pressable onPress={() => void send()} className="mb-2 flex-row items-center rounded-xl bg-coral-soft px-3 py-2">
              <Text className="flex-1 text-xs font-semibold text-coral" numberOfLines={2}>{sendError}</Text>
              <Text className="ml-2 text-xs font-black text-coral">Retry</Text>
            </Pressable>
          ) : null}
          <View className="w-full flex-row items-end" style={{ width: '100%' }}>
            <Pressable disabled={!active} onPress={() => setShowMentions((value) => !value)} className="h-11 w-10 items-center justify-center" style={{ flexShrink: 0 }}>
              <Text className="text-xl font-black text-coral">@</Text>
            </Pressable>
            <Pressable disabled={!active} onPress={() => setRequestKind((value) => value ? null : 'contribution')} className="h-11 w-10 items-center justify-center" style={{ flexShrink: 0 }}>
              <Ionicons name="hand-left-outline" size={21} color={requestKind ? '#248F83' : '#71807C'} />
            </Pressable>
            <View className="min-w-0 flex-1" style={{ flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              <TextInput
                value={text}
                onChangeText={(value) => { setText(value); if (sendError) setSendError(null); }}
                editable={active && !sending}
                multiline
                maxLength={2000}
                placeholder={active ? requestKind ? 'What does the group need?' : 'Message the group' : 'This plan is read-only'}
                placeholderTextColor="#93A09C"
                className="max-h-28 min-h-11 w-full rounded-2xl bg-cream px-4 py-3 text-[15px] text-ink"
                style={{ minWidth: 0, width: '100%' }}
              />
            </View>
            <Pressable
              disabled={!text.trim() || sending || !active}
              onPress={() => void send()}
              style={{
                alignItems: 'center',
                backgroundColor: text.trim() && !sending && active ? '#248F83' : '#E3E8E6',
                borderRadius: 22,
                flexShrink: 0,
                height: 44,
                justifyContent: 'center',
                marginLeft: 8,
                width: 44,
              }}
            >
              <Ionicons name={sending ? 'hourglass-outline' : 'arrow-up'} size={21} color="#FFFFFF" />
            </Pressable>
          </View>
          {requestKind && !targetId ? (
            <View className="ml-20 mt-2 flex-row gap-2">
              {(['contribution', 'task'] as ChatRequestKind[]).map((kind) => (
                <Pressable key={kind} onPress={() => setRequestKind(kind)} className={`rounded-full px-3 py-1 ${requestKind === kind ? 'bg-teal' : 'bg-cream'}`}>
                  <Text className={`text-xs font-bold ${requestKind === kind ? 'text-white' : 'text-muted'}`}>{kind === 'task' ? 'Task' : 'Bring item'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
