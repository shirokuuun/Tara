import Constants from 'expo-constants';
import { Platform } from 'react-native';

type ExpoNotifications = typeof import('expo-notifications');
type Notification = import('expo-notifications').Notification;

export type NotificationTarget = {
  planId?: string;
  messageId?: string;
};

let activeChatPlanId: string | null = null;
let notificationsPromise: Promise<ExpoNotifications> | null = null;

// Remote notifications intentionally throw during module initialization in
// Expo Go on Android. Load the native module only in an installed app build.
const nativeNotificationsAvailable = Platform.OS !== 'web' && Constants.expoGoConfig == null;

function loadNotifications() {
  if (!nativeNotificationsAvailable) return null;
  notificationsPromise ??= import('expo-notifications');
  return notificationsPromise;
}

const notificationModule = loadNotifications();
if (notificationModule) {
  void notificationModule.then((Notifications) => Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const planId = notification.request.content.data?.planId;
      const show = typeof planId !== 'string' || planId !== activeChatPlanId;
      return {
        shouldPlaySound: show,
        shouldSetBadge: show,
        shouldShowBanner: show,
        shouldShowList: show,
      };
    },
  }));
}

export function setActiveChatPlan(planId: string | null) {
  activeChatPlanId = planId;
}

export async function getNotificationPermission() {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unavailable' as const;
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted ? 'granted' as const : permission.canAskAgain ? 'prompt' as const : 'denied' as const;
}

export async function enablePushNotifications() {
  const Notifications = await loadNotifications();
  if (!Notifications) throw new Error('Push notifications require an installed development or preview build.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tara-pings', {
      name: 'Tara pings and requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#248F83',
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notifications are off. You can enable them later in your device settings.');

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error('Tara is not linked to an EAS project yet. Add the EAS project ID before enabling push.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export function getNotificationTarget(notification: Notification | undefined): NotificationTarget {
  const data = notification?.request.content.data;
  return {
    planId: typeof data?.planId === 'string' ? data.planId : undefined,
    messageId: typeof data?.messageId === 'string' ? data.messageId : undefined,
  };
}

export async function getLastNotificationTarget() {
  const Notifications = await loadNotifications();
  return getNotificationTarget(Notifications?.getLastNotificationResponse()?.notification);
}

export async function addNotificationResponseListener(listener: (target: NotificationTarget) => void) {
  const Notifications = await loadNotifications();
  if (!Notifications) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    listener(getNotificationTarget(response.notification));
  });
  return () => subscription.remove();
}
