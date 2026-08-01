/**
 * All text goes through a theme text-style recipe, resolved against the OS
 * font scale (line heights are multipliers in the theme; we apply the scale
 * ourselves and disable RN's own scaling to avoid double-application).
 */
import { resolveTextStyle, useTheme, type TextStyleName } from '@juniper/theme';
import { Text, useWindowDimensions, type TextProps, type TextStyle } from 'react-native';

export interface ThemedTextProps extends TextProps {
  variant?: TextStyleName;
  color?: string;
}

export function ThemedText({ variant = 'body', color, style, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const resolved = resolveTextStyle(theme.textStyles[variant], fontScale) as TextStyle;
  return (
    <Text
      {...rest}
      allowFontScaling={false}
      style={[resolved, { color: color ?? theme.colors.text.primary }, style]}
    />
  );
}
