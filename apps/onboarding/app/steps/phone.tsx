import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { nextStepPath, subjectWord, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

function isPlausiblePhone(value: string): boolean {
  return value.replace(/\D/g, '').length >= 10;
}

export default function PhoneStep() {
  const { answers, update, completeStep } = useOnboarding();
  const [phone, setPhone] = useState(answers.phone ?? '');
  const you = subjectWord(answers);

  useEffect(() => {
    update({ phone: phone.trim() });
  }, [phone, update]);

  const next = () => {
    completeStep('/steps/phone');
    router.push(nextStepPath('/steps/phone') as string);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/phone"
        title={`What number should Juniper call?`}
        hint={`The phone ${you === 'their' ? 'the patient' : 'you'} will actually answer — a home line or cell phone both work.`}
      />
      <TextField
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="(555) 123-4567"
      />
      <PrimaryButton title="Continue" onPress={next} disabled={!isPlausiblePhone(phone)} />
    </Screen>
  );
}
