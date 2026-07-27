import { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { useAuthStore } from '../store/auth.store';
import { registerBackgroundSync, startNetworkTriggeredSync, stopNetworkTriggeredSync } from '../lib/sync';

import LoginScreen from '../screens/auth/LoginScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ProjectDetailScreen from '../screens/ProjectDetailScreen';
import CaptureSessionScreen from '../screens/CaptureSessionScreen';
import CameraScreen from '../screens/CameraScreen';
import CaptureHistoryScreen from '../screens/CaptureHistoryScreen';
import SyncStatusScreen from '../screens/SyncStatusScreen';
import ProfileScreen from '../screens/ProfileScreen';
import Viewer360Screen from '../screens/Viewer360Screen';

export type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectDetail: { projectId: string; projectName: string };
  CaptureSession: { projectId: string; projectName: string; locationId?: string; locationLabel?: string };
  Camera: {
    projectId: string;
    captureType: 'photo_360' | 'photo_standard' | 'video';
    locationId?: string;
    phase?: string | null;
    title?: string | null;
    description?: string | null;
  };
  Viewer360: { projectId: string; locationId: string };
};

export type HistoryStackParamList = {
  History: undefined;
};

export type SyncStackParamList = {
  Sync: undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
};

const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();
const HistoryStack = createNativeStackNavigator<HistoryStackParamList>();
const SyncStack = createNativeStackNavigator<SyncStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const Tabs = createBottomTabNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.base900 },
  headerTintColor: colors.ink100,
  headerTitleStyle: { fontWeight: '700' as const },
  contentStyle: { backgroundColor: colors.base950 },
};

function ProjectsStackNavigator() {
  return (
    <ProjectsStack.Navigator screenOptions={screenOptions}>
      <ProjectsStack.Screen name="ProjectsList" component={ProjectsScreen} options={{ title: 'Projects' }} />
      <ProjectsStack.Screen
        name="ProjectDetail"
        component={ProjectDetailScreen}
        options={({ route }) => ({ title: route.params.projectName })}
      />
      <ProjectsStack.Screen
        name="CaptureSession"
        component={CaptureSessionScreen}
        options={{ title: 'New Capture' }}
      />
      <ProjectsStack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
      <ProjectsStack.Screen
        name="Viewer360"
        component={Viewer360Screen}
        options={{ title: '360° Viewer', headerStyle: { backgroundColor: colors.base950 } }}
      />
    </ProjectsStack.Navigator>
  );
}

function HistoryStackNavigator() {
  return (
    <HistoryStack.Navigator screenOptions={screenOptions}>
      <HistoryStack.Screen name="History" component={CaptureHistoryScreen} options={{ title: 'Capture History' }} />
    </HistoryStack.Navigator>
  );
}

function SyncStackNavigator() {
  return (
    <SyncStack.Navigator screenOptions={screenOptions}>
      <SyncStack.Screen name="Sync" component={SyncStatusScreen} options={{ title: 'Sync Status' }} />
    </SyncStack.Navigator>
  );
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={screenOptions}>
      <ProfileStack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </ProfileStack.Navigator>
  );
}

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.base950,
    card: colors.base900,
    text: colors.ink100,
    border: colors.base600,
    primary: colors.signal,
  },
};

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.base900, borderTopColor: colors.base600 },
        tabBarActiveTintColor: colors.signal,
        tabBarInactiveTintColor: colors.ink500,
      }}
    >
      <Tabs.Screen name="ProjectsTab" component={ProjectsStackNavigator} options={{ title: 'Projects' }} />
      <Tabs.Screen name="HistoryTab" component={HistoryStackNavigator} options={{ title: 'History' }} />
      <Tabs.Screen name="SyncTab" component={SyncStackNavigator} options={{ title: 'Sync' }} />
      <Tabs.Screen name="ProfileTab" component={ProfileStackNavigator} options={{ title: 'Profile' }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    registerBackgroundSync().catch(() => {});
    startNetworkTriggeredSync();
    return () => stopNetworkTriggeredSync();
  }, []);

  if (!isHydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.blueprint} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {accessToken ? <MainTabs /> : <LoginScreen />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base950, gap: 12 },
  loadingText: { color: colors.ink500, fontSize: 13 },
});
