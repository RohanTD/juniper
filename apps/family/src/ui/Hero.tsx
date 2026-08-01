/**
 * The theme's signature pairing: a tracked uppercase mono eyebrow above an
 * Instrument Serif display line (THEME_SYSTEM.md §3, "the serif/mono contrast").
 *
 * The spec reserves it for "big moment" screens, and this app has exactly two:
 * the landing screen, which is the first thing anyone sees and where the
 * Juniper identity has to land, and the dashboard's "how is <name> doing?" —
 * the one question the product exists to answer. Nothing else in the app may
 * use it; a signature used everywhere signifies nothing.
 *
 * `size` exists because the two moments are different sizes of moment: the
 * landing screen carries the 64pt `displayLarge` on a wide viewport, the
 * dashboard the 48pt `display`.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ThemedText } from './ThemedText';

export interface HeroProps {
  eyebrow: string;
  title: string;
  size?: 'display' | 'displayLarge';
  /** Status row, lede paragraph, call to action — whatever the moment needs. */
  children?: ReactNode;
}

export function Hero({ eyebrow, title, size = 'display', children }: HeroProps) {
  const theme = useTheme();
  const recipe = theme.recipes.hero;
  return (
    <View style={{ gap: recipe.gap, marginVertical: theme.spacing.base }}>
      <ThemedText variant="label" color={recipe.eyebrow.color}>
        {eyebrow}
      </ThemedText>
      <ThemedText variant={size} color={recipe.display.color}>
        {title}
      </ThemedText>
      {children ? <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.sm }}>{children}</View> : null}
    </View>
  );
}
