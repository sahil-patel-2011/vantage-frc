import SignInClient from "./sign-in-client";

export default function SignInPage() {
  return <SignInClient googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
