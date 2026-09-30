import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItem,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { TaraLogo } from '@/components/TaraLogo';
import { ONBOARDING_KEY } from './index';

interface Slide {
  eyebrow: string;
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  detail: string;
}

const slides: Slide[] = [
  {
    eyebrow: 'ONE PLAN, ONE PLACE',
    title: 'Make a plan everyone can find.',
    body: 'Give every hangout a clear home for the when, where, and who.',
    icon: 'calendar',
    accent: '#F36F56',
    detail: 'Saturday · 9:00 AM',
  },
  {
    eyebrow: 'PITCH IN TOGETHER',
    title: 'Know who’s bringing what.',
    body: 'Claim food, gear, and tasks without digging through hundreds of messages.',
    icon: 'basket',
    accent: '#248F83',
    detail: 'Snacks · claimed by Ana',
  },
  {
    eyebrow: 'NO SIGNUP WALL',
    title: 'Tap the invite. Add your name. You’re in.',
    body: 'Friends can RSVP and help immediately, even without making a full account.',
    icon: 'people',
    accent: '#E8A83E',
    detail: '4 friends are going',
  },
];

function Illustration({ slide }: { slide: Slide }) {
  return (
    <View className="h-72 items-center justify-center">
      <View className="absolute h-64 w-64 rounded-full bg-white opacity-70" />
      <View className="absolute left-8 top-8 h-12 w-12 rotate-12 rounded-2xl bg-gold opacity-70" />
      <View className="absolute bottom-5 right-8 h-16 w-16 rounded-full bg-teal-soft" />
      <View className="w-[78%] rotate-[-3deg] rounded-[32px] border border-line bg-white p-5 shadow-sm">
        <View className="flex-row items-center">
          <View className="h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: slide.accent }}>
            <Ionicons name={slide.icon} color="#FFFFFF" size={27} />
          </View>
          <View className="ml-4 flex-1">
            <View className="mb-2 h-3 w-24 rounded-full bg-line" />
            <View className="h-3 w-36 rounded-full bg-line opacity-70" />
          </View>
        </View>
        <View className="mt-5 rounded-2xl bg-cream px-4 py-4">
          <Text className="text-sm font-bold text-ink">{slide.detail}</Text>
          <View className="mt-3 h-2 w-2/3 rounded-full bg-line" />
        </View>
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/auth');
  };

  const next = () => {
    if (index === slides.length - 1) {
      void finish();
      return;
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const renderItem: ListRenderItem<Slide> = ({ item }) => (
    <View style={{ width }} className="px-7">
      <Illustration slide={item} />
      <Text className="mt-2 text-xs font-black tracking-[2px] text-coral">{item.eyebrow}</Text>
      <Text className="mt-3 text-[34px] font-black leading-[40px] text-ink">{item.title}</Text>
      <Text className="mt-4 text-base leading-6 text-muted">{item.body}</Text>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-row items-center justify-between px-7 pt-2">
        <TaraLogo compact />
        <Pressable accessibilityRole="button" onPress={() => void finish()} hitSlop={12}>
          <Text className="font-bold text-muted">Skip</Text>
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.eyebrow}
        renderItem={renderItem}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
      />
      <View className="px-7 pb-5">
        <View className="mb-6 flex-row justify-center">
          {slides.map((slide, slideIndex) => (
            <View
              key={slide.eyebrow}
              className={`mx-1 h-2 rounded-full ${slideIndex === index ? 'w-7 bg-coral' : 'w-2 bg-line'}`}
            />
          ))}
        </View>
        <AppButton
          label={index === slides.length - 1 ? 'Start planning' : 'Next'}
          icon="arrow-forward"
          onPress={next}
        />
      </View>
    </SafeAreaView>
  );
}
