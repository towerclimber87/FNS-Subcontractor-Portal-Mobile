import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import ScreenShell, { colors } from '../components/ScreenShell';
import { loadSubcontractorHome, loadSubcontractorProjects } from '../api/subcontractorApi';

function initials(name) {
  return String(name || 'SC').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || 'SC';
}

export default function HomeScreen({ session, onLogout, onOpenProject }) {
  const [home, setHome] = useState(null);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const columns = width >= 1000 ? 3 : width >= 680 ? 2 : 1;

  const user = home?.user || session?.user || {};
  const subtitle = user?.subcontractor_name || user?.name || user?.email_address || 'Subcontractor';

  const load = useCallback(async (nextQuery = query, showRefresh = false) => {
    setError('');
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [homeData, projectData] = await Promise.all([
        loadSubcontractorHome(session.portalUrl, session.access_token),
        loadSubcontractorProjects(session.portalUrl, session.access_token, nextQuery),
      ]);
      setHome(homeData);
      setProjects(projectData?.projects || []);
    } catch (err) {
      setError(err?.message || 'Could not load subcontractor projects.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query, session?.portalUrl, session?.access_token]);

  useEffect(() => { load('', false); }, []);

  const content = useMemo(() => {
    if (loading) {
      return <View style={styles.loading}><ActivityIndicator size="large" color={colors.blue} /><Text style={styles.loadingText}>Loading projects…</Text></View>;
    }
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(query, true)} />}
      >
        <View style={styles.heroGradient}>
          <View style={styles.hero}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user?.name || user?.subcontractor_name)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroTitle}>Projects Under Construction</Text>
              <Text style={styles.heroCopy}>Active assigned construction projects are shown below.</Text>
            </View>
            <View style={styles.countPill}><Text style={styles.countText}>{projects.length}</Text></View>
          </View>
        </View>

        {!!error && <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View>}

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query, false)}
            placeholder="Search projects"
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
            returnKeyType="search"
          />
          <Pressable style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]} onPress={() => load(query, false)}>
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {!projects.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active projects found</Text>
            <Text style={styles.emptyCopy}>This account is not currently assigned to any active under-construction projects, or the search did not match any projects.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {projects.map((project) => (
              <Pressable
                key={project.site_name}
                style={({ pressed }) => [styles.projectCard, { width: `${100 / columns}%` }, pressed && styles.pressed]}
                onPress={() => onOpenProject(project, home?.pages || [])}
              >
                <View style={styles.innerProjectCard}>
                  <View style={styles.projectTopRow}>
                    <View style={styles.projectIcon}><Text style={styles.projectIconText}>🏗️</Text></View>
                    <View style={styles.statusPill}><Text style={styles.statusText}>Active</Text></View>
                  </View>
                  <Text style={styles.projectName} numberOfLines={2}>{project.site_name}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }, [loading, refreshing, query, projects, columns, user, home, load, onOpenProject, error]);

  return (
    <ScreenShell title="FNS Subcontractor Portal" subtitle={subtitle} onLogout={onLogout}>
      {content}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.pageBg },
  loadingText: { color: colors.muted, fontWeight: '800' },
  heroGradient: { backgroundColor: colors.bg, borderRadius: 26, padding: 1, marginBottom: 14, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#10233f', borderRadius: 25, padding: 16 },
  avatar: { width: 54, height: 54, borderRadius: 20, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.blue, fontWeight: '900', fontSize: 18 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroCopy: { color: '#b9c8dc', lineHeight: 19, marginTop: 3, fontWeight: '700' },
  countPill: { minWidth: 44, height: 44, borderRadius: 16, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#bbf7d0' },
  countText: { color: colors.green, fontWeight: '900', fontSize: 18 },
  errorCard: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14 },
  errorText: { color: '#b91c1c', fontWeight: '800', textAlign: 'center' },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  searchInput: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12, fontWeight: '800', color: colors.text },
  searchButton: { backgroundColor: colors.blue, borderRadius: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  projectCard: { padding: 6 },
  innerProjectCard: { minHeight: 112, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 14, justifyContent: 'space-between' },
  projectTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  projectIcon: { width: 40, height: 40, borderRadius: 15, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  projectIconText: { fontSize: 21 },
  statusPill: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { color: colors.green, fontWeight: '900', fontSize: 11 },
  projectName: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '900', marginTop: 12 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.line, padding: 20 },
  emptyTitle: { color: colors.text, fontWeight: '900', fontSize: 18 },
  emptyCopy: { color: colors.muted, fontWeight: '600', lineHeight: 20, marginTop: 8 },
  pressed: { opacity: 0.72 },
});
