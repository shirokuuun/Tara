import { Text, View } from 'react-native';

import { initials } from '@/utils/format';

const palettes = [
  ['#FFE3DC', '#B54432'],
  ['#DDF3EE', '#176C62'],
  ['#FFF0C9', '#9B6714'],
  ['#E8E4FF', '#6554A8'],
];

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const index = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % palettes.length;
  const [backgroundColor, color] = palettes[index];
  const dimensions = size === 'sm' ? 30 : size === 'lg' ? 52 : 40;
  return (
    <View
      accessibilityLabel={name}
      className="items-center justify-center rounded-full border-2 border-white"
      style={{ backgroundColor, width: dimensions, height: dimensions }}
    >
      <Text style={{ color, fontSize: size === 'sm' ? 10 : size === 'lg' ? 17 : 13, fontWeight: '800' }}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function AvatarStack({ names, limit = 4 }: { names: string[]; limit?: number }) {
  const shown = names.slice(0, limit);
  const remaining = names.length - shown.length;
  return (
    <View className="flex-row items-center">
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={{ marginLeft: index ? -8 : 0 }}>
          <Avatar name={name} size="sm" />
        </View>
      ))}
      {remaining > 0 ? (
        <View className="-ml-2 h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-white bg-ink">
          <Text className="text-[9px] font-bold text-white">+{remaining}</Text>
        </View>
      ) : null}
    </View>
  );
}
