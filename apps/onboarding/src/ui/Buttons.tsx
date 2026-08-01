/**
 * The two button recipes from the theme. In the accessible variant the primary
 * fill is the AA-audited step — never restyle these in a screen.
 */
import { resolveTextStyle, useTheme } from '@juniper/theme';
import { Pressable, Text, useWindowDimensions, type TextStyle } from 'react-native';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}

export function PrimaryButton({ title, onPress, disabled }: ButtonProps) {
  const theme = useTheme();
  const recipe = theme.recipes.button.primary;
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: recipe.background,
        minHeight: recipe.minHeight,
        borderRadius: recipe.borderRadius,
        paddingHorizontal: recipe.paddingHorizontal,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        allowFontScaling={false}
        style={[resolveTextStyle(recipe.textStyle, fontScale) as TextStyle, { color: recipe.text }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled }: ButtonProps) {
  const theme = useTheme();
  const recipe = theme.recipes.button.secondary;
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
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
      })}
    >
      <Text
        allowFontScaling={false}
        style={[resolveTextStyle(recipe.textStyle, fontScale) as TextStyle, { color: recipe.text }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
