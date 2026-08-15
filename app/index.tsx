import { Redirect } from 'expo-router';

/** Dashboard is the home screen (Frontend Spec 2.1). */
export default function Index() {
  return <Redirect href="/dashboard" />;
}
