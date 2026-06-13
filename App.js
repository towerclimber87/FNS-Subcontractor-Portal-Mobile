import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import PortalSetupScreen from './src/screens/PortalSetupScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProjectScreen from './src/screens/ProjectScreen';
import SowDocumentsScreen from './src/screens/SowDocumentsScreen';
import MaterialTrackerScreen from './src/screens/MaterialTrackerScreen';
import SiteDailyTrackerScreen from './src/screens/SiteDailyTrackerScreen';
import SubcontractorDailyReportScreen from './src/screens/SubcontractorDailyReportScreen';
import PhotoRepositoryScreen from './src/screens/PhotoRepositoryScreen';
import SiteCdsScreen from './src/screens/SiteCdsScreen';
import PlaceholderScreen from './src/screens/PlaceholderScreen';
import SubcontractorSiteWalkPhotosScreen from './src/screens/SubcontractorSiteWalkPhotosScreen';
import SubcontractorSiteWalk360Screen from './src/screens/SubcontractorSiteWalk360Screen';
import SubcontractorPdfEditorScreen from './src/screens/SubcontractorPdfEditorScreen';
import { clearSession, loadPortalUrl, loadSession, savePortalUrl } from './src/utils/storage';
import { logoutSubcontractor } from './src/api/subcontractorApi';
import { colors } from './src/components/ScreenShell';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [savedPortalUrl, setSavedPortalUrl] = useState('');
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState({ name: 'home' });

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const [portalUrl, savedSession] = await Promise.all([
          loadPortalUrl(),
          loadSession(),
        ]);

        if (!active) return;

        const sessionPortalUrl = savedSession?.portalUrl || '';
        const nextPortalUrl = portalUrl || sessionPortalUrl || '';

        if (nextPortalUrl) {
          setSavedPortalUrl(nextPortalUrl);
          if (!portalUrl) await savePortalUrl(nextPortalUrl);
        }

        if (savedSession?.access_token && nextPortalUrl) {
          setSession({ ...savedSession, portalUrl: nextPortalUrl });
        }
      } finally {
        if (active) setBooting(false);
      }
    }

    boot();

    return () => {
      active = false;
    };
  }, []);

  async function handlePortalSaved(portalUrl) {
    await savePortalUrl(portalUrl);
    setSavedPortalUrl(portalUrl);
    setSession(null);
    setRoute({ name: 'home' });
  }

  async function handleChangePortal() {
    const { clearPortalUrl } = await import('./src/utils/storage');
    await clearSession();
    await clearPortalUrl();
    setSavedPortalUrl('');
    setSession(null);
    setRoute({ name: 'home' });
  }

  async function doLogout() {
    const currentSession = session;
    setSession(null);
    setRoute({ name: 'home' });
    await clearSession();
    await logoutSubcontractor(currentSession?.portalUrl, currentSession?.access_token);
  }

  function goHome() {
    setRoute({ name: 'home' });
  }

  if (booting) {
    return (
      <View style={styles.boot}>
        <StatusBar style="light" backgroundColor={colors.bg} translucent={false} />
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.bootText}>Opening FNS Subcontractor Portal…</Text>
      </View>
    );
  }

  if (!savedPortalUrl) {
    return <PortalSetupScreen onPortalSaved={handlePortalSaved} />;
  }

  if (!session) {
    return (
      <LoginScreen
        portalUrl={savedPortalUrl}
        onChangePortal={handleChangePortal}
        onLogin={(s) => {
          setSession(s);
          setRoute({ name: 'home' });
        }}
      />
    );
  }

  if (route.name === 'project') {
    return (
      <ProjectScreen
        project={route.project}
        pages={route.pages}
        onBack={goHome}
        onHome={goHome}
        onOpenPage={(page, project) => setRoute({ name: page?.key === 'sow_documents' ? 'sowDocuments' : page?.key === 'material_tracker' ? 'materialTracker' : page?.key === 'site_daily_tracker' ? 'siteDailyTracker' : page?.key === 'daily_reports' ? 'dailyReports' : page?.key === 'photo_repository' ? 'photoRepository' : page?.key === 'site_cds' ? 'siteCds' : page?.key === 'site_walk_redlines' ? 'pdfEditor' : page?.key === 'site_walk_photos' ? 'siteWalkPhotos' : page?.key === 'site_walk_360' ? 'siteWalk360' : 'placeholder', page, project, pages: route.pages })}
      />
    );
  }


  if (route.name === 'sowDocuments') {
    return (
      <SowDocumentsScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }

  if (route.name === 'materialTracker') {
    return (
      <MaterialTrackerScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }



  if (route.name === 'siteDailyTracker') {
    return (
      <SiteDailyTrackerScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }



  if (route.name === 'dailyReports') {
    return (
      <SubcontractorDailyReportScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }


  if (route.name === 'photoRepository') {
    return (
      <PhotoRepositoryScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }


  if (route.name === 'siteCds') {
    return (
      <SiteCdsScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }

  if (route.name === 'pdfEditor') {
    return (
      <SubcontractorPdfEditorScreen
        session={session}
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
        onOpenPhotoPin={(pin, viewportState, returnSnapshot) => setRoute({ name: 'siteWalkPhotos', project: route.project, page: { key: 'site_walk_photos', label: 'SiteWalk Photos' }, pages: route.pages, initialRedlinePhotoPin: pin, redlineViewportState: viewportState, redlineReturnSnapshot: returnSnapshot })}
        onOpen360Pin={(pin, viewportState, returnSnapshot) => setRoute({ name: 'siteWalk360', project: route.project, page: { key: 'site_walk_360', label: 'SiteWalk 360 Photos' }, pages: route.pages, initialRedline360Pin: pin, redlineViewportState: viewportState, redlineReturnSnapshot: returnSnapshot })}
        initialViewportState={route.redlineViewportState}
        initialReturnSnapshot={route.redlineReturnSnapshot}
      />
    );
  }

  if (route.name === 'siteWalkPhotos') {
    const backToPdf = () => {
      if (route.redlineViewportState || route.redlineReturnSnapshot) {
        setRoute({ name: 'pdfEditor', project: route.project, page: { key: 'site_walk_redlines', label: 'PDF Editor' }, pages: route.pages, redlineViewportState: route.redlineViewportState, redlineReturnSnapshot: route.redlineReturnSnapshot });
        return;
      }
      setRoute({ name: 'project', project: route.project, pages: route.pages });
    };
    return (
      <SubcontractorSiteWalkPhotosScreen
        session={session}
        project={route.project}
        page={route.page}
        initialRedlinePhotoPin={route.initialRedlinePhotoPin}
        onBack={backToPdf}
        onHome={goHome}
      />
    );
  }

  if (route.name === 'siteWalk360') {
    const backToPdf = () => {
      if (route.redlineViewportState || route.redlineReturnSnapshot) {
        setRoute({ name: 'pdfEditor', project: route.project, page: { key: 'site_walk_redlines', label: 'PDF Editor' }, pages: route.pages, redlineViewportState: route.redlineViewportState, redlineReturnSnapshot: route.redlineReturnSnapshot });
        return;
      }
      setRoute({ name: 'project', project: route.project, pages: route.pages });
    };
    return (
      <SubcontractorSiteWalk360Screen
        session={session}
        project={route.project}
        page={route.page}
        initialRedline360Pin={route.initialRedline360Pin}
        onBack={backToPdf}
        onHome={goHome}
      />
    );
  }

  if (route.name === 'placeholder') {
    return (
      <PlaceholderScreen
        project={route.project}
        page={route.page}
        onBack={() => setRoute({ name: 'project', project: route.project, pages: route.pages })}
        onHome={goHome}
      />
    );
  }

  return (
    <HomeScreen
      session={session}
      onLogout={doLogout}
      onOpenProject={(project, pages) => setRoute({ name: 'project', project, pages })}
    />
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: 14,
    padding: 20,
  },
  bootText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
});
