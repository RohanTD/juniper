/**
 * The landing screen — the first thing anyone sees, and for most caregivers the
 * only thing they will see before deciding whether this is a real product.
 *
 * It carries the theme's signature (tracked mono eyebrow over an Instrument
 * Serif display line) because this is one of the two moments that earn it: the
 * introduction, and the dashboard's "how is <name> doing?". Everything else in
 * the app runs on Outfit.
 *
 * Three things and no more: who this is for, what it does, and the way in.
 * A caregiver arriving here is usually worried, often at night, and frequently
 * on a phone — a marketing page would be an obstacle, and a bare button would
 * be an unanswered question ("is this the right app? what will I see?").
 *
 * On a wide viewport the copy and the sign-in sit left with a plain-language
 * "what you'll see" panel on the right, which is the same Columns split the
 * dashboard uses. On a phone it stacks, action first-class rather than below
 * a scroll.
 */
import { signInWithMedplum } from '@juniper/medplum-rn';
import { useTheme } from '@juniper/theme';
import { useMedplum } from '@medplum/react-hooks';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { APP_SCHEME, ENV } from '../src/env';
import { Button } from '../src/ui/Button';
import { Hero } from '../src/ui/Hero';
import { Columns } from '../src/ui/Layout';
import { Screen, useIsWide } from '../src/ui/Screen';
import { ThemedText } from '../src/ui/ThemedText';

const WHAT_YOU_SEE: { icon: keyof typeof Feather.glyphMap; title: string; body: string }[] = [
  {
    icon: 'phone-call',
    title: 'Every check-in call',
    body: 'When Juniper called, how long it lasted, and a short summary written in plain language — not clinical shorthand.',
  },
  {
    icon: 'calendar',
    title: 'When the next call is due',
    body: 'The scheduled window for the next call, so you know what to expect rather than wondering.',
  },
  {
    icon: 'alert-circle',
    title: 'Anything urgent, with context',
    body: 'If a call raises a concern, you see what was said, when, and what has already been done about it.',
  },
];

export default function SignIn() {
  const theme = useTheme();
  const medplum = useMedplum();
  const isWide = useIsWide();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

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

  const intro = (
    <View style={{ gap: theme.spacing.base }}>
      <Hero
        eyebrow="Juniper Family"
        title="Know how they’re doing, between the visits."
        size={isWide ? 'displayLarge' : 'display'}
      >
        <ThemedText variant="bodyLarge" color={theme.colors.text.secondary}>
          Juniper calls your parent regularly for a warm, unhurried check-in. This is where you
          follow along — what was talked about, what’s coming up, and anything that needs you.
        </ThemedText>
      </Hero>

      {message ? (
        <ThemedText variant="body" color={theme.colors.semantic.error.text}>
          {message}
        </ThemedText>
      ) : null}

      <Button
        label={busy ? 'Opening secure sign-in…' : 'Sign in'}
        accessibilityLabel="Sign in to Juniper Family"
        onPress={signIn}
        disabled={busy}
        style={isWide ? { alignSelf: 'flex-start', paddingHorizontal: theme.spacing['2xl'] } : undefined}
      />

      <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
        Access is managed by the care team — if you were added as a caregiver, your sign-in just
        works. There is no password to create: Juniper hands you to your care provider’s secure
        sign-in.
      </ThemedText>
    </View>
  );

  const panel = (
    <View
      style={{
        backgroundColor: theme.colors.background.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.xl,
        gap: theme.spacing.lg,
        ...theme.recipes.card.shadow,
      }}
    >
      <ThemedText variant="label" color={theme.colors.text.secondary}>
        What you’ll see
      </ThemedText>
      {WHAT_YOU_SEE.map((item) => (
        <View
          key={item.title}
          style={{ flexDirection: 'row', gap: theme.recipes.card.gap, alignItems: 'flex-start' }}
        >
          <View
            style={{
              width: theme.recipes.card.iconCircle.size,
              height: theme.recipes.card.iconCircle.size,
              borderRadius: theme.borderRadius.full,
              backgroundColor: theme.recipes.card.iconCircle.background,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather
              name={item.icon}
              size={Math.round(theme.recipes.card.iconCircle.size / 2)}
              color={theme.recipes.card.iconCircle.color}
            />
          </View>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <ThemedText variant="h4">{item.title}</ThemedText>
            <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
              {item.body}
            </ThemedText>
          </View>
        </View>
      ))}

      {/* Said up front, because a caregiver's first question about an app that
          listens to their parent's phone calls is what it lets them read. The
          answer is a product decision, not a limitation to bury. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.colors.rule,
          paddingTop: theme.spacing.base,
        }}
      >
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          You’ll read a summary written for family — never the clinical note, and never a recording
          or transcript of the conversation. Those stay between your parent and their care team.
        </ThemedText>
      </View>
    </View>
  );

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Columns main={intro} side={panel} />
      </View>
    </Screen>
  );
}
