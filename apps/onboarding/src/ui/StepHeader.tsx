/**
 * Question-screen header: mono progress label over an Outfit title.
 * (The serif display voice is reserved for the welcome and done screens —
 * display type is a moment, not a default.)
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { stepPosition, type StepPath } from '../state';
import { ThemedText } from './ThemedText';

export interface StepHeaderProps {
  step: StepPath;
  title: string;
  hint?: string;
}

export function StepHeader({ step, title, hint }: StepHeaderProps) {
  const theme = useTheme();
  const { index, total } = stepPosition(step);
  return (
    <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
      <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
        {`Question ${index} of ${total}`}
      </ThemedText>
      <ThemedText variant="h1">{title}</ThemedText>
      {hint ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}
