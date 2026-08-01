import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { nextStepPath, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { ChoiceCard } from '../../src/ui/ChoiceCard';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

export default function WhoStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [role, setRole] = useState<'patient' | 'proxy'>(answers.completedBy.role);
  const [proxyName, setProxyName] = useState(
    answers.completedBy.role === 'proxy' ? answers.completedBy.name : ''
  );
  const [proxyRelationship, setProxyRelationship] = useState(
    answers.completedBy.role === 'proxy' ? answers.completedBy.relationship : ''
  );

  const ready = role === 'patient' || (proxyName.trim() !== '' && proxyRelationship.trim() !== '');

  const next = () => {
    update({
      completedBy:
        role === 'patient'
          ? { role: 'patient' }
          : { role: 'proxy', name: proxyName.trim(), relationship: proxyRelationship.trim() },
    });
    router.push(nextStepPath('/steps/who') as string);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/who"
        title="Who is filling this in?"
        hint="A family member or clinic staff can complete this on the patient's behalf."
      />
      <View style={{ gap: theme.spacing.md }}>
        <ChoiceCard
          title="I am the patient"
          subtitle="I am setting up my own calls"
          selected={role === 'patient'}
          onPress={() => setRole('patient')}
        />
        <ChoiceCard
          title="I am helping someone else"
          subtitle="I am a family member, caregiver, or clinic staff"
          selected={role === 'proxy'}
          onPress={() => setRole('proxy')}
        />
      </View>
      {role === 'proxy' ? (
        <View style={{ gap: theme.spacing.md }}>
          <TextField label="Your name" value={proxyName} onChangeText={setProxyName} autoComplete="name" />
          <TextField
            label="Your relationship to the patient"
            hint="For example: daughter, son, neighbor, clinic nurse"
            value={proxyRelationship}
            onChangeText={setProxyRelationship}
          />
        </View>
      ) : null}
      <PrimaryButton title="Continue" onPress={next} disabled={!ready} />
    </Screen>
  );
}
