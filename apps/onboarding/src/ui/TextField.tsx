/**
 * Labeled text input. Label uses the mono section-label recipe; the field is
 * the theme's `components.input.base` recipe with the resolved body style laid
 * over it, so the accessible type floor and OS font scaling both apply, plus a
 * large touch target.
 */
import { resolveTextStyle, useTheme } from '@juniper/theme';
import { TextInput, useWindowDimensions, View, type TextInputProps, type TextStyle } from 'react-native';
import { ThemedText } from './ThemedText';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  /** Forwarded to the inner TextInput, so a screen can move focus for the user. */
  ref?: React.Ref<TextInput>;
}

export function TextField({ label, hint, style, ref, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const bodyStyle = resolveTextStyle(theme.textStyles.body, fontScale) as TextStyle;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
        {label}
      </ThemedText>
      <TextInput
        ref={ref}
        allowFontScaling={false}
        placeholderTextColor={theme.colors.text.secondary}
        {...rest}
        style={[
          theme.components.input.base,
          bodyStyle,
          {
            color: theme.colors.text.primary,
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
