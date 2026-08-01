import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { nextStepPath, useOnboarding } from '../../src/state';
import { PrimaryButton, SecondaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

export default function FamilyContactStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [name, setName] = useState(answers.familyContact?.name ?? '');
  const [relationship, setRelationship] = useState(answers.familyContact?.relationship ?? '');
  const [phone, setPhone] = useState(answers.familyContact?.phone ?? '');
  const nextPath = nextStepPath('/steps/family-contact') as string;

  const complete = name.trim() !== '' && relationship.trim() !== '' && phone.trim() !== '';

  return (
    <Screen>
      <StepHeader
        step="/steps/family-contact"
        title="Who is the family or caregiver contact?"
        hint="They join the care team, and — only with permission, coming up next — can follow along with how calls are going."
      />
      <View style={{ gap: theme.spacing.md }}>
        <TextField label="Their name" value={name} onChangeText={setName} autoComplete="name" />
        <TextField
          label="Relationship"
          hint="For example: daughter, son, neighbor"
          value={relationship}
          onChangeText={setRelationship}
        />
        <TextField
          label="Their phone number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
      </View>
      <PrimaryButton
        title="Continue"
        onPress={() => {
          update({
            familyContact: { name: name.trim(), relationship: relationship.trim(), phone: phone.trim() },
          });
          router.push(nextPath);
        }}
        disabled={!complete}
      />
      <SecondaryButton
        title="Skip — no family contact"
        onPress={() => {
          update({ familyContact: undefined });
          router.push(nextPath);
        }}
      />
    </Screen>
  );
}
