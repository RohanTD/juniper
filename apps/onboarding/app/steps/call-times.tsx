import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import {
  CALL_WINDOW_CHOICES,
  deviceTimezone,
  nextStepPath,
  toCallWindow,
  useOnboarding,
} from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { ChoiceCard } from '../../src/ui/ChoiceCard';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';

export default function CallTimesStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [selected, setSelected] = useState<Set<string>>(() => {
    const preset = new Set<string>();
    for (const choice of CALL_WINDOW_CHOICES) {
      if (answers.callWindows.some((w) => w.start === choice.start && w.days[0] === choice.days[0])) {
        preset.add(choice.id);
      }
    }
    return preset;
  });

  const toggle = (id: string) => {
    setSelected((previous) => {
      const nextSet = new Set(previous);
      if (nextSet.has(id)) {
        nextSet.delete(id);
      } else {
        nextSet.add(id);
      }
      return nextSet;
    });
  };

  const next = () => {
    const timezone = deviceTimezone();
    update({
      callWindows: CALL_WINDOW_CHOICES.filter((c) => selected.has(c.id)).map((c) =>
        toCallWindow(c, timezone)
      ),
    });
    router.push(nextStepPath('/steps/call-times') as string);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/call-times"
        title="When are calls most welcome?"
        hint="Choose as many as you like. This can always be changed later, just by telling Juniper on a call."
      />
      <View style={{ gap: theme.spacing.md }}>
        {CALL_WINDOW_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.id}
            title={choice.title}
            subtitle={choice.subtitle}
            selected={selected.has(choice.id)}
            onPress={() => toggle(choice.id)}
          />
        ))}
      </View>
      <PrimaryButton title="Continue" onPress={next} disabled={selected.size === 0} />
    </Screen>
  );
}
