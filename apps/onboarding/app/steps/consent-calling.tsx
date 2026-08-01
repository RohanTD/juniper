import { useOnboarding } from '../../src/state';
import { ConsentScreen } from '../../src/ui/ConsentScreen';

export default function ConsentCallingStep() {
  const { answers, update } = useOnboarding();
  return (
    <ConsentScreen
      step="/steps/consent-calling"
      consentNumber={1}
      title="May Juniper call for regular check-ins?"
      paragraphs={[
        'Juniper is a friendly automated companion. It calls at the times you chose, asks how things are going, and shares what matters with the care team.',
        'You can say no. You can also change your mind at any time — just say so on a call, or tell the clinic.',
      ]}
      onDecision={(granted) => update({ consents: { ...answers.consents, aiCalling: granted } })}
    />
  );
}
