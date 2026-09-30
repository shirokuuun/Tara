import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Keyboard, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { useTara } from '@/providers/TaraProvider';
import type { InvitePreview } from '@/types';
import { formatPlanDate } from '@/utils/format';

export default function JoinPlanScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const tara = useTara();
  const [code, setCode] = useState((params.code || '').toUpperCase());
  const [name, setName] = useState(tara.currentUser.name === 'You' ? '' : tara.currentUser.name);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [joining, setJoining] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);
  const accountName = tara.currentUser.name.trim();
  const needsNameInput = tara.currentUser.isGuest || !accountName || accountName === 'You';

  const lookUp = async (value = code) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;
    setLookingUp(true);
    try {
      const result = await tara.getInvitePreview(normalized);
      setPreview(result);
      if (!result) Alert.alert('Invite not found', 'Check the code or ask the organizer for a new link.');
    } catch (error) {
      Alert.alert('Couldn’t check the invite', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLookingUp(false);
    }
  };

  useEffect(() => {
    if (!params.code) return;
    const timer = setTimeout(() => void lookUp(params.code), 0);
    return () => clearTimeout(timer);
    // The invite should only be resolved when the incoming code changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  useEffect(() => {
    if (!preview) return;
    if (!needsNameInput) {
      Keyboard.dismiss();
      return;
    }
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [needsNameInput, preview]);

  const join = async () => {
    const joiningName = needsNameInput ? name.trim() : accountName;
    if (!joiningName) {
      Alert.alert('Add your name', 'This is how friends will recognize you on the plan.');
      return;
    }
    setJoining(true);
    try {
      const planId = await tara.joinPlan(preview?.code || code, joiningName);
      router.replace({ pathname: '/plan/[id]', params: { id: planId } });
    } catch (error) {
      Alert.alert('Couldn’t join', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-cream" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerClassName="px-5 pb-12 pt-4"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-7">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-teal-soft">
            <Ionicons name="link" size={27} color="#248F83" />
          </View>
          <Text className="mt-5 text-3xl font-black text-ink">You’ve got plans.</Text>
          <Text className="mt-2 text-base leading-6 text-muted">Open an invite link or enter the short code your friend sent.</Text>
        </View>

        <FormField
          label="Invite code"
          placeholder="Enter invite code"
          value={code}
          onChangeText={(value) => {
            setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            setPreview(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
        />

        {!preview ? (
          <AppButton label="Find plan" icon="search" variant="secondary" loading={lookingUp} disabled={!code} onPress={() => void lookUp()} />
        ) : (
          <View className="mb-6 overflow-hidden rounded-3xl border border-line bg-white">
            <View className="h-2 bg-teal" />
            <View className="p-5">
              <Text className="text-xs font-black tracking-[1.5px] text-teal">INVITED BY {preview.organizerName.toUpperCase()}</Text>
              <Text className="mt-2 text-2xl font-black text-ink">{preview.title}</Text>
              <View className="mt-4 flex-row items-center">
                <Ionicons name="calendar-outline" size={18} color="#F36F56" />
                <Text className="ml-2 text-sm font-semibold text-ink">{formatPlanDate(preview.dateTime)}</Text>
              </View>
              <View className="mt-3 flex-row items-center">
                <Ionicons name="location-outline" size={18} color="#F36F56" />
                <Text className="ml-2 flex-1 text-sm text-ink">{preview.location || 'Location to be decided'}</Text>
              </View>
            </View>
          </View>
        )}

        {preview ? (
          <>
            {needsNameInput ? (
              <FormField
                ref={nameInputRef}
                label="Your name"
                placeholder="What should everyone call you?"
                value={name}
                onChangeText={setName}
                onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                autoCapitalize="words"
                autoComplete="name"
                enterKeyHint="done"
                hint={tara.currentUser.isGuest
                  ? 'This name identifies your guest profile to the group.'
                  : 'Add a display name before joining this plan.'}
              />
            ) : null}
            <AppButton label="Join this plan" icon="arrow-forward" loading={joining} onPress={() => void join()} />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
