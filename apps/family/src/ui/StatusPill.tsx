/**
 * The status badge next to the dashboard question. Semantic ramps carry meaning
 * only (THEME_SYSTEM.md §2): error = something is open, success = nothing is,
 * neutral = we do not know. The third state is the important one — "we have no
 * recent calls" must never render green, because a caregiver reading green
 * would take it as reassurance the app has not earned.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import type { StatusTone } from '../data/status';
import { ThemedText } from './ThemedText';

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const theme = useTheme();
  const semantic =
    tone === 'attention'
      ? theme.colors.semantic.error
      : tone === 'good'
        ? theme.colors.semantic.success
        : undefined;

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: semantic?.bg ?? theme.colors.background.tertiary,
        borderRadius: theme.borderRadius.full,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.base,
      }}
    >
      <View
        style={{
          width: theme.spacing.sm,
          height: theme.spacing.sm,
          borderRadius: theme.borderRadius.full,
          backgroundColor: semantic?.icon ?? theme.colors.text.secondary,
        }}
      />
      <ThemedText variant="label" color={semantic?.fgOnBg ?? theme.colors.text.secondary}>
        {label}
      </ThemedText>
    </View>
  );
}
