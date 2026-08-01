import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { nextStepPath, subjectWord, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';

function toIsoDate(month: string, day: string, year: string): string | undefined {
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) {
    return undefined;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DobStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [year, month, day] = (answers.dob ?? '--').split('-');
  const [monthText, setMonthText] = useState(month ?? '');
  const [dayText, setDayText] = useState(day ?? '');
  const [yearText, setYearText] = useState(year ?? '');
  const you = subjectWord(answers);

  const iso = toIsoDate(monthText, dayText, yearText);

  const next = () => {
    if (iso) {
      update({ dob: iso });
      router.push(nextStepPath('/steps/dob') as string);
    }
  };

  return (
    <Screen>
      <StepHeader step="/steps/dob" title={`What is ${you} date of birth?`} />
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Month"
            hint="1 to 12"
            value={monthText}
            onChangeText={setMonthText}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label="Day"
            value={dayText}
            onChangeText={setDayText}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 2 }}>
          <TextField
            label="Year"
            hint="For example 1948"
            value={yearText}
            onChangeText={setYearText}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      </View>
      <PrimaryButton title="Continue" onPress={next} disabled={!iso} />
    </Screen>
  );
}
