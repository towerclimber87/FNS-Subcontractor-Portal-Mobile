import { useEffect, useState } from 'react';
import { Alert, View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProjectScreen from './src/screens/ProjectScreen';
import WebPortalScreen from './src/screens/WebPortalScreen';
import { clearSession, loadSession } from './src/utils/storage';
import { logoutSubcontractor } from './src/api/subcontractorApi';
import { colors } from './src/components/ScreenShell';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState({ name: 'home' });

  useEffect(() => {
    let active = true;
    loadSession().then((saved) => {
      if (!active) return;
      if (saved?.access_token && saved?.portalUrl) setSession(saved);
    }).finally(() => active && setBooting(false));
    return () => { active = false; };
  }, []);

  async function doLogout() {
    Alert.alert('Log Out', 'Log out of the subcontractor portal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => {
        await logoutSubcontractor(session?.portalUrl, session?.access_token);
        await clearSession();
        setSession(null);
        setRoute({ name: 'home' });
      } },
    ]);
  }

  if (booting) {
    return (
      <View style={styles.boot}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.bootText}>Opening FNS Subcontractor Portal…</Text>
      </View>
    );
  }

  if (!session) return <LoginScreen onLogin={(s) => { setSession(s); setRoute({ name: 'home' }); }} />;

  if (route.name === 'project') {
    return <ProjectScreen project={route.project} pages={route.pages} onBack={() => setRoute({ name: 'home' })} onLogout={doLogout} onOpenPage={(page, project) => setRoute({ name: 'web', page, project, pages: route.pages })} />;
  }

  if (route.name === 'web') {
    return <WebPortalScreen session={session} project={route.project} page={route.page} onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })} onHome={() => setRoute({ name: 'home' })} onLogout={doLogout} />;
  }

  return <HomeScreen session={session} onLogout={doLogout} onOpenProject={(project, pages) => setRoute({ name: 'project', project, pages })} />;
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 14, padding: 20 },
  bootText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
});
