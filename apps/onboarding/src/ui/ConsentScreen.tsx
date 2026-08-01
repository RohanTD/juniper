/**
 * One consent, one screen, one decision — the three consents are genuinely
 * separate claims (calling, recording, family sharing) and each is declinable
 * independently. Declining continues the flow; nothing is bundled.
 */
import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { View } from 'react-native';
import { nextStepPath, stepPosition, type StepPath } from '../state';
import { PrimaryButton, SecondaryButton } from './Buttons';
import { Screen } from './Screen';
import { ThemedText } from './ThemedText';

export interface ConsentScreenProps {
  step: StepPath;
  consentNumber: 1 | 2 | 3;
  title: string;
  paragraphs: string[];
  onDecision: (granted: boolean) => void;
}

export function ConsentScreen({ step, consentNumber, title, paragraphs, onDecision }: ConsentScreenProps) {
  const theme = useTheme();
  const { index, total } = stepPosition(step);
  const nextPath = nextStepPath(step) as string;

  const decide = (granted: boolean) => {
    onDecision(granted);
    router.push(nextPath);
  };

  return (
    <Screen>
      <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
          {`Question ${index} of ${total} — permission ${consentNumber} of 3`}
        </ThemedText>
        <ThemedText variant="h1">{title}</ThemedText>
      </View>
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
