import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
} from '@expo-google-fonts/outfit';
import { createMedplumClient } from '@juniper/medplum-rn';
import { ThemeProvider } from '@juniper/theme';
import type { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react-hooks';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ENV } from '../src/env';

export default function RootLayout() {
  const [medplum, setMedplum] = useState<MedplumClient>();
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    let mounted = true;
    createMedplumClient({
      baseUrl: ENV.medplumBaseUrl,
      clientId: ENV.medplumClientId,
    }).then((client) => {
      if (mounted) {
        setMedplum(client);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!medplum || (!fontsLoaded && !fontError)) {
    return null;
  }

  return (
    <MedplumProvider medplum={medplum}>
      {/* Family app runs the BASE variant: its readers are adult children. */}
      <ThemeProvider variant="base">
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </MedplumProvider>
  );
}
