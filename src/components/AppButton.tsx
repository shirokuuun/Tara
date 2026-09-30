import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

const variants: Record<ButtonVariant, { box: string; text: string; icon: string }> = {
  primary: { box: 'bg-coral', text: 'text-white', icon: '#FFFFFF' },
  secondary: { box: 'bg-teal-soft', text: 'text-teal', icon: '#248F83' },
  ghost: { box: 'bg-white border border-line', text: 'text-ink', icon: '#20302C' },
  dark: { box: 'bg-ink', text: 'text-white', icon: '#FFFFFF' },
};

export function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
}: AppButtonProps) {
  const style = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      className={`${style.box} ${compact ? 'h-11 px-4' : 'h-14 px-5'} flex-row items-center justify-center rounded-2xl ${disabled ? 'opacity-40' : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      {loading ? (
        <ActivityIndicator color={style.icon} />
      ) : (
        <View className="flex-row items-center">
          {icon ? <Ionicons name={icon} size={19} color={style.icon} /> : null}
          <Text className={`${style.text} ${icon ? 'ml-2' : ''} text-base font-bold`}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
