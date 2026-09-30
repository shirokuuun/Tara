import { Text, View } from 'react-native';

interface TaraLogoProps {
  compact?: boolean;
  inverted?: boolean;
}

export function TaraLogo({ compact = false, inverted = false }: TaraLogoProps) {
  return (
    <View className="flex-row items-center" accessibilityLabel="Tara">
      <View className={`${compact ? 'h-9 w-9' : 'h-11 w-11'} items-center justify-center rounded-2xl bg-coral`}>
        <Text className={`${compact ? 'text-lg' : 'text-2xl'} font-black text-white`}>T</Text>
      </View>
      <Text className={`${compact ? 'ml-2 text-2xl' : 'ml-3 text-3xl'} font-black ${inverted ? 'text-white' : 'text-ink'}`}>
        tara
      </Text>
    </View>
  );
}
