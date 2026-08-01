import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { View } from 'react-native';
import { LANGUAGES, nextStepPath, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { ChoiceCard } from '../../src/ui/ChoiceCard';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';

export default function LanguageStep() {
  const theme = useTheme();
  // The selection lives in the draft rather than in local state, so it is
  // persisted the moment it is tapped.
  const { answers, update, completeStep } = useOnboarding();
  const choice = answers.language;

  const next = () => {
    if (choice) {
      completeStep('/steps/language');
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
            onPress={() => update({ language })}
          />
        ))}
      </View>
      <PrimaryButton title="Continue" onPress={next} disabled={!choice} />
    </Screen>
  );
}
