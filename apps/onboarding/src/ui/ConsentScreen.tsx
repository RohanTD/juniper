/**
 * One consent, one screen, one decision — the three consents are genuinely
 * separate claims (calling, recording, family sharing) and each is declinable
 * independently. Declining continues the flow; nothing is bundled.
 *
 * Both decisions record the step as answered, so a resumed session does not
 * re-ask a permission that was already refused — being asked twice for
 * permission you already declined reads as pressure.
 */
import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { View } from 'react-native';
import { nextStepPath, useOnboarding, type AnswersDraft, type StepPath } from '../state';
import { PrimaryButton, SecondaryButton } from './Buttons';
import { Screen } from './Screen';
import { StepHeader } from './StepHeader';
import { ThemedText } from './ThemedText';

export interface ConsentScreenProps {
  step: StepPath;
  consentNumber: 1 | 2 | 3;
  title: string;
  paragraphs: string[];
  /** The answer this decision produces; merged and persisted before navigating. */
  onDecision: (granted: boolean) => Partial<AnswersDraft>;
}

export function ConsentScreen({ step, consentNumber, title, paragraphs, onDecision }: ConsentScreenProps) {
  const theme = useTheme();
  const { completeStep } = useOnboarding();
  const nextPath = nextStepPath(step) as string;

  const decide = (granted: boolean) => {
    completeStep(step, onDecision(granted));
    router.push(nextPath);
  };

  return (
    <Screen>
      <StepHeader step={step} title={title} labelSuffix={`— permission ${consentNumber} of 3`} />
      <View style={{ gap: theme.spacing.md }}>
        {paragraphs.map((paragraph) => (
          <ThemedText key={paragraph} variant="bodyLarge" color={theme.colors.text.secondary}>
            {paragraph}
          </ThemedText>
        ))}
      </View>
      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.base }}>
        <PrimaryButton title="Yes, I agree" onPress={() => decide(true)} />
        <SecondaryButton title="No, not now" onPress={() => decide(false)} />
      </View>
    </Screen>
  );
}
