/**
 * "What's coming up" — the next scheduled call window.
 *
 * The card leads with the day and the range, and carries the caveat as part of
 * the card rather than as fine print, because the caveat is the honest half of
 * the claim: Juniper calls somewhere inside the window and never at a
 * promised minute. A caregiver who arranges their morning around "9:00 AM" the
 * app implied has been misled by the app.
 *
 * When no windows are set the card says so and points at the settings screen —
 * an empty card here would read as "no more calls are planned", which is a
 * different and much more alarming statement than "nobody has set times yet".
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import { Pressable, View } from 'react-native';
import type { NextCallCopy } from '../data/schedule';
import { ThemedText } from './ThemedText';

export interface NextCallCardProps {
  copy: NextCallCopy | undefined;
  /** True while preferences are still loading — avoids flashing "not set". */
  loading?: boolean;
  /** Plain-language reason the schedule could not be read, if any. */
  errorMessage?: string;
  onPressSettings: () => void;
}

export function NextCallCard({
  copy,
  loading,
  errorMessage,
  onPressSettings,
}: NextCallCardProps) {
  const theme = useTheme();
  const card = theme.recipes.card;
  const circleSize = card.iconCircle.size;

  const body = (): React.ReactNode => {
    if (loading) {
      return (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Checking the call schedule…
        </ThemedText>
      );
    }
    if (errorMessage) {
      return (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          We couldn’t read the call schedule — {errorMessage}.
        </ThemedText>
      );
    }
    if (!copy) {
      return (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          No call times have been set yet, so Juniper is using its default schedule. You can set
          better times in call settings.
        </ThemedText>
      );
    }
    return (
      <>
        <ThemedText variant="h2">{copy.day}</ThemedText>
        <ThemedText variant="bodyLarge" color={theme.colors.text.secondary}>
          {copy.range}
        </ThemedText>
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {copy.caveat}
        </ThemedText>
      </>
    );
  };

  return (
    <View
      style={{
        backgroundColor: card.background,
        borderRadius: card.borderRadius,
        padding: theme.spacing.xl,
        gap: theme.spacing.sm,
        ...card.shadow,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: card.gap }}>
        <View
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: theme.borderRadius.full,
            backgroundColor: card.iconCircle.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather
            name="calendar"
            size={Math.round(circleSize / 2)}
            color={card.iconCircle.color}
          />
        </View>
        <ThemedText variant="label" color={theme.colors.text.secondary}>
          Next call
        </ThemedText>
      </View>

      {body()}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open call settings"
        onPress={onPressSettings}
        style={{
          minHeight: theme.touchTarget.minHeight,
          justifyContent: 'center',
          marginTop: theme.spacing.xs,
        }}
      >
        <ThemedText variant="button" color={theme.colors.text.accent}>
          Change call times
        </ThemedText>
      </Pressable>
    </View>
  );
}
