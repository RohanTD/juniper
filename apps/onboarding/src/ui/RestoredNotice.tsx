/**
 * "We saved your answers."
 *
 * Shown once, on whichever screen the app lands on after a draft is restored —
 * usually the welcome screen (the link reopened), but also mid-flow when a
 * browser tab is refreshed on, say, `/steps/topics` and expo-router restores
 * that route directly. Without it, someone in their eighties looking at a
 * half-finished form has no way to know their earlier answers still exist.
 *
 * It acknowledges itself on mount: it is a reassurance about what just
 * happened, not a standing banner competing with the question.
 */
import { useTheme } from '@juniper/theme';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useOnboarding } from '../state';
import { ThemedText } from './ThemedText';

export function RestoredNotice() {
  const theme = useTheme();
  const { restored, acknowledgeRestore } = useOnboarding();
  // Latched at mount: acknowledging immediately is what stops the notice
  // following the reader from screen to screen, but reading the live flag to
  // decide visibility would make it vanish a frame after it appeared.
  const [show] = useState(restored);

  useEffect(() => {
    if (restored) {
      acknowledgeRestore();
    }
    // Mount only — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) {
    return null;
  }

  const tone = theme.colors.semantic.success;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: tone.bg,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.base,
        gap: theme.spacing.xs,
      }}
    >
      <ThemedText variant="bodyLarge" color={tone.fgOnBg}>
        We saved your answers.
      </ThemedText>
      <ThemedText variant="body" color={tone.fgOnBg}>
        Pick up where you left off — nothing you told us was lost.
      </ThemedText>
    </View>
  );
}
