/**
 * An at-a-glance tile: mono label, one number or short phrase, one caption.
 *
 * This is the theme's serif/mono contrast doing quiet work — the uppercase mono
 * label above a large value is the same pairing as the hero, at metadata scale.
 *
 * It is emphatically NOT a chart, and the distinction is the reason the shape
 * is this constrained: PLAN.md rules out trends because writes are limited to
 * notes and there is no structured data behind a line. A count of calls and the
 * date of the last one are facts the app genuinely holds; a sparkline through
 * them would imply a trajectory nobody measured.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { useIsWide } from './Screen';
import { ThemedText } from './ThemedText';

export interface StatTileProps {
  label: string;
  value: string;
  caption?: string;
  /** Semantic colour for the value — meaning only (an open alert count). */
  valueColor?: string;
}

export function StatTile({ label, value, caption, valueColor }: StatTileProps) {
  const theme = useTheme();
  const isWide = useIsWide();
  const card = theme.recipes.card;

  return (
    <View
      style={{
        // Wide: four equal tiles in one row. Narrow: two up, wrapping.
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: isWide ? 0 : '45%',
        minWidth: isWide ? 0 : 140,
        backgroundColor: card.background,
        borderRadius: card.borderRadius,
        padding: card.padding,
        gap: theme.spacing.xs,
        ...card.shadow,
      }}
    >
      <ThemedText variant="label" color={theme.colors.text.secondary}>
        {label}
      </ThemedText>
      <ThemedText variant="h2" color={valueColor}>
        {value}
      </ThemedText>
      {caption ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {caption}
        </ThemedText>
      ) : null}
    </View>
  );
}
