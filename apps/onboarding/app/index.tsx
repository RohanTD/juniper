/**
 * Magic-link entry. The link a patient (or family member, or clinic staff)
 * opens lands here — on a phone or a laptop. No account creation, no
 * password: "Begin setup" hands off to Medplum's hosted auth via PKCE.
 */
import { signInWithMedplum } from '@juniper/medplum-rn';
import { useTheme } from '@juniper/theme';
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { APP_SCHEME, ENV } from '../src/env';
import { useOnboarding } from '../src/state';
import { PrimaryButton } from '../src/ui/Buttons';
import { Screen } from '../src/ui/Screen';
import { ThemedText } from '../src/ui/ThemedText';

export default function Welcome() {
  const theme = useTheme();
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { update } = useOnboarding();
  const params = useLocalSearchParams<{ patient?: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  // A magic link may carry the patient id (web deep link).
  useEffect(() => {
    if (typeof params.patient === 'string' && params.patient) {
      update({ patientId: params.patient });
    }
  }, [params.patient, update]);

  const begin = async () => {
    setMessage(undefined);
    if (profile) {
      router.push('/steps/who');
      return;
    }
    setBusy(true);
    try {
      const signedIn = await signInWithMedplum(medplum, {
        clientId: ENV.medplumClientId,
        scheme: APP_SCHEME,
      });
      if (signedIn) {
        router.push('/steps/who');
      } else {
        setMessage('Sign-in was not completed. You can try again whenever you are ready.');
      }
    } catch {
      setMessage('Something went wrong signing in. Please try the link from your message again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <ThemedText variant="eyebrow" color={theme.recipes.hero.eyebrow.color}>
          Juniper
        </ThemedText>
        <ThemedText variant="displayLg">A friendly check-in call, made just for you.</ThemedText>
        <ThemedText variant="bodyLg" color={theme.colors.text.secondary}>
          Juniper calls to chat, see how you are doing, and keep your care team in the loop. This
          short setup takes about five minutes, and you will never need this app again afterward.
        </ThemedText>
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          No password needed — the secure link you received signs you in.
        </ThemedText>
        {message ? (
          <ThemedText variant="body" color={theme.colors.semantic.error.text}>
            {message}
          </ThemedText>
        ) : null}
      </View>
      <PrimaryButton title={busy ? 'Opening secure sign-in…' : 'Begin setup'} onPress={begin} disabled={busy} />
    </Screen>
  );
}
