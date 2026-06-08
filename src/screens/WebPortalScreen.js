import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import ScreenShell, { colors } from '../components/ScreenShell';
import { buildWebSessionUrl, sitePagePath } from '../api/subcontractorApi';

export default function WebPortalScreen({ session, project, page, onBack, onHome, onLogout }) {
  const webRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const path = useMemo(() => sitePagePath(page, project), [page, project]);
  const url = useMemo(() => buildWebSessionUrl(session.portalUrl, session.access_token, path), [session, path]);

  return (
    <ScreenShell title={page?.label || 'Subcontractor Page'} subtitle={project?.site_name || ''} rightLabel="Logout" onRightPress={onLogout}>
      <View style={styles.toolbar}>
        <Pressable style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]} onPress={onHome}><Text style={styles.toolText}>Home</Text></Pressable>
        <Pressable style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]} onPress={onBack}><Text style={styles.toolText}>Back</Text></Pressable>
        <Pressable style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]} onPress={() => webRef.current?.reload()}><Text style={styles.toolText}>Reload</Text></Pressable>
      </View>
      <View style={styles.webWrap}>
        {loading && <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.loadingText}>Opening portal page…</Text></View>}
        <WebView
          ref={webRef}
          source={{ uri: url }}
          startInLoadingState
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => Alert.alert('Page Error', event?.nativeEvent?.description || 'Unable to open this page.')}
          style={styles.webview}
        />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 10, padding: 10, backgroundColor: '#eef5fc', borderBottomWidth: 1, borderBottomColor: colors.line },
  toolButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  toolText: { color: colors.blue, fontWeight: '900' },
  webWrap: { flex: 1, backgroundColor: '#fff' },
  loading: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  loadingText: { color: colors.muted, fontWeight: '800' },
  webview: { flex: 1 },
  pressed: { opacity: 0.72 },
});
