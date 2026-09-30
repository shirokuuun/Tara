import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Plan, PlanChatStatus, PlanMember, RSVP } from '@/types';
import { formatPlanDate, isPlanReadOnly } from '@/utils/format';
import { AvatarStack } from './Avatar';

export function PlanCard({
  plan,
  members,
  rsvps,
  chatStatus,
  onPress,
}: {
  plan: Plan;
  members: PlanMember[];
  rsvps: RSVP[];
  chatStatus?: PlanChatStatus;
  onPress: () => void;
}) {
  const going = rsvps.filter((item) => item.status === 'going').length;
  const readOnly = isPlanReadOnly(plan.dateTime, plan.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${plan.title}`}
      onPress={onPress}
      className="mb-4 overflow-hidden rounded-3xl border border-line bg-white"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View className={`h-2 ${readOnly ? 'bg-muted' : 'bg-coral'}`} />
      <View className="p-5">
        <View className="flex-row items-start justify-between">
          <View className="mr-4 flex-1">
            <Text className="text-xl font-black text-ink" numberOfLines={2}>{plan.title}</Text>
            {readOnly ? <Text className="mt-2 self-start rounded-full bg-cream px-2 py-1 text-[10px] font-black tracking-[1px] text-muted">FINISHED</Text> : null}
            <View className="mt-3 flex-row items-center">
              <Ionicons name="calendar-outline" size={16} color="#248F83" />
              <Text className="ml-2 flex-1 text-sm font-semibold text-teal">{formatPlanDate(plan.dateTime, true)}</Text>
            </View>
            <View className="mt-2 flex-row items-center">
              <Ionicons name="location-outline" size={16} color="#71807C" />
              <Text className="ml-2 flex-1 text-sm text-muted" numberOfLines={1}>{plan.location || 'Location to be decided'}</Text>
            </View>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-cream">
            <Ionicons name={chatStatus?.unreadPing ? 'notifications' : chatStatus?.unread ? 'chatbubble' : 'arrow-forward'} size={19} color={chatStatus?.unread ? '#F36F56' : '#20302C'} />
          </View>
        </View>
        <View className="mt-5 flex-row items-center justify-between border-t border-line pt-4">
          <AvatarStack names={members.map((member) => member.name)} />
          <Text className="text-xs font-semibold text-muted">{going} going · {members.length} invited</Text>
        </View>
        {chatStatus?.unread ? (
          <View className="mt-3 flex-row items-center rounded-xl bg-coral-soft px-3 py-2">
            <View className="mr-2 h-2 w-2 rounded-full bg-coral" />
            <Text className="text-xs font-bold text-coral">{chatStatus.unreadPing ? 'New ping in plan chat' : 'New messages in plan chat'}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
