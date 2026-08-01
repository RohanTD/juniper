/**
 * Magic-link entry. The link a patient (or family member, or clinic staff)
 * opens lands here — on a phone or a laptop. No account creation, no
 * password: "Begin setup" hands off to Medplum's hosted auth via PKCE.
 *
 * It is also where a half-finished setup is picked back up. If a draft was
 * restored, this screen says so in plain words and offers the question they
 * stopped at — because someone in their eighties who sees question one again
 * will reasonably conclude nothing was saved and give up.
 */
import { signInWithMedplum } from '@juniper/medplum-rn';
import { useTheme } from '@juniper/theme';
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { APP_SCHEME, ENV } from '../src/env';
import { stepPosition, useOnboarding, type StepPath } from '../src/state';
import { PrimaryButton, SecondaryButton } from '../src/ui/Buttons';
import { Screen } from '../src/ui/Screen';
import { ThemedText } from '../src/ui/ThemedText';

export default function Welcome() {
  const theme = useTheme();
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { restored, acknowledgeRestore, resumeStep, adoptPatient, discardDraft } = useOnboarding();
  const params = useLocalSearchParams<{ patient?: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);

  // A magic link may carry the patient id (web deep link). It also scopes the
  // saved draft: a second patient's link on the same device must never surface
  // the first patient's answers.
  const linkedPatientId =
    (typeof params.patient === 'string' && params.patient ? params.patient : undefined) ??
    (profile?.resourceType === 'Patient' ? profile.id : undefined);

  useEffect(() => {
    if (linkedPatientId) {
      adoptPatient(linkedPatientId);
    }
  }, [linkedPatientId, adoptPatient]);

  const go = async (target: StepPath) => {
    setMessage(undefined);
    if (profile) {
      router.push(target as string);
      // They have been told; the step screen must not repeat the notice.
      acknowledgeRestore();
      return;
    }
    setBusy(true);
    try {
      const signedIn = await signInWithMedplum(medplum, {
        clientId: ENV.medplumClientId,
        scheme: APP_SCHEME,
      });
      if (signedIn) {
        router.push(target as string);
        acknowledgeRestore();
      } else {
        setMessage('Sign-in was not completed. You can try again whenever you are ready.');
      }
    } catch {
      setMessage('Something went wrong signing in. Please try the link from your message again.');
    } finally {
      setBusy(false);
    }
  };

  const { index, total } = stepPosition(resumeStep);

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.base }}>
        <ThemedText variant="label" color={theme.recipes.hero.eyebrow.color}>
          {restored ? 'Welcome back' : 'Juniper'}
        </ThemedText>
        {restored ? (
          <>
            <ThemedText variant="display">We saved your answers.</ThemedText>
            <ThemedText variant="bodyLarge" color={theme.colors.text.secondary}>
              {resumeStep === '/steps/review'
                ? 'You had answered every question — all that is left is to look them over and finish. Nothing you told us was lost.'
                : `Pick up where you left off — you had reached question ${index} of ${total}. Nothing you told us was lost.`}
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText variant="display">A friendly check-in call, made just for you.</ThemedText>
            <ThemedText variant="bodyLarge" color={theme.colors.text.secondary}>
              Juniper calls to chat, see how you are doing, and keep your care team in the loop.
              This short setup takes about five minutes, and you will never need this app again
              afterward.
            </ThemedText>
            <ThemedText variant="body" color={theme.colors.text.secondary}>
              No password needed — the secure link you received signs you in.
            </ThemedText>
            <ThemedText variant="body" color={theme.colors.text.secondary}>
              Your answers are saved as you go, so you can stop at any time and come back to this
              link later.
            </ThemedText>
          </>
        )}
        {message ? (
          <ThemedText variant="body" color={theme.colors.semantic.error.text}>
            {message}
          </ThemedText>
        ) : null}
      </View>

      {restored ? (
        <View style={{ gap: theme.spacing.md }}>
          <PrimaryButton
            title={
              busy
                ? 'Opening secure sign-in…'
                : resumeStep === '/steps/review'
                  ? 'Review and finish setup'
                  : 'Pick up where you left off'
            }
            onPress={() => void go(resumeStep)}
            disabled={busy}
          />
          {confirmingStartOver ? (
            <View style={{ gap: theme.spacing.md }}>
              <ThemedText variant="body" color={theme.colors.text.secondary}>
                Starting over erases the answers you have given so far. Are you sure?
              </ThemedText>
              <SecondaryButton
                title="Yes, erase them and start over"
                onPress={() => {
                  discardDraft();
                  setConfirmingStartOver(false);
                }}
              />
              <SecondaryButton
                title="No, keep my answers"
                onPress={() => setConfirmingStartOver(false)}
              />
            </View>
          ) : (
            <SecondaryButton
              title="Start over from the beginning"
              onPress={() => setConfirmingStartOver(true)}
            />
          )}
        </View>
      ) : (
        <PrimaryButton
          title={busy ? 'Opening secure sign-in…' : 'Begin setup'}
          onPress={() => void go('/steps/who')}
          disabled={busy}
        />
      )}
    </Screen>
  );
}
