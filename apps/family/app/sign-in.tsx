import { signInWithMedplum } from '@juniper/medplum-rn';
import { resolveTextStyle, useTheme } from '@juniper/theme';
import { useMedplum } from '@medplum/react-hooks';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View, type TextStyle } from 'react-native';
import { APP_SCHEME, ENV } from '../src/env';
import { Screen } from '../src/ui/Screen';
import { ThemedText } from '../src/ui/ThemedText';

export default function SignIn() {
  const theme = useTheme();
  const medplum = useMedplum();
  const { fontScale } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const button = theme.recipes.button.primary;

  const signIn = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const profile = await signInWithMedplum(medplum, {
        clientId: ENV.medplumClientId,
        scheme: APP_SCHEME,
      });
      if (profile) {
        router.replace('/');
      } else {
        setMessage('Sign-in was not completed. Please try again.');
      }
    } catch {
      setMessage('Something went wrong signing in. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
        <ThemedText variant="eyebrow" color={theme.recipes.hero.eyebrow.color}>
          Juniper Family
        </ThemedText>
        <ThemedText variant="title">Sign in to follow along</ThemedText>
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          See how check-in calls are going, read plain-language summaries, and get notified if
          anything needs attention. Access is managed by the care team — if you were added as a
          caregiver, your sign-in just works.
        </ThemedText>
        {message ? (
          <ThemedText variant="body" color={theme.colors.semantic.error.text}>
            {message}
          </ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={signIn}
          disabled={busy}
          style={({ pressed }) => ({
            backgroundColor: button.background,
            minHeight: button.minHeight,
            borderRadius: button.borderRadius,
            paddingHorizontal: button.paddingHorizontal,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: busy ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text
            allowFontScaling={false}
            style={[resolveTextStyle(button.textStyle, fontScale) as TextStyle, { color: button.text }]}
          >
            {busy ? 'Opening secure sign-in…' : 'Sign in'}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
