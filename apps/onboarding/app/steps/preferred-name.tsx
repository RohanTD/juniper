import { router } from 'expo-router';
import { useState } from 'react';
import { nextStepPath, subjectWord, useOnboarding } from '../../src/state';
import { PrimaryButton, SecondaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

export default function PreferredNameStep() {
  const { answers, update } = useOnboarding();
  const [name, setName] = useState(answers.preferredName ?? '');
  const you = subjectWord(answers);
  const nextPath = nextStepPath('/steps/preferred-name') as string;

  return (
    <Screen>
      <StepHeader
        step="/steps/preferred-name"
        title={`What should Juniper call ${you === 'their' ? 'them' : 'you'}?`}
        hint="A first name or nickname makes the call feel like a friend, not a form."
      />
      <TextField label="Preferred name" value={name} onChangeText={setName} placeholder="For example: Peggy" />
      <PrimaryButton
        title="Continue"
        onPress={() => {
          update({ preferredName: name.trim() || undefined });
          router.push(nextPath);
        }}
        disabled={name.trim() === ''}
      />
      <SecondaryButton
        title="Skip — use the legal name"
        onPress={() => {
          update({ preferredName: undefined });
          router.push(nextPath);
        }}
      />
    </Screen>
  );
}
