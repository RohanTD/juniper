/**
 * The theme's "cards over tables" pattern: icon-in-circle, title, subtitle,
 * chevron. Semantic tint is allowed only for meaning (success = completed
 * check-in, error = alert) — never decoration.
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import { Pressable, View } from 'react-native';
import { ThemedText } from './ThemedText';

export interface CardProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** Overrides for the icon circle when the card carries meaning. */
  iconColor?: string;
  iconBackground?: string;
  children?: React.ReactNode;
}

export function Card({ icon, title, subtitle, onPress, iconColor, iconBackground, children }: CardProps) {
  const theme = useTheme();
  const recipe = theme.recipes.card;
  const circleSize = recipe.iconCircle.size;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      // Explicit rather than derived from children: the icon and chevron are
      // decorative here, and a label assembled from every descendant reads the
      // title and subtitle as one run-on sentence on some screen readers.
      accessibilityLabel={onPress ? [title, subtitle].filter(Boolean).join('. ') : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        backgroundColor: recipe.background,
        borderRadius: recipe.borderRadius,
        padding: recipe.padding,
        flexDirection: 'row',
        alignItems: 'center',
        gap: recipe.gap,
        minHeight: theme.recipes.listRow.minHeight,
        opacity: pressed ? 0.92 : 1,
        ...recipe.shadow,
      })}
    >
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: theme.borderRadius.full,
          backgroundColor: iconBackground ?? recipe.iconCircle.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather
          name={icon}
          size={Math.round(circleSize / 2)}
          color={iconColor ?? recipe.iconCircle.color}
        />
      </View>
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <ThemedText variant="h3" color={recipe.title.color}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText variant="bodySmall" color={recipe.subtitle.color}>
            {subtitle}
          </ThemedText>
        ) : null}
        {children}
      </View>
      {onPress ? (
        <Feather name="chevron-right" size={recipe.chevron.size} color={recipe.chevron.color} />
      ) : null}
    </Pressable>
  );
}
