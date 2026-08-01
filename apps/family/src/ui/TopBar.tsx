/**
 * Persistent navigation for the signed-in app.
 *
 * A dashboard is partly a layout and partly a promise that every screen is one
 * click from every other; without that, the wide layout is just a tall phone
 * screen. On a narrow viewport the links wrap under the wordmark rather than
 * collapsing into a menu — there are four of them, and a hamburger hiding four
 * links is ceremony, not navigation.
 *
 * The wordmark is mono, not the serif display: the serif signature is reserved
 * for the two hero moments (see Hero.tsx) and a wordmark repeated on every
 * screen is exactly the repetition that would spend it.
 */
import { useTheme } from '@juniper/theme';
import { signOut } from '@juniper/medplum-rn';
import { useMedplum } from '@medplum/react-hooks';
import { router, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';
import { clearSelectedPatient } from '../data/patient';
import { useIsWide } from './Screen';
import { ThemedText } from './ThemedText';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/checkins', label: 'Check-ins' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/preferences', label: 'Call settings' },
  { href: '/account', label: 'Your account' },
] as const;

export function TopBar() {
  const theme = useTheme();
  const medplum = useMedplum();
  const isWide = useIsWide();
  const pathname = usePathname();

  const handleSignOut = async () => {
    await signOut(medplum);
    // A staff pick is a view preference stored in this browser, not part of the
    // session — so signing out has to drop it explicitly, or the next person to
    // use this machine lands on the previous user's patient.
    clearSelectedPatient();
    router.replace('/sign-in');
  };

  return (
    <View
      style={{
        flexDirection: isWide ? 'row' : 'column',
        alignItems: isWide ? 'center' : 'flex-start',
        justifyContent: 'space-between',
        gap: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.rule,
      }}
    >
      {/* A mark, not a label.
       *
       * This was `variant="label"` — the tracked uppercase mono — which is
       * exactly the recipe the hero eyebrow uses one line below it on the
       * overview page. Two identical treatments forty pixels apart read as one
       * repeated element rather than as chrome and content, and the eye has no
       * way to tell which is the app and which is the page.
       *
       * A glyph badge plus a sans wordmark is a third typographic register,
       * distinct from both the mono eyebrow and the serif display — and it
       * keeps the rule this file already states: the serif signature stays
       * reserved for the two hero moments and is not spent on a wordmark
       * repeated on every screen. */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Juniper Family, go to overview"
        onPress={() => router.push('/')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: theme.touchTarget.minHeight,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: theme.colors.primary[500],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ThemedText variant="button" color={theme.colors.text.inverse}>
            J
          </ThemedText>
        </View>
        <ThemedText variant="h4">Juniper Family</ThemedText>
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: isWide ? theme.spacing.lg : theme.spacing.base,
        }}
      >
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Pressable
              key={link.href}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              accessibilityState={{ selected: active }}
              onPress={() => router.push(link.href)}
              style={{ minHeight: theme.touchTarget.minHeight, justifyContent: 'center' }}
            >
              <ThemedText
                variant="button"
                color={active ? theme.colors.text.primary : theme.colors.text.secondary}
              >
                {link.label}
              </ThemedText>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={handleSignOut}
          style={{ minHeight: theme.touchTarget.minHeight, justifyContent: 'center' }}
        >
          <ThemedText variant="button" color={theme.colors.text.secondary}>
            Sign out
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
