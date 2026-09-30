import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton } from './AppButton';

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-cream">
      <ActivityIndicator color="#F36F56" size="large" />
      <Text className="mt-4 font-semibold text-muted">Getting the plan together…</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View className="items-center rounded-3xl border border-line bg-white px-7 py-9">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-teal-soft">
        <Ionicons name={icon} size={26} color="#248F83" />
      </View>
      <Text className="mt-4 text-center text-lg font-extrabold text-ink">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-muted">{message}</Text>
      {action && onAction ? (
        <View className="mt-5 w-full">
          <AppButton label={action} onPress={onAction} variant="secondary" compact />
        </View>
      ) : null}
    </View>
  );
}
