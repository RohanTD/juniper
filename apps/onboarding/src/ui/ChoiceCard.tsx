/**
 * A large selectable card — the accessible answer to radio buttons and
 * checkboxes. Selection state is shown with the accent ramp (border + wash),
 * never with semantic color (meaning-only rule).
 */
import { useTheme } from '@juniper/theme';
import { Pressable, View } from 'react-native';
import { ThemedText } from './ThemedText';

export interface ChoiceCardProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

export function ChoiceCard({ title, subtitle, selected, onPress }: ChoiceCardProps) {
  const theme = useTheme();
  const card = theme.recipes.card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected ? theme.colors.accent[50] : card.background,
        borderColor: selected ? theme.colors.accent[500] : theme.colors.border.default,
        borderWidth: 2,
        borderRadius: card.borderRadius,
        padding: card.padding,
        minHeight: theme.touchTarget.minHeight,
        justifyContent: 'center',
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ gap: theme.spacing.xxs }}>
        <ThemedText variant="headline" color={card.title.color}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText variant="bodySm" color={card.subtitle.color}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}
