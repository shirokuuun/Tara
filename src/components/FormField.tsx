import { forwardRef, useState } from 'react';
import { Pressable, Text, TextInput, type TextInputProps, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface FormFieldProps extends TextInputProps {
  label: string;
  hint?: string;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, hint, multiline, secureTextEntry, ...props },
  ref,
) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View className="mb-5">
      <Text className="mb-2 text-sm font-bold text-ink">{label}</Text>
      <View className="relative">
        <TextInput
          ref={ref}
          {...props}
          accessibilityLabel={props.accessibilityLabel || label}
          multiline={multiline}
          secureTextEntry={isPassword && !passwordVisible}
          placeholderTextColor="#93A09C"
          className={`rounded-2xl border border-line bg-white px-4 text-base text-ink ${multiline ? 'min-h-28 py-4' : 'h-14'} ${isPassword ? 'pr-14' : ''}`}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            accessibilityState={{ checked: passwordVisible }}
            hitSlop={8}
            onPress={() => setPasswordVisible((visible) => !visible)}
            className="absolute right-1 top-1 h-12 w-12 items-center justify-center"
          >
            <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={22} color="#71807C" />
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text className="mt-2 text-xs leading-4 text-muted">{hint}</Text> : null}
    </View>
  );
});
