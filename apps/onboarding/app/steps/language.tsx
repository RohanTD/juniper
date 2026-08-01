import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LANGUAGES, nextStepPath, useOnboarding } from '../../src/state';
import type { LanguageChoice } from '../../src/submit';
import { PrimaryButton } from '../../src/ui/Buttons';
import { ChoiceCard } from '../../src/ui/ChoiceCard';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';

export default function LanguageStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [choice, setChoice] = useState<LanguageChoice | undefined>(answers.language);

  const next = () => {
    if (choice) {
      update({ language: choice });
      router.push(nextStepPath('/steps/language') as string);
    }
  };

  return (
    <Screen>
      <StepHeader step="/steps/language" title="Which language for the calls?" />
      <View style={{ gap: theme.spacing.md }}>
        {LANGUAGES.map((language) => (
          <ChoiceCard
            key={language.code}
            title={language.label}
            selected={choice?.code === language.code}
            onPress={() => setChoice(language)}
          />
        ))}
      </View>
      <PrimaryButton title="Continue" onPress={next} disabled={!choice} />
    </Screen>
  );
}
