/**
 * "Which patient are you looking at?" — shown to clinic staff and project
 * admins only.
 *
 * A caregiver never sees this. Their patient comes from their CareTeam
 * membership and offering a list would imply there is something to choose
 * between; `useMonitoredPatient().canChoosePatient` is false for them, and this
 * component is only rendered behind that flag.
 *
 * The list is whatever `Patient?_sort=family` returns for the signed-in
 * principal — i.e. the AccessPolicy decides its contents, not this file.
 * Picking grants nothing: every subsequent read is still made as that user and
 * still fails if the server says no.
 */
import { useTheme } from '@juniper/theme';
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { patientDisplayName } from '../data/patient';
import { Card } from './Card';
import { SectionHeader } from './SectionHeader';
import { ThemedText } from './ThemedText';

export interface PatientPickerProps {
  selected: string | undefined;
  onSelect: (ref: string) => void;
}

export function PatientPicker({ selected, onSelect }: PatientPickerProps) {
  const theme = useTheme();
  const medplum = useMedplum();
  const [patients, setPatients] = useState<Patient[]>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    medplum
      .searchResources('Patient', { _sort: 'family', _count: '50' })
      .then((results) => {
        if (!cancelled) {
          setPatients([...results]);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [medplum]);

  return (
    <View
      style={{
        backgroundColor: theme.colors.background.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      <SectionHeader title="Choose a patient" />
      <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
        You’re signed in as staff rather than as a family member, so Juniper doesn’t know whose
        dashboard to show. Pick one — family members skip this entirely.
      </ThemedText>

      {error ? (
        <ThemedText variant="bodySmall" color={theme.colors.semantic.error.text}>
          We couldn’t load the patient list. Your account may not have permission to browse
          patients.
        </ThemedText>
      ) : null}

      {patients === undefined && !error ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          Loading patients…
        </ThemedText>
      ) : null}

      {patients?.length === 0 ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          No patients are visible to this account yet.
        </ThemedText>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        {patients?.map((patient) => {
          const ref = `Patient/${patient.id}`;
          const isSelected = ref === selected;
          return (
            <Pressable
              key={patient.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(ref)}
              style={{
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.primary[500] : theme.colors.rule,
                backgroundColor: isSelected
                  ? theme.colors.background.tertiary
                  : 'transparent',
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.base,
                minHeight: 44,
                justifyContent: 'center',
              }}
            >
              <ThemedText variant="h4">{patientDisplayName(patient)}</ThemedText>
              {patient.birthDate ? (
                <ThemedText variant="meta" color={theme.colors.text.secondary}>
                  BORN {patient.birthDate}
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
