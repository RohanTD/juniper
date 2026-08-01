import { useTheme } from '@juniper/theme';
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ENV } from '../../src/env';
import { PreferencesClient } from '../../src/preferences';
import {
  familyContactForSubmit,
  missingAnswers,
  toSubmitAnswers,
  useOnboarding,
} from '../../src/state';
import { submitOnboarding, type OnboardingFhirClient } from '../../src/submit';
import { PrimaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { ThemedText } from '../../src/ui/ThemedText';

/**
 * A short, non-technical cause for the failure banner.
 *
 * The distinction that matters to whoever is holding the phone: "we could not
 * reach the service" (retry may work) versus "you are not allowed to do this"
 * (retrying forever will not help). A single generic sentence hid both.
 */
function describeSubmitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/network|fetch|Failed to fetch|ECONNREFUSED|Load failed/i.test(message)) {
    return 'we could not reach the Juniper service';
  }
  if (/401|unauthor/i.test(message)) return 'the session has expired — please sign in again';
  if (/403|forbidden|denied/i.test(message)) return 'this account is not allowed to save it';
  if (/404|not found/i.test(message)) return 'the patient record could not be found';
  return message.slice(0, 120) || 'an unexpected error occurred';
}

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  const recipe = theme.recipes.sectionHeader;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: recipe.gap,
        marginTop: recipe.marginTop,
        marginBottom: recipe.marginBottom,
      }}
    >
      <ThemedText variant="label" color={recipe.label.color}>
        {title}
      </ThemedText>
      <View style={{ flex: 1, height: recipe.rule.thickness, backgroundColor: recipe.rule.color }} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.xs }}>
      <ThemedText variant="caption" color={theme.colors.text.secondary}>
        {label}
      </ThemedText>
      <ThemedText variant="bodyLarge">{value}</ThemedText>
    </View>
  );
}

export default function ReviewStep() {
  const theme = useTheme();
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { answers, clearDraftAfterSubmit } = useOnboarding();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const missing = missingAnswers(answers);
  const familyContact = familyContactForSubmit(answers);
  const patientId =
    answers.patientId ?? (profile?.resourceType === 'Patient' ? profile.id : undefined);

  const consentWord = (granted: boolean) => (granted ? 'Agreed' : 'Declined');

  const submit = async () => {
    setErrorMessage(undefined);
    if (!patientId) {
      setErrorMessage(
        'We could not tell whose record this is. Please reopen the link from your message and try again.'
      );
      return;
    }
    setSubmitting(true);
    try {
      const preferencesApi = new PreferencesClient({
        baseUrl: ENV.voiceApiUrl,
        token: ENV.voiceApiToken,
      });
      // The saved draft is deleted only once the submit resolves — never in a
      // `finally`, and never before. See src/draft.ts: the FHIR writes land
      // before the preferences call, so a late failure must leave the answers
      // in place for the retry that finishes the job.
      await clearDraftAfterSubmit(() =>
        submitOnboarding(
          medplum as unknown as OnboardingFhirClient,
          preferencesApi,
          patientId,
          toSubmitAnswers(answers)
        )
      );
      router.replace('/steps/done');
    } catch (error) {
      // Log the real cause. A bare `catch {}` here made every failure
      // indistinguishable — a declined consent, an expired session and a
      // voice service that simply wasn't running all produced the same
      // sentence with nothing to debug from.
      console.error('[onboarding] submit failed:', error);
      // "Nothing was lost" is not a safe blanket claim: submitOnboarding
      // writes Patient, RelatedPerson, CareTeam and Consent to Medplum
      // BEFORE calling the preferences API, so a late failure leaves those
      // already written. Re-submitting is still the right action (the FHIR
      // writes are update-or-create keyed on the patient), but the copy must
      // not promise something the code does not guarantee.
      setErrorMessage(
        `We could not finish saving the setup — ${describeSubmitError(error)}. ` +
          'Your answers are saved on this device, so nothing is lost — please try ' +
          'again now, or reopen your link later and press Finish setup.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <StepHeader step="/steps/review" title="Does everything look right?" />

      <SectionHeader title="About" />
      <Row
        label="Legal name"
        value={answers.legalName ? `${answers.legalName.given} ${answers.legalName.family}` : '—'}
      />
      <Row label="Date of birth" value={answers.dob ?? '—'} />
      <Row label="Phone" value={answers.phone ?? '—'} />
      <Row label="Preferred name" value={answers.preferredName ?? 'Same as legal name'} />
      <Row label="Language" value={answers.language?.label ?? '—'} />

      <SectionHeader title="Calls" />
      <Row
        label="Best call times"
        value={
          answers.callWindows.length > 0
            ? `${answers.callWindows.length} time ${answers.callWindows.length === 1 ? 'window' : 'windows'} chosen`
            : '—'
        }
      />
      <Row
        label="Enjoys"
        value={answers.interests.length > 0 ? answers.interests.join('; ') : 'Not said'}
      />
      <Row
        label="Topics to avoid"
        value={answers.topicsToAvoid.length > 0 ? answers.topicsToAvoid.join('; ') : 'None'}
      />

      <SectionHeader title="Family" />
      <Row
        label="Family contact"
        value={familyContact ? `${familyContact.name} (${familyContact.relationship})` : 'None'}
      />

      <SectionHeader title="Permissions" />
      <Row label="Check-in calls" value={consentWord(answers.consents.aiCalling)} />
      <Row label="Recording and transcription" value={consentWord(answers.consents.recording)} />
      <Row label="Family summaries" value={consentWord(answers.consents.familySharing)} />
      <Row
        label="Filled in by"
        value={
          answers.completedBy.role === 'proxy'
            ? `${answers.completedBy.name} (${answers.completedBy.relationship})`
            : 'The patient'
        }
      />

      {missing.length > 0 ? (
        <ThemedText variant="body" color={theme.colors.semantic.warning.text}>
          {`Still needed before finishing: ${missing.join(', ')}.`}
        </ThemedText>
      ) : null}
      {errorMessage ? (
        <ThemedText variant="body" color={theme.colors.semantic.error.text}>
          {errorMessage}
        </ThemedText>
      ) : null}

      <PrimaryButton
        title={submitting ? 'Saving…' : 'Finish setup'}
        onPress={submit}
        disabled={submitting || missing.length > 0}
      />
    </Screen>
  );
}
