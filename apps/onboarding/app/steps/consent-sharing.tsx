import { useOnboarding } from '../../src/state';
import { ConsentScreen } from '../../src/ui/ConsentScreen';

export default function ConsentSharingStep() {
  const { answers, update } = useOnboarding();
  return (
    <ConsentScreen
      step="/steps/consent-sharing"
      consentNumber={3}
      title="May family read a plain-language summary?"
      paragraphs={[
        'If you agree, the family contact you named can read a short, friendly summary after each call — how it went, and anything worth knowing.',
        'They never see the medical notes or the conversation itself, only the summary. Say no and nothing is shared with family at all.',
      ]}
      onDecision={(granted) => update({ consents: { ...answers.consents, familySharing: granted } })}
    />
  );
}
