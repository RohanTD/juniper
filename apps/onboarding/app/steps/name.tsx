import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { nextStepPath, subjectWord, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

export default function NameStep() {
  const theme = useTheme();
  const { answers, update, completeStep } = useOnboarding();
  const [given, setGiven] = useState(answers.legalName?.given ?? '');
  const [family, setFamily] = useState(answers.legalName?.family ?? '');
  const you = subjectWord(answers);

  // Written to the draft as it is typed, not on Continue: an interrupted
  // answer should cost a word, never the screen.
  useEffect(() => {
    update({ legalName: { given: given.trim(), family: family.trim() } });
  }, [given, family, update]);

  const next = () => {
    completeStep('/steps/name');
    router.push(nextStepPath('/steps/name') as string);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/name"
        title={`What is ${you} legal name?`}
        hint="As it appears on insurance or identification."
      />
      <View style={{ gap: theme.spacing.md }}>
        <TextField label="First name" value={given} onChangeText={setGiven} autoComplete="given-name" />
        <TextField label="Last name" value={family} onChangeText={setFamily} autoComplete="family-name" />
      </View>
      <PrimaryButton
        title="Continue"
        onPress={next}
        disabled={given.trim() === '' || family.trim() === ''}
      />
    </Screen>
  );
}
