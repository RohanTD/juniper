/**
 * Labeled text input. Label uses the mono section-label recipe; the input
 * itself is body text at the accessible floor with a large touch target.
 */
import { resolveTextStyle, useTheme } from '@juniper/theme';
import { TextInput, useWindowDimensions, View, type TextInputProps, type TextStyle } from 'react-native';
import { ThemedText } from './ThemedText';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
}

export function TextField({ label, hint, style, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const bodyStyle = resolveTextStyle(theme.textStyles.body, fontScale) as TextStyle;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
        {label}
      </ThemedText>
      <TextInput
        allowFontScaling={false}
        placeholderTextColor={theme.colors.text.secondary}
        {...rest}
        style={[
          bodyStyle,
          {
            color: theme.colors.text.primary,
            backgroundColor: theme.colors.background.primary,
            borderColor: theme.colors.border.strong,
            borderWidth: 1,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            minHeight: theme.touchTarget.minHeight,
          },
          style,
        ]}
      />
      {hint ? (
        <ThemedText variant="caption" color={theme.colors.text.secondary}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}
