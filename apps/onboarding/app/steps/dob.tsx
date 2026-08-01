/**
 * Date of birth — the screen most likely to strand an eighty-year-old.
 *
 * The first version was three number boxes labelled Month / Day / Year, with
 * "1 to 12" under the first. Four things were wrong with it, and all four are
 * worse for the intended user than for the person who wrote it:
 *
 *  1. **A month is a word, not a number.** "March" → "3" is a conversion, and
 *     it is the kind of small cognitive tax that makes a form feel hostile.
 *     Months are now named buttons; nobody has to translate anything.
 *  2. **Nothing explained a rejection.** "31 February" simply left Continue
 *     greyed out, with no message. A disabled button with no reason is
 *     indistinguishable from an app that has frozen.
 *  3. **No confirmation.** The three boxes never showed what they added up to,
 *     so a slip of one digit in the year was invisible until the review screen.
 *     The date is now echoed back in words.
 *  4. **Tapping between tiny boxes.** Day advances to Year on its own once
 *     two digits are in.
 */
import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { nextStepPath, voiceFor, useOnboarding } from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';
import { ThemedText } from '../../src/ui/ThemedText';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const EARLIEST_YEAR = 1900;

/** Digits only — a stray space or dash from a keyboard should not invalidate. */
function digits(text: string, max: number): string {
  return text.replace(/\D+/g, '').slice(0, max);
}

export function toIsoDate(month: string, day: string, year: string): string | undefined {
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < EARLIEST_YEAR || y > new Date().getFullYear()) {
    return undefined;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * What is wrong, in words, or undefined when nothing is.
 *
 * Returns nothing while the answer is merely *incomplete* — telling someone
 * their date is invalid while they are still typing it is nagging, not help.
 */
export function describeDobProblem(month: string, day: string, year: string): string | undefined {
  if (!month || !day || !year) {
    return undefined;
  }
  if (year.length < 4) {
    return undefined;
  }
  const d = Number(day);
  const y = Number(year);
  const thisYear = new Date().getFullYear();
  if (d < 1 || d > 31) {
    return 'That day doesn’t look right — please check it.';
  }
  if (y < EARLIEST_YEAR || y > thisYear) {
    return `Please enter a year between ${EARLIEST_YEAR} and ${thisYear}.`;
  }
  if (!toIsoDate(month, day, year)) {
    return `${MONTHS[Number(month) - 1]} ${y} doesn’t have a day ${d}.`;
  }
  return undefined;
}

/** "12 March 1946" — read back so a mistyped year is caught here, not at review. */
export function spellOutDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-');
  const name = MONTHS[Number(m) - 1];
  return name ? `${Number(d)} ${name} ${Number(y)}` : undefined;
}

export default function DobStep() {
  const theme = useTheme();
  const { answers, update, completeStep } = useOnboarding();
  const [year, month, day] = (answers.dob ?? '--').split('-');
  const [monthText, setMonthText] = useState(answers.dobEntry?.month ?? month ?? '');
  const [dayText, setDayText] = useState(answers.dobEntry?.day ?? day ?? '');
  const [yearText, setYearText] = useState(answers.dobEntry?.year ?? year ?? '');
  const v = voiceFor(answers);
  const yearRef = useRef<TextInput>(null);

  const iso = toIsoDate(monthText, dayText, yearText);
  const problem = describeDobProblem(monthText, dayText, yearText);
  const spelled = spellOutDate(iso);

  // `dob` only exists once the three fields parse into a real date, so they are
  // persisted as typed alongside it. Otherwise "1948" entered in the year and
  // nothing else would vanish on a reload, and re-entering a birth date is
  // exactly the friction this flow cannot afford.
  useEffect(() => {
    update({ dobEntry: { month: monthText, day: dayText, year: yearText }, dob: iso });
  }, [monthText, dayText, yearText, iso, update]);

  const next = () => {
    if (iso) {
      completeStep('/steps/dob');
      router.push(nextStepPath('/steps/dob') as string);
    }
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/dob"
        title={`What is ${v.possessive} date of birth?`}
        hint="Pick the month, then type the day and the year."
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {MONTHS.map((name, index) => {
          const value = String(index + 1);
          const selected = monthText === value;
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={name}
              onPress={() => setMonthText(value)}
              style={{
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.base,
                borderRadius: theme.borderRadius.md,
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary[500] : theme.colors.rule,
                backgroundColor: selected ? theme.colors.primary[500] : 'transparent',
                // The theme's minimum touch target: these are the smallest
                // controls in the flow and the ones tapped with the least
                // steady hand.
                minHeight: 56,
                minWidth: 96,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <ThemedText
                variant="button"
                color={selected ? theme.colors.text.inverse : theme.colors.text.primary}
              >
                {name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Day"
            hint="For example 12"
            value={dayText}
            onChangeText={(text) => {
              const cleaned = digits(text, 2);
              setDayText(cleaned);
              // Two digits can only be a complete day, so move on rather than
              // making someone aim at the next box.
              if (cleaned.length === 2) {
                yearRef.current?.focus();
              }
            }}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 2 }}>
          <TextField
            ref={yearRef}
            label="Year"
            hint="For example 1948"
            value={yearText}
            onChangeText={(text) => setYearText(digits(text, 4))}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      </View>

      {problem ? (
        <ThemedText variant="body" color={theme.colors.semantic.error.text}>
          {problem}
        </ThemedText>
      ) : null}

      {spelled ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          That’s {spelled}.
        </ThemedText>
      ) : null}

      <PrimaryButton title="Continue" onPress={next} disabled={!iso} />
    </Screen>
  );
}
