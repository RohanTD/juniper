import { useOnboarding } from '../../src/state';
import { ConsentScreen } from '../../src/ui/ConsentScreen';

export default function ConsentRecordingStep() {
  const { answers } = useOnboarding();
  return (
    <ConsentScreen
      step="/steps/consent-recording"
      consentNumber={2}
      title="May the calls be recorded and written down?"
      paragraphs={[
        'A written record of each call helps the care team see exactly what was said, and helps Juniper remember things between calls.',
        'This is separate from agreeing to the calls themselves. Recordings stay in the medical record and are never shared outside the care team.',
      ]}
      onDecision={(granted) => ({ consents: { ...answers.consents, recording: granted } })}
    />
  );
}
