import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { fontMap } from '../src/fonts';
import { LangProvider } from '../src/i18n';
import { AnalysisProvider } from '../src/store';
import { AuthProvider } from '../src/auth';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [loaded] = useFonts(fontMap);

  // Fontlar yüklenene kadar zemin rengiyle boş görünüm — flash olmasın
  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <LangProvider>
        <AuthProvider>
          <AnalysisProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="analyze" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="connect" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            </Stack>
          </AnalysisProvider>
        </AuthProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
