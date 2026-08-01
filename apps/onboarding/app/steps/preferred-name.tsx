import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { nextStepPath, subjectWord, useOnboarding } from '../../src/state';
import { PrimaryButton, SecondaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

export default function PreferredNameStep() {
  const { answers, update, completeStep } = useOnboarding();
  const [name, setName] = useState(answers.preferredName ?? '');
  const you = subjectWord(answers);
  const nextPath = nextStepPath('/steps/preferred-name') as string;

  useEffect(() => {
    update({ preferredName: name.trim() || undefined });
  }, [name, update]);

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
          completeStep('/steps/preferred-name');
          router.push(nextPath);
        }}
        disabled={name.trim() === ''}
      />
      <SecondaryButton
        title="Skip — use the legal name"
        onPress={() => {
          // A deliberate skip is an answer: resume must not ask again.
          completeStep('/steps/preferred-name', { preferredName: undefined });
          setName('');
          router.push(nextPath);
        }}
      />
    </Screen>
  );
}
