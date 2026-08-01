/**
 * The theme's button recipes as one component, so every tap target in the app
 * is the same height, the same radius and the same text style.
 *
 * `allowFontScaling={false}` matches ThemedText: the theme's line heights are
 * multipliers applied against the OS font scale by `resolveTextStyle`, so
 * letting RN scale again would double-apply it.
 */
import { resolveTextStyle, useTheme } from '@juniper/theme';
import { Pressable, Text, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  /** Overrides the label for screen readers when the visible text is terse. */
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const recipe = theme.recipes.button[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: recipe.background,
        borderColor: recipe.borderColor,
        borderWidth: recipe.borderWidth,
        minHeight: recipe.minHeight,
        borderRadius: recipe.borderRadius,
        paddingHorizontal: recipe.paddingHorizontal,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        ...style,
      })}
    >
      <Text
        allowFontScaling={false}
        style={[resolveTextStyle(recipe.textStyle, fontScale) as TextStyle, { color: recipe.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
