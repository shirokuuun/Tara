import { useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";

import { AppButton } from "@/components/AppButton";
import { FormField } from "@/components/FormField";
import { useTara } from "@/providers/TaraProvider";
import { isPlanDateLocked } from "@/utils/format";

type PickerMode = "date" | "time" | null;

function defaultDate() {
  const value = new Date();
  value.setDate(value.getDate() + 7);
  value.setHours(18, 0, 0, 0);
  return value;
}

export default function CreatePlanScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tara = useTara();
  const existing = useMemo(
    () => tara.plans.find((plan) => plan.id === id),
    [id, tara.plans],
  );
  const isEditing = Boolean(existing);
  const dateLocked = Boolean(existing && isPlanDateLocked(existing.dateTime));
  const [name, setName] = useState(
    tara.currentUser.name === "You" ? "" : tara.currentUser.name,
  );
  const [title, setTitle] = useState(existing?.title || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [date, setDate] = useState(
    existing?.dateTime ? new Date(existing.dateTime) : defaultDate(),
  );
  const [dateUndecided, setDateUndecided] = useState(
    existing ? !existing.dateTime : false,
  );
  const [location, setLocation] = useState(existing?.location || "");
  const [coverUri, setCoverUri] = useState(existing?.coverUri);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [saving, setSaving] = useState(false);

  const pickCover = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled) setCoverUri(result.assets[0].uri);
  };

  const onDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setPickerMode(null);
    if (event.type !== "dismissed" && selected) setDate(selected);
  };

  const save = async () => {
    if (!title.trim()) {
      Alert.alert(
        "Give your plan a title",
        "A short, recognizable title helps everyone find it.",
      );
      return;
    }
    if (!isEditing && tara.currentUser.name === "You" && !name.trim()) {
      Alert.alert(
        "Add your name",
        "Friends need to know who started the plan.",
      );
      return;
    }
    setSaving(true);
    try {
      if (!isEditing && name.trim()) await tara.setGuestName(name);
      const input = {
        title: title.trim(),
        description: description.trim(),
        dateTime: dateUndecided ? null : date.toISOString(),
        location: location.trim(),
        coverUri,
      };
      if (existing) {
        await tara.updatePlan(existing.id, input);
        router.back();
      } else {
        const planId = await tara.createPlan(input);
        router.replace({ pathname: "/plan/[id]", params: { id: planId } });
      }
    } catch (error) {
      Alert.alert(
        "Couldn’t save the plan",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ title: isEditing ? "Edit plan" : "New plan" }} />
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentContainerClassName="px-5 pb-12 pt-3"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-7">
          <Text className="text-3xl font-black text-ink">
            {isEditing ? "Keep everyone updated" : "What’s the plan?"}
          </Text>
          <Text className="mt-2 text-base leading-6 text-muted">
            {isEditing
              ? "Changes appear for everyone on the plan."
              : "Start with the basics. Friends can help with the rest."}
          </Text>
        </View>

        {!isEditing && tara.currentUser.name === "You" ? (
          <FormField
            label="Your name"
            placeholder="What should friends call you?"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        ) : null}

        <FormField
          label="Plan title"
          placeholder="Beach day, birthday dinner…"
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />
        <FormField
          label="Description"
          placeholder="Add the vibe, important details, or a quick note."
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
        />

        <View className="mb-5">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm font-bold text-ink">Date & time</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dateUndecided }}
              disabled={dateLocked}
              onPress={() => setDateUndecided((current) => !current)}
              className={`flex-row items-center ${dateLocked ? "opacity-40" : ""}`}
            >
              <Ionicons
                name={dateUndecided ? "checkbox" : "square-outline"}
                size={21}
                color="#248F83"
              />
              <Text className="ml-2 text-sm font-semibold text-teal">
                Decide later
              </Text>
            </Pressable>
          </View>
          {!dateUndecided ? (
            <View className="flex-row gap-3">
              <Pressable
                disabled={dateLocked}
                onPress={() => setPickerMode("date")}
                className={`h-14 flex-1 flex-row items-center rounded-2xl border border-line bg-white px-4 ${dateLocked ? "opacity-50" : ""}`}
              >
                <Ionicons name="calendar-outline" size={20} color="#F36F56" />
                <Text className="ml-3 font-semibold text-ink">
                  {date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
              </Pressable>
              <Pressable
                disabled={dateLocked}
                onPress={() => setPickerMode("time")}
                className={`h-14 flex-1 flex-row items-center rounded-2xl border border-line bg-white px-4 ${dateLocked ? "opacity-50" : ""}`}
              >
                <Ionicons name="time-outline" size={20} color="#F36F56" />
                <Text className="ml-3 font-semibold text-ink">
                  {date.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="h-14 justify-center rounded-2xl border border-dashed border-teal bg-teal-soft px-4">
              <Text className="font-semibold text-teal">
                Friends can pick a date in a future poll.
              </Text>
            </View>
          )}
          {dateLocked ? (
            <Text className="mt-2 text-xs font-semibold text-coral">
              The date is locked during the final 24 hours before the plan.
            </Text>
          ) : null}
          {pickerMode ? (
            <View className="mt-3 rounded-2xl bg-white p-2">
              <DateTimePicker
                value={date}
                mode={pickerMode}
                onChange={onDateChange}
                minimumDate={isEditing ? undefined : new Date()}
              />
              {Platform.OS === "ios" ? (
                <Pressable
                  onPress={() => setPickerMode(null)}
                  className="items-end px-3 pb-2"
                >
                  <Text className="font-bold text-teal">Done</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        <FormField
          label="Location"
          placeholder="Venue, address, or “decide later”"
          value={location}
          onChangeText={setLocation}
          autoCapitalize="words"
        />

        <View className="mb-7">
          <Text className="mb-2 text-sm font-bold text-ink">
            Cover photo{" "}
            <Text className="font-normal text-muted">(optional)</Text>
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a cover photo"
            onPress={() => void pickCover()}
            className="h-44 overflow-hidden rounded-3xl border border-dashed border-line bg-white"
          >
            {coverUri ? (
              <Image
                source={{ uri: coverUri }}
                className="h-full w-full"
                resizeMode="cover"
              />
            ) : (
              <View className="flex-1 items-center justify-center">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-coral-soft">
                  <Ionicons name="image-outline" size={24} color="#F36F56" />
                </View>
                <Text className="mt-3 font-bold text-ink">
                  Add a little personality
                </Text>
                <Text className="mt-1 text-xs text-muted">
                  Choose from your photos
                </Text>
              </View>
            )}
          </Pressable>
          {coverUri ? (
            <Pressable
              onPress={() => setCoverUri(undefined)}
              className="mt-2 self-end"
            >
              <Text className="text-sm font-bold text-coral">Remove photo</Text>
            </Pressable>
          ) : null}
        </View>

        <AppButton
          label={isEditing ? "Save changes" : "Create plan"}
          icon="checkmark"
          loading={saving}
          onPress={() => void save()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
