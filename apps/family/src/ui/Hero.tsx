/**
 * The serif-display-plus-mono-eyebrow signature. Used on exactly ONE screen —
 * the "how is Mom doing" summary — per the theme's rule. Do not reuse.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { ThemedText } from './ThemedText';

export function Hero({ eyebrow, title }: { eyebrow: string; title: string }) {
  const theme = useTheme();
  const recipe = theme.recipes.hero;
  return (
    <View style={{ gap: recipe.gap, marginVertical: theme.spacing.lg }}>
      <ThemedText variant="eyebrow" color={recipe.eyebrow.color}>
        {eyebrow}
      </ThemedText>
      <ThemedText variant="displayLg" color={recipe.display.color}>
        {title}
      </ThemedText>
    </View>
  );
}
