# Setup, Template Skeleton, Rendering & Sending

## Installation

Scaffold a new React Email project:

```sh
npx create-email@latest
cd react-email-starter && npm install && npm run dev
```

The dev server runs a preview interface for templates in the `emails` folder.

### Adding to an existing project

```bash
npm install react-email @react-email/preview-server -D -E
npm install @react-email/components react react-dom -E
```

package.json script: `"email:dev": "email dev"` (add `--dir src/emails` if templates live
elsewhere). Ensure tsconfig.json includes JSX support.

## Basic template skeleton

```tsx
import {
  Html, Head, Preview, Body, Container, Heading, Text, Button,
  Tailwind, pixelBasedPreset,
} from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  verificationUrl: string;
}

export default function WelcomeEmail({ name, verificationUrl }: WelcomeEmailProps) {
  return (
    <Html lang="en">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: { extend: { colors: { brand: '#007bff' } } },
        }}
      >
        <Head />
        <Body className="bg-gray-100 font-sans">
          <Preview>Welcome - Verify your email</Preview>
          <Container className="max-w-xl mx-auto p-5">
            <Heading className="text-2xl text-gray-800">Welcome!</Heading>
            <Text className="text-base text-gray-800">Hi {name}, thanks for signing up!</Text>
            <Button
              href={verificationUrl}
              className="bg-brand text-white px-5 py-3 rounded block text-center no-underline box-border"
            >
              Verify Email
            </Button>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

WelcomeEmail.PreviewProps = {
  name: 'John Doe',
  verificationUrl: 'https://example.com/verify/abc123',
} satisfies WelcomeEmailProps;

export { WelcomeEmail };
```

## Rendering

```tsx
import { render } from '@react-email/components';
import { WelcomeEmail } from './emails/welcome';

const html = await render(<WelcomeEmail name="John" verificationUrl="https://example.com/verify" />);
const text = await render(<WelcomeEmail name="John" verificationUrl="https://example.com/verify" />, { plainText: true });
```

## Sending (Resend quick example)

```tsx
import { Resend } from 'resend';
import { WelcomeEmail } from './emails/welcome';

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: 'Acme <onboarding@resend.dev>',
  to: ['user@example.com'],
  subject: 'Welcome to Acme',
  react: <WelcomeEmail name="John" verificationUrl="https://example.com/verify" />,
});

if (error) console.error('Failed to send:', error);
```

Resend accepts a React component directly and auto-includes a plain-text version if none is
given. Full provider guide: [SENDING.md](SENDING.md).
