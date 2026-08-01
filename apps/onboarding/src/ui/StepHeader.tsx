/**
 * Question-screen header: a progress bar, a mono progress label, and an Outfit
 * title. (The serif display voice is reserved for the welcome and done screens
 * — display type is a moment, not a default.)
 *
 * The bar is the only progress affordance in the flow; every question screen
 * and the review screen render this header, so "how much is left" is answered
 * everywhere without any screen having to say it.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { stepFraction, stepPosition, type StepPath } from '../state';
import { ProgressBar } from './ProgressBar';
import { RestoredNotice } from './RestoredNotice';
import { ThemedText } from './ThemedText';

export interface StepHeaderProps {
  step: StepPath;
  title: string;
  hint?: string;
  /** Appended to the progress label, e.g. "— permission 1 of 3". */
  labelSuffix?: string;
}

export function StepHeader({ step, title, hint, labelSuffix }: StepHeaderProps) {
  const theme = useTheme();
  const { index, total } = stepPosition(step);
  const position = `Question ${index} of ${total}`;
  return (
    <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
      <RestoredNotice />
      <ProgressBar fraction={stepFraction(step)} accessibilityLabel={position} />
      <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
        {labelSuffix ? `${position} ${labelSuffix}` : position}
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
