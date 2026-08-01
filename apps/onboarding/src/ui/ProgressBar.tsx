/**
 * How much is left.
 *
 * Thirteen screens with nothing but "Question 5 of 13" asks the reader to do
 * arithmetic to answer "am I nearly done?" — and an unanswerable "how long is
 * this?" is its own abandonment risk, separate from losing answers. A filled
 * bar answers it at a glance, without adding a single word to the screen.
 *
 * Deliberately not a percentage and not a step-by-step dot row: a number to
 * read is worse than a length to see, and thirteen dots would be both cluttered
 * and, at 13 across a phone, too small to mean anything.
 *
 * The track is `rule` — the system's only hairline colour — and the fill is the
 * brand step the accessible variant already audits for the primary button, so
 * it clears WCAG non-text contrast comfortably. Height comes from `spacing.sm`
 * so it stays visible to a seventy-year-old on a phone at arm's length.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';

export interface ProgressBarProps {
  /** 0..1 */
  fraction: number;
  /** Spoken instead of the bar itself, e.g. "Question 5 of 13". */
  accessibilityLabel: string;
}

export function ProgressBar({ fraction, accessibilityLabel }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, fraction));
  const height = theme.spacing.sm;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{
        height,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.rule,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: theme.borderRadius.full,
          backgroundColor: theme.recipes.button.primary.background,
        }}
      />
    </View>
  );
}
