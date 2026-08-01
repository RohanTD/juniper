import {
  IBMPlexMono_400Regular,
  IBMPlexMono_400Regular_Italic,
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
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
import { OnboardingProvider } from '../src/state';

export default function RootLayout() {
  const [medplum, setMedplum] = useState<MedplumClient>();
  // THEME_SYSTEM.md section 1 — the full family set the token map names.
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_400Italic: IBMPlexMono_400Regular_Italic, // note the key rename
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
      <ThemeProvider variant="accessible">
        <OnboardingProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </OnboardingProvider>
      </ThemeProvider>
    </MedplumProvider>
  );
}
